import { Bilibili, BiliError } from '../server/bilibili.js'

// Android shares the desktop's Bilibili operations. Only networking, private
// storage and the official login page cross the native bridge.
export function createLocalService({ storage, fetcher, media, login, clearLogin, qrImage, now = Date.now }) {
  const session = { library: [] }
  const bili = new Bilibili(session, fetcher)
  const pending = new Map()
  const ready = storage.read().then((saved) => {
    if (saved) {
      session.biliCookie = saved.biliCookie || ''
      session.user = saved.user || null
      session.library = Array.isArray(saved.library) ? saved.library : []
    }
  })
  let writes = Promise.resolve()
  let epoch = 0
  const save = () => {
    const snapshot = JSON.stringify({ biliCookie: session.biliCookie || '', user: session.user || null, library: session.library })
    writes = writes.catch(() => {}).then(() => storage.write(snapshot))
    return writes
  }
  const authenticated = () => { if (!session.user) throw new BiliError('请先连接 B 站。', 401) }
  async function sync(source) {
    if (pending.has(source.id)) return pending.get(source.id)
    const version = epoch
    const task = (async () => {
      const result = await bili.tracks(source.kind, source.remoteId)
      if (epoch !== version) throw new BiliError('登录状态已改变，请重新操作。', 401)
      const record = { ...source, title: result.info?.title || source.title, count: result.tracks.length, tracks: result.tracks, syncedAt: result.syncedAt }
      const index = session.library.findIndex((item) => item.id === record.id)
      if (index >= 0) session.library[index] = record
      else session.library.push(record)
      await save()
      return record
    })()
    pending.set(source.id, task)
    try { return await task } finally { pending.delete(source.id) }
  }
  async function request(path, { method = 'GET', body, signal } = {}) {
    await ready
    signal?.throwIfAborted()
    const url = new URL(path, 'https://conova.local')
    if (path === '/session' && method === 'GET') return { user: session.user || null, library: structuredClone(session.library) }
    if (path === '/auth/qr' && method === 'POST') {
      if (session.qrCreated && now() - session.qrCreated < 3000) throw new BiliError('请稍等片刻再刷新二维码。', 429)
      const qr = await bili.qr()
      return { ...qr, image: await qrImage(qr.url) }
    }
    if (path === '/auth/qr/status' && method === 'GET') {
      if (session.lastPoll && now() - session.lastPoll < 1500) throw new BiliError('扫码检查过于频繁。', 429)
      session.lastPoll = now()
      const version = epoch
      const result = await bili.poll()
      if (epoch !== version) { delete session.biliCookie; delete session.user; throw new BiliError('登录已取消。', 401) }
      if (result.status === 'success') await save()
      return result
    }
    if (path === '/auth/logout' && method === 'POST') {
      epoch++
      delete session.biliCookie; delete session.user; delete session.qrKey
      session.library = []
      await media.clear()
      await clearLogin()
      await save()
      return { ok: true }
    }
    if (path === '/sources' && method === 'GET') {
      const result = await bili.sources()
      await save()
      return result
    }
    if (path === '/library' && method === 'POST') {
      authenticated()
      const { kind, remoteId, title, group, owner } = body || {}
      if (!['favorite', 'season'].includes(kind) || !/^\d+$/.test(String(remoteId)) || typeof title !== 'string' || title.length > 300) throw new BiliError('无效的专辑来源。', 400)
      const source = { id: `${kind}:${remoteId}`, kind, remoteId, title, group: group === 'owned' ? 'owned' : 'followed', owner: String(owner || '').slice(0, 100) }
      if (session.library.length >= 100 && !session.library.some((item) => item.id === source.id)) throw new BiliError('最多可添加 100 个来源。', 400)
      return sync(source)
    }
    if (path === '/library/sync' && method === 'POST') {
      authenticated()
      const results = []
      for (const source of [...session.library]) {
        try { results.push({ id: source.id, ok: true, source: await sync(source) }) }
        catch (error) { results.push({ id: source.id, ok: false, error: error.message }) }
      }
      return { results, library: structuredClone(session.library) }
    }
    if (url.pathname.startsWith('/library/') && method === 'DELETE') {
      authenticated()
      const id = decodeURIComponent(url.pathname.slice('/library/'.length))
      if (pending.has(id)) await pending.get(id).catch(() => {})
      session.library = session.library.filter((item) => item.id !== id)
      await save()
      return { ok: true }
    }
    if (url.pathname.startsWith('/track/') && method === 'GET') {
      authenticated()
      const version = epoch
      const result = await bili.audio(url.pathname.slice('/track/'.length))
      signal?.throwIfAborted()
      if (epoch !== version) throw new BiliError('登录状态已改变，请重新操作。', 401)
      const { url: localUrl } = await media.register({ url: result.url, backups: result.backups })
      return { url: localUrl, duration: result.duration }
    }
    throw new BiliError('接口不存在。', 404)
  }
  async function accountLogin() {
    await ready
    const result = await login()
    if (result.cancelled) return result
    const previous = session.biliCookie
    try {
      if (!result.cookies || !/(?:^|;\s*)SESSDATA=/.test(result.cookies)) throw new BiliError('B 站登录尚未完成。', 401)
      session.biliCookie = result.cookies
      const user = await bili.user()
      if (!user) throw new BiliError('B 站登录尚未完成。', 401)
      session.user = user
      await save()
      return { ok: true, user }
    } catch (error) { session.biliCookie = previous; throw error }
  }
  return { request, accountLogin }
}
