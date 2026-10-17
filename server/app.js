import express from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomBytes } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { Bilibili, BiliError, isMediaHost, isImageHost } from './bilibili.js'
import { SessionStore } from './store.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function createApp({ dataDir = resolve(projectRoot, '.data'), fetcher = fetch, extraOrigins = [], desktopToken } = {}) {
  const store = await new SessionStore(dataDir).init()
  const app = express()
  const tickets = new Map()
  const inFlightSyncs = new Map()
  const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', 'https://localhost', 'capacitor://localhost', ...extraOrigins])
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const origin = req.headers.origin
    const selfOrigin = `${req.protocol}://${req.get('host')}`
    if (origin && origin !== selfOrigin && !allowedOrigins.has(origin)) return res.status(403).json({ error: '不允许的应用来源。' })
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Credentials', 'true') }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Conova-Client, Range')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, HEAD')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
  app.use(express.json({ limit: '24kb' }))
  app.get('/api/health', (req, res) => res.json({ ok: true, version: '0.1.0' }))
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/audio/') || req.path === '/image') return next()
    res.setHeader('Cache-Control', 'no-store')
    const bearer = req.headers.authorization?.replace(/^Bearer /, '')
    const cookieId = req.headers.cookie?.split(';').map((value) => value.trim()).find((value) => value.startsWith('conova_session='))?.slice(15)
    let id = bearer || cookieId
    let session = store.get(id)
    if (!session) {
      if (req.path !== '/session' || req.method !== 'GET') return res.status(401).json({ error: '会话已过期，请重新连接。' })
      ;({ id, session } = store.create())
      res.cookie('conova_session', id, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 30 * 86400000, path: '/' })
    }
    req.sessionId = id
    req.session = session
    req.bili = new Bilibili(session, fetcher)
    next()
  })
  app.get('/api/session', async (req, res) => {
    await store.save()
    res.json({ user: req.session.user || null, library: req.session.library || [], ...(req.get('X-Conova-Client') === 'native' ? { token: req.sessionId } : {}) })
  })
  app.post('/api/auth/qr', async (req, res) => {
    if (req.session.qrCreated && Date.now() - req.session.qrCreated < 3000) throw new BiliError('请稍等片刻再刷新二维码。', 429)
    const qr = await req.bili.qr()
    res.json({ ...qr, image: await QRCode.toDataURL(qr.url, { width: 240, margin: 1, errorCorrectionLevel: 'M' }) })
  })
  app.get('/api/auth/qr/status', async (req, res) => {
    if (req.session.lastPoll && Date.now() - req.session.lastPoll < 1500) throw new BiliError('扫码检查过于频繁。', 429)
    req.session.lastPoll = Date.now()
    const result = await req.bili.poll()
    if (result.status === 'success') await store.save()
    res.json(result)
  })
  app.post('/api/auth/desktop', async (req, res) => {
    if (!desktopToken || req.body?.bridgeToken !== desktopToken) throw new BiliError('该登录方式仅在 Windows 客户端中可用。', 403)
    const cookies = req.body.cookies
    if (typeof cookies !== 'string' || /[\r\n]/.test(cookies) || cookies.length > 12000) throw new BiliError('登录凭据无效。', 400)
    const previous = req.session.biliCookie
    req.session.biliCookie = cookies
    try {
      const user = await req.bili.user()
      if (!user) throw new BiliError('B 站登录尚未完成。', 401)
      req.session.user = user
      await store.save()
      res.json({ user })
    } catch (error) { req.session.biliCookie = previous; throw error }
  })
  app.post('/api/auth/logout', async (req, res) => {
    delete req.session.biliCookie
    delete req.session.user
    delete req.session.qrKey
    req.session.library = []
    for (const [ticket, value] of tickets) if (value.owner === req.sessionId) tickets.delete(ticket)
    await store.save()
    res.json({ ok: true })
  })
  app.get('/api/sources', async (req, res) => res.json(await req.bili.sources()))
  async function syncSource(req, source) {
    const key = `${req.sessionId}:${source.id}`
    if (inFlightSyncs.has(key)) return inFlightSyncs.get(key)
    const task = (async () => {
      const result = await req.bili.tracks(source.kind, source.remoteId)
      const record = { ...source, title: result.info?.title || source.title, count: result.tracks.length, tracks: result.tracks, syncedAt: result.syncedAt }
      const existing = req.session.library.findIndex((item) => item.id === record.id)
      if (existing >= 0) req.session.library[existing] = record
      else req.session.library.push(record)
      await store.save()
      return record
    })()
    inFlightSyncs.set(key, task)
    try { return await task } finally { inFlightSyncs.delete(key) }
  }
  app.post('/api/library', async (req, res) => {
    if (!req.session.user) throw new BiliError('请先连接 B 站。', 401)
    const { kind, remoteId, title, group, owner } = req.body || {}
    if (!['favorite', 'season'].includes(kind) || !/^\d+$/.test(String(remoteId)) || typeof title !== 'string' || title.length > 300) throw new BiliError('无效的专辑来源。', 400)
    const source = { id: `${kind}:${remoteId}`, kind, remoteId, title, group: group === 'owned' ? 'owned' : 'followed', owner: String(owner || '').slice(0, 100) }
    if (req.session.library.length >= 100 && !req.session.library.some((item) => item.id === source.id)) throw new BiliError('最多可添加 100 个来源。', 400)
    res.json(await syncSource(req, source))
  })
  app.post('/api/library/sync', async (req, res) => {
    if (!req.session.user) throw new BiliError('请先连接 B 站。', 401)
    const results = []
    for (const source of [...req.session.library]) {
      try { results.push({ id: source.id, ok: true, source: await syncSource(req, source) }) }
      catch (error) { results.push({ id: source.id, ok: false, error: error.message }) }
    }
    res.json({ results, library: req.session.library })
  })
  app.delete('/api/library/:id', async (req, res) => {
    req.session.library = req.session.library.filter((item) => item.id !== req.params.id)
    await store.save()
    res.json({ ok: true })
  })
  app.get('/api/track/:bvid', async (req, res) => {
    const result = await req.bili.audio(req.params.bvid)
    if (!isMediaHost(result.url)) throw new BiliError('音频地址不属于受支持的 B 站媒体服务。')
    for (const [ticket, value] of tickets) if (value.expiresAt < Date.now()) tickets.delete(ticket)
    if (tickets.size > 1000) tickets.delete(tickets.keys().next().value)
    const ticket = randomBytes(32).toString('hex')
    tickets.set(ticket, { ...result, owner: req.sessionId, cookie: req.session.biliCookie, expiresAt: Date.now() + 2 * 3600000 })
    res.json({ url: `/api/audio/${ticket}`, duration: result.duration })
  })
  async function mediaFetch(url, options, validator, redirects = 0) {
    if (!validator(url) || redirects > 3) throw new BiliError('媒体地址无效。', 400)
    const upstream = await fetcher(url, { ...options, redirect: 'manual' })
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get('location')
      await upstream.body?.cancel()
      if (!location) throw new BiliError('媒体重定向无效。')
      return mediaFetch(new URL(location, url).href, options, validator, redirects + 1)
    }
    return upstream
  }
  app.get('/api/audio/:ticket', async (req, res) => {
    const ticket = tickets.get(req.params.ticket)
    if (!ticket || ticket.expiresAt < Date.now() || !store.get(ticket.owner)) throw new BiliError('播放地址已过期，请重新播放。', 410)
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    const headers = { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0', Cookie: ticket.cookie || '' }
    if (req.headers.range) headers.Range = req.headers.range
    const upstream = await mediaFetch(ticket.url, { headers, method: req.method === 'HEAD' ? 'HEAD' : 'GET', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) }, isMediaHost)
    if (![200, 206, 416].includes(upstream.status)) throw new BiliError('音频连接中断，请重新点击播放。')
    res.status(upstream.status)
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (upstream.headers.has(header)) res.setHeader(header, upstream.headers.get(header))
    res.setHeader('Cache-Control', 'private, no-store')
    if (!upstream.body || req.method === 'HEAD') return res.end()
    try { await pipeline(Readable.fromWeb(upstream.body), res) } catch (error) { if (!controller.signal.aborted) throw error }
  })
  app.get('/api/image', async (req, res) => {
    const upstream = await mediaFetch(String(req.query.url || ''), { headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }, isImageHost)
    if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('image/')) throw new BiliError('封面暂时无法加载。')
    res.setHeader('Content-Type', upstream.headers.get('content-type'))
    res.setHeader('Cache-Control', 'public, max-age=86400')
    await pipeline(Readable.fromWeb(upstream.body), res)
  })
  app.use(express.static(resolve(projectRoot, 'dist')))
  app.get('/{*path}', (req, res, next) => req.path.startsWith('/api/') ? res.status(404).json({ error: '接口不存在。' }) : res.sendFile(resolve(projectRoot, 'dist/index.html'), (error) => error && next(error)))
  app.use((error, req, res, next) => {
    if (res.headersSent) return res.end()
    res.status(error.status || 502).json({ error: error instanceof BiliError ? error.message : '服务暂不可用，请稍后重试。' })
  })
  return { app, store }
}
