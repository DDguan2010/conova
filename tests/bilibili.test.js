import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Bilibili, signWbi, isMediaHost, isImageHost } from '../server/bilibili.js'

const json = (data, code = 0) => new Response(JSON.stringify({ code, data }), { headers: { 'Content-Type': 'application/json' } })
const media = (index) => ({ bvid: `BV${String(index).padStart(10, '0')}`, title: `Song ${index}`, upper: { name: 'Creator' }, duration: 180, cover: 'http://i0.hdslb.com/test.jpg' })

test('favorites loads every page, normalizes covers and preserves invalid videos', async () => {
  const calls = []
  const client = new Bilibili({}, async (url) => {
    const page = Number(url.searchParams.get('pn')); calls.push(page)
    const medias = page === 1 ? Array.from({ length: 20 }, (_, i) => media(i)) : [media(20), { id: 23, title: '已失效视频' }]
    return json({ info: { title: 'All videos', media_count: 22 }, medias, has_more: page === 1 })
  })
  const result = await client.tracks('favorite', 123)
  assert.deepEqual(calls, [1, 2]); assert.equal(result.tracks.length, 22); assert.equal(result.tracks[0].cover, 'https://i0.hdslb.com/test.jpg'); assert.equal(result.tracks[21].unavailable, true)
})
test('season collections paginate beyond the first twenty videos', async () => {
  const calls = []
  const client = new Bilibili({}, async (url) => {
    assert.equal(url.pathname, '/x/space/fav/season/list')
    const page = Number(url.searchParams.get('pn')); calls.push(page)
    return json({ info: { media_count: 25 }, medias: Array.from({ length: page === 1 ? 20 : 5 }, (_, i) => media((page - 1) * 20 + i)) })
  })
  assert.equal((await client.tracks('season', 123)).tracks.length, 25); assert.deepEqual(calls, [1, 2])
})
test('failed or repeated pages reject instead of silently replacing a complete library', async () => {
  let calls = 0
  const failing = new Bilibili({}, async () => ++calls === 1 ? json({ medias: [media(1)], has_more: true }) : json(null, -412))
  await assert.rejects(() => failing.tracks('favorite', 123), /-412/)
  const repeating = new Bilibili({}, async () => json({ medias: [media(1)], has_more: true }))
  await assert.rejects(() => repeating.tracks('favorite', 123), /重复/)
})
test('followed sources distinguish another user’s favorite folder from a season', async () => {
  const client = new Bilibili({}, async (url) => {
    if (url.pathname.endsWith('/nav')) return json({ isLogin: true, mid: 1, uname: 'user' })
    if (url.pathname.includes('created')) return json({ list: [{ id: 10, title: 'mine', media_count: 2 }] })
    const page = Number(url.searchParams.get('pn'))
    return json({ list: page === 1 ? [{ id: 20, title: 'followed folder', attr: 22, state: 0 }, { id: 21, title: 'season', attr: 0, state: 0 }, { id: 22, state: 1 }] : [{ id: 23, title: 'next page', attr: 0 }], has_more: page === 1 })
  })
  const result = await client.sources()
  assert.equal(result.owned.length, 1); assert.deepEqual(result.followed.map((s) => s.kind), ['favorite', 'season', 'season']); assert.deepEqual(result.followed.map((s) => s.remoteId), [20, 21, 23])
})
test('QR success is only accepted with a verified Bilibili session', async () => {
  const session = { qrKey: 'key' }
  const client = new Bilibili(session, async (url) => {
    if (url.pathname.endsWith('/poll')) return new Response(JSON.stringify({ code: 0, data: { code: 0 } }), { headers: { 'set-cookie': 'SESSDATA=secret; Path=/; HttpOnly' } })
    return json({ isLogin: true, mid: 42, uname: 'real user' })
  })
  const result = await client.poll()
  assert.equal(result.user.mid, 42); assert.equal(result.status, 'success'); assert.equal(session.biliCookie, 'SESSDATA=secret'); assert.equal(session.qrKey, undefined)
  const broken = new Bilibili({ qrKey: 'key' }, async () => json({ code: 0 }))
  await assert.rejects(() => broken.poll(), /凭据/)
})
test('WBI signatures encode values, are independent of input key order and do not mutate input', () => {
  const first = { foo: "hi!'()* there", bar: 2 }
  const result = signWbi(first, 'a'.repeat(32), 'b'.repeat(32), 1702204169)
  assert.match(result, /^bar=2&foo=hi%20there&wts=1702204169&w_rid=[a-f0-9]{32}$/)
  assert.equal(result, signWbi({ bar: 2, foo: first.foo }, 'a'.repeat(32), 'b'.repeat(32), 1702204169)); assert.equal(first.wts, undefined)
})
test('media proxy rejects private hosts, credential URLs and deceptive host suffixes', () => {
  for (const url of ['http://a.bilivideo.com/a', 'https://bilivideo.com.evil.com/a', 'https://127.0.0.1/a', 'https://user:pass@a.bilivideo.com/a', 'https://a.bilivideo.com:8443/a']) assert.equal(isMediaHost(url), false)
  assert.equal(isMediaHost('https://xy.mcdn.bilivideo.cn/audio.m4s'), true); assert.equal(isImageHost('https://i0.hdslb.com/a.jpg'), true); assert.equal(isImageHost('https://hdslb.com.evil.com/a'), false)
})
