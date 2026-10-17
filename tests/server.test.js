import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/app.js'

async function setup(t, fetcher) {
  const dir = await mkdtemp(join(tmpdir(), 'conova-test-'))
  const { app, store } = await createApp({ dataDir: dir, fetcher })
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await store.pending; await rm(dir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${base}/api/session`)
  const cookie = response.headers.get('set-cookie').split(';')[0]
  const id = cookie.slice(15)
  return { dir, base, store, cookie, session: store.get(id), request: (path, options = {}) => fetch(`${base}/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...options.headers } }) }
}

test('sessions persist encrypted, cookies are HttpOnly, and credentials stay out of browser JSON', async (t) => {
  const ctx = await setup(t)
  ctx.session.biliCookie = 'SESSDATA=never-expose-this'
  ctx.session.user = { name: 'listener', mid: 1 }
  await ctx.store.save()
  const text = await (await ctx.request('/session')).text()
  assert.equal(text.includes('SESSDATA'), false); assert.equal(text.includes('token'), false)
  const encrypted = await readFile(join(ctx.dir, 'sessions.enc'))
  assert.equal(encrypted.includes(Buffer.from('never-expose-this')), false)
  const native = await ctx.request('/session', { headers: { 'X-Conova-Client': 'native' } })
  assert.equal(typeof (await native.json()).token, 'string')
})
test('cross-origin mutations and unauthenticated library writes are rejected', async (t) => {
  const ctx = await setup(t)
  assert.equal((await ctx.request('/auth/qr', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await ctx.request('/library', { method: 'POST', body: JSON.stringify({ kind: 'favorite', remoteId: 1, title: 'folder' }) })).status, 401)
  assert.equal((await ctx.request('/auth/desktop', { method: 'POST', body: JSON.stringify({ bridgeToken: 'forged' }) })).status, 403)
})
test('sync errors preserve the complete cached source and removal never changes Bilibili', async (t) => {
  let upstreamCalls = 0
  const ctx = await setup(t, async () => { upstreamCalls++; return new Response(JSON.stringify({ code: -412, message: 'try later' })) })
  ctx.session.user = { mid: 1 }; ctx.session.library = [{ id: 'favorite:10', kind: 'favorite', remoteId: 10, title: 'saved', tracks: [{ id: 'old' }] }]
  const synced = await (await ctx.request('/library/sync', { method: 'POST' })).json()
  assert.equal(synced.results[0].ok, false); assert.equal(synced.library[0].tracks[0].id, 'old')
  const callsBeforeRemove = upstreamCalls
  assert.equal((await ctx.request('/library/favorite%3A10', { method: 'DELETE' })).status, 200)
  assert.equal(ctx.session.library.length, 0); assert.equal(upstreamCalls, callsBeforeRemove)
})
test('proxy rejects arbitrary image hosts without fetching them', async (t) => {
  let calls = 0
  const ctx = await setup(t, async () => { calls++; throw new Error('must not be called') })
  assert.equal((await ctx.request('/image?url=https://127.0.0.1/secret')).status, 400); assert.equal(calls, 0)
})
test('audio tickets hide upstream URLs and preserve byte ranges and revoke on logout', async (t) => {
  const ctx = await setup(t, async (url, options) => {
    const parsed = new URL(url)
    if (parsed.hostname.endsWith('bilivideo.com')) {
      assert.equal(options.headers.Range, 'bytes=2-4')
      return new Response(Buffer.from('cde'), { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 2-4/6', 'Accept-Ranges': 'bytes', 'Content-Length': '3' } })
    }
    let data
    if (parsed.pathname.endsWith('/view')) data = { cid: 123, duration: 60, title: 'song' }
    else if (parsed.pathname.endsWith('/nav')) data = { isLogin: true, wbi_img: { img_url: `https://i0.hdslb.com/${'a'.repeat(32)}.png`, sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png` } }
    else data = { dash: { audio: [{ baseUrl: 'https://a.bilivideo.com/audio', bandwidth: 100 }] } }
    return new Response(JSON.stringify({ code: 0, data }))
  })
  const stream = await (await ctx.request('/track/BV1234567890')).json()
  assert.match(stream.url, /^\/api\/audio\/[a-f0-9]{64}$/); assert.equal(JSON.stringify(stream).includes('bilivideo'), false)
  const response = await fetch(`${ctx.base}${stream.url}`, { headers: { Range: 'bytes=2-4' } })
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-4/6'); assert.equal(await response.text(), 'cde')
  await ctx.request('/auth/logout', { method: 'POST' })
  assert.equal((await fetch(`${ctx.base}${stream.url}`)).status, 410)
})

function playbackApi(url, audio) {
  const parsed = new URL(url)
  assert.equal(parsed.hostname, 'api.bilibili.com')
  const data = parsed.pathname.endsWith('/view') ? { cid: 1, duration: 7200, title: 'Long audio' }
    : parsed.pathname.endsWith('/nav') ? { wbi_img: { img_url: `https://i0.hdslb.com/${'a'.repeat(32)}.png`, sub_url: `https://i0.hdslb.com/${'b'.repeat(32)}.png` } }
      : { dash: { audio: [audio] } }
  return new Response(JSON.stringify({ code: 0, data }))
}

for (const failure of ['network error', 'HTTP 403', 'ignored range', 'failed redirect']) {
  test(`audio uses partner backup after ${failure} and remembers it for the next seek`, async (t) => {
    const primary = 'https://first.example/music', backup = 'http://partner.example:8080/music'
    const attempts = []
    let unusedBodyCancelled = false
    const ctx = await setup(t, async (url, options) => {
      const host = new URL(url).hostname
      if (host === 'api.bilibili.com') return playbackApi(url, { baseUrl: primary, backupUrl: [backup] })
      attempts.push(String(url))
      assert.equal(options.headers.Cookie, undefined, 'account cookies must not reach media hosts or redirects')
      assert.equal(options.headers.Range, 'bytes=2-4')
      if (String(url) === primary) {
        if (failure === 'network error') throw new Error('CDN disconnected')
        if (failure === 'HTTP 403') return new Response('', { status: 403 })
        if (failure === 'failed redirect') return new Response(null, { status: 302, headers: { Location: 'file:///private' } })
        return new Response(new ReadableStream({ cancel() { unusedBodyCancelled = true } }), { status: 200 })
      }
      assert.equal(String(url), backup)
      return new Response('cde', { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '3', 'Content-Range': 'bytes 2-4/60000000', 'Accept-Ranges': 'bytes' } })
    })
    ctx.session.biliCookie = 'SESSDATA=account-only'
    const stream = await (await ctx.request('/track/BV1234567890')).json()
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`${ctx.base}${stream.url}`, { headers: { Range: 'bytes=2-4' } })
      assert.equal(response.status, 206)
      assert.equal(response.headers.get('content-range'), 'bytes 2-4/60000000')
      assert.equal(await response.text(), 'cde')
    }
    assert.deepEqual(attempts, [primary, backup, backup])
    if (failure === 'ignored range') assert.equal(unusedBodyCancelled, true)
  })
}

test('long recordings use bounded reads at the requested byte offset and keep the actual total', async (t) => {
  const ctx = await setup(t, async (url, options) => {
    if (new URL(url).hostname === 'api.bilibili.com') return playbackApi(url, { baseUrl: 'https://partner.example/audio' })
    assert.equal(options.headers.Range, 'bytes=60000000-62097151')
    return new Response('xyz', { status: 206, headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '3', 'Content-Range': 'bytes 60000000-60000002/115200044', 'Accept-Ranges': 'bytes' } })
  })
  const stream = await (await ctx.request('/track/BV1234567890')).json()
  const response = await fetch(`${ctx.base}${stream.url}`, { headers: { Range: 'bytes=60000000-' } })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 60000000-60000002/115200044')
  assert.equal(await response.text(), 'xyz')
})
