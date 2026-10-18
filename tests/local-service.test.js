import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createLocalService } from '../src/local-service.js'
import { signWbi } from '../server/bilibili.js'

const json = (data, code = 0, headers = {}) => new Response(JSON.stringify({ code, data }), { headers })
const user = { mid: 42, name: 'Listener', avatar: '' }
const source = { kind: 'favorite', remoteId: 123, title: 'Music', group: 'owned' }
const track = { bvid: 'BV1234567890', title: 'Song', duration: 180, cover: 'https://i0.hdslb.com/cover.jpg' }

function harness({ saved = null, fetcher, login = async () => ({ cookies: 'SESSDATA=local-only; bili_jct=csrf' }) } = {}) {
  const requests = [], streams = [], mediaUpdates = []
  let snapshot = saved, clears = 0
  const service = createLocalService({
    storage: { read: async () => structuredClone(snapshot), write: async (value) => { snapshot = JSON.parse(value) } },
    fetcher: async (url, options) => {
      assert.match(url.hostname, /^(api|passport)\.bilibili\.com$/)
      requests.push({ url: String(url), cookie: options.headers.Cookie })
      if (fetcher) return fetcher(url, options)
      if (url.pathname.endsWith('/nav')) return json({ isLogin: true, mid: 42, uname: user.name, wbi_img: { img_url: `https://i0.hdslb.com/${'a'.repeat(32)}.png`, sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png` } })
      if (url.pathname.includes('resource/list')) return json({ medias: [track], has_more: false, info: { title: 'Synced', media_count: 1 } })
      if (url.pathname.includes('created/list')) return json({ list: [{ id: 123, title: 'Music' }] })
      if (url.pathname.includes('collected/list')) return json({ list: [{ id: 456, title: 'Followed', attr: 0 }], has_more: false })
      if (url.pathname.endsWith('/view')) return json({ cid: 1, duration: 180 })
      if (url.pathname.endsWith('/playurl')) return json({ dash: { audio: [{ baseUrl: 'https://cdn.bilivideo.com/audio.m4s' }] } })
      throw new Error(`Unexpected request ${url.pathname}`)
    },
    media: { register: async (value) => { streams.push(value); return { url: '/__conova/audio/ticket' } }, update: async (value) => { mediaUpdates.push(value) }, clear: async () => { clears++ } },
    login,
    clearLogin: async () => { clears++ },
    qrImage: async () => 'data:image/png;base64,qr',
  })
  return { service, requests, streams, mediaUpdates, get snapshot() { return snapshot }, get clears() { return clears } }
}

test('standalone Android starts without any configured server and restores only its local library', async () => {
  const app = harness()
  assert.deepEqual(await app.service.request('/session'), { user: null, library: [] })
  assert.equal(app.requests.length, 0)
  const restored = harness({ saved: { biliCookie: 'SESSDATA=secret', user, library: [{ id: 'favorite:123', tracks: [] }] } })
  const session = await restored.service.request('/session')
  assert.equal(session.user.mid, 42)
  assert.equal(session.library.length, 1)
  assert.equal(JSON.stringify(session).includes('SESSDATA'), false)
})

test('native account login verifies the Bilibili session and persists it locally', async () => {
  const app = harness()
  assert.equal((await app.service.accountLogin()).ok, true)
  assert.equal(app.snapshot.user.mid, 42)
  assert.match(app.snapshot.biliCookie, /SESSDATA=local-only/)
  const sources = await app.service.request('/sources')
  assert.equal(sources.owned[0].kind, 'favorite')
  assert.equal(sources.followed[0].kind, 'season')
  assert.ok(app.requests.every((request) => request.cookie.includes('SESSDATA=local-only')))
})

test('cancelled and unverified native logins never replace a working session', async () => {
  const saved = { user, biliCookie: 'SESSDATA=old', library: [] }
  const cancelled = harness({ saved, login: async () => ({ cancelled: true }) })
  assert.deepEqual(await cancelled.service.accountLogin(), { cancelled: true })
  const rejected = harness({ saved, fetcher: async () => json({ isLogin: false }) })
  await assert.rejects(() => rejected.service.accountLogin(), /尚未完成/)
  assert.equal((await rejected.service.request('/session')).user.mid, 42)
  assert.equal(rejected.snapshot.biliCookie, 'SESSDATA=old')
})

test('Android QR login captures Set-Cookie, verifies user and survives restart', async () => {
  const app = harness({ fetcher: async (url) => {
    if (url.pathname.endsWith('/generate')) return json({ qrcode_key: 'key', url: 'https://passport.bilibili.com/qr?key=key' })
    if (url.pathname.endsWith('/poll')) return json({ code: 0 }, 0, { 'set-cookie': 'SESSDATA=qr-secret; HttpOnly; Secure' })
    return json({ isLogin: true, mid: 42, uname: 'Listener' })
  } })
  assert.match((await app.service.request('/auth/qr', { method: 'POST' })).image, /^data:image/)
  assert.equal((await app.service.request('/auth/qr/status')).status, 'success')
  assert.equal(app.snapshot.biliCookie, 'SESSDATA=qr-secret')
  assert.equal((await harness({ saved: app.snapshot }).service.request('/session')).user.mid, 42)
})

test('local albums sync, persist, play through native media and can be removed', async () => {
  const app = harness({ saved: { user, biliCookie: 'SESSDATA=local-only', library: [] } })
  const album = await app.service.request('/library', { method: 'POST', body: source })
  assert.equal(album.tracks.length, 1)
  assert.equal(app.snapshot.library[0].id, 'favorite:123')
  assert.equal((await app.service.request('/library/sync', { method: 'POST' })).results[0].ok, true)
  const audio = await app.service.request('/track/BV1234567890')
  assert.equal(audio.url, '/__conova/audio/ticket')
  assert.deepEqual(app.streams[0], { url: 'https://cdn.bilivideo.com/audio.m4s', backups: [] })
  assert.deepEqual(app.mediaUpdates[0], { title: 'Song', artist: 'Bilibili', duration: 180, position: 0, playing: false })
  await app.service.request('/library/favorite%3A123', { method: 'DELETE' })
  assert.deepEqual(app.snapshot.library, [])
})

test('failed Android sync retains the last complete album, including after restart', async () => {
  const album = { ...source, id: 'favorite:123', tracks: [track] }
  const app = harness({ saved: { user, library: [album] }, fetcher: async () => { throw new Error('offline') } })
  const result = await app.service.request('/library/sync', { method: 'POST' })
  assert.equal(result.results[0].ok, false)
  assert.deepEqual(result.library, [album])
  assert.deepEqual(app.snapshot.library, [album])
})

test('Android logout revokes playback, clears official login cookies and local identity', async () => {
  const app = harness({ saved: { user, biliCookie: 'SESSDATA=secret', library: [{ id: 'favorite:123', tracks: [track] }] } })
  await app.service.request('/auth/logout', { method: 'POST' })
  assert.equal(app.clears, 2)
  assert.deepEqual(await app.service.request('/session'), { user: null, library: [] })
  assert.equal(app.snapshot.biliCookie, '')
  await assert.rejects(() => app.service.request('/track/BV1234567890'), /请先连接/)
})

test('browser-compatible WBI hashing matches the Node crypto implementation', () => {
  const imageKey = 'a'.repeat(32), subKey = 'b'.repeat(32)
  const result = signWbi({ bvid: 'BV1234567890', cid: 1 }, imageKey, subKey, 1702204169)
  const [query, hash] = result.split('&w_rid=')
  const order = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13]
  const mixin = order.map((index) => (imageKey + subKey)[index]).join('')
  assert.equal(hash, createHash('md5').update(query + mixin).digest('hex'))
})
