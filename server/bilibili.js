import { md5 } from '@noble/hashes/legacy.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36'
const MIXIN_ORDER = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]

export class BiliError extends Error {
  constructor(message, code = 502) { super(message); this.status = code }
}

export function signWbi(params, imageKey, subKey, timestamp = Math.floor(Date.now() / 1000)) {
  const combined = imageKey + subKey
  const key = MIXIN_ORDER.map((index) => combined[index]).join('').slice(0, 32)
  const signed = { ...params, wts: timestamp }
  const query = Object.keys(signed).sort().map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(String(signed[name]).replace(/[!'()*]/g, ''))}`).join('&')
  return `${query}&w_rid=${bytesToHex(md5(utf8ToBytes(query + key)))}`
}

export function normalizeTrack(item, fallbackArtist = '') {
  return {
    id: item.bvid || String(item.id || item.aid),
    bvid: item.bvid,
    title: item.title || '未命名视频',
    artist: item.upper?.name || item.owner?.name || fallbackArtist || 'Bilibili',
    cover: (item.cover || item.pic || '').replace(/^http:/, 'https:'),
    duration: Number(item.duration) || 0,
    unavailable: !item.bvid || item.title === '已失效视频',
  }
}

export class Bilibili {
  constructor(session, fetcher = fetch) { this.session = session; this.fetcher = fetcher }

  headers() {
    return { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com/', Cookie: this.session.biliCookie || '' }
  }

  async request(path, params = {}, { passport = false, nav = false } = {}) {
    const url = new URL(path, passport ? 'https://passport.bilibili.com' : 'https://api.bilibili.com')
    url.search = typeof params === 'string' ? params : new URLSearchParams(params).toString()
    let response
    try {
      response = await this.fetcher(url, { headers: this.headers(), signal: AbortSignal.timeout(18000) })
    } catch { throw new BiliError('暂时无法连接 B 站，请检查网络后重试。') }
    if (!response.ok) throw new BiliError(response.status === 412 ? 'B 站暂时限制了访问，请稍后重试。' : `B 站服务暂不可用（${response.status}）。`)
    let payload
    try { payload = await response.json() } catch { throw new BiliError('B 站返回了无法识别的数据，请稍后重试。') }
    if (payload.code !== 0 && !(nav && payload.code === -101)) {
      if (payload.code === -101) throw new BiliError('登录已过期，请重新连接 B 站。', 401)
      throw new BiliError(`B 站：${payload.message || payload.msg || '请求失败'}（${payload.code}）`)
    }
    return { data: payload.data, response }
  }

  async user() {
    const { data } = await this.request('/x/web-interface/nav', {}, { nav: true })
    if (!data?.isLogin) return null
    return { mid: data.mid, name: data.uname, avatar: data.face }
  }

  async qr() {
    const { data } = await this.request('/x/passport-login/web/qrcode/generate', { source: 'main-fe-header' }, { passport: true })
    this.session.qrKey = data.qrcode_key
    this.session.qrCreated = Date.now()
    return { url: data.url, expiresAt: Date.now() + 180000 }
  }

  async poll() {
    if (!this.session.qrKey) throw new BiliError('请先获取二维码。', 400)
    const { data, response } = await this.request('/x/passport-login/web/qrcode/poll', { qrcode_key: this.session.qrKey, source: 'main-fe-header' }, { passport: true })
    if (data.code !== 0) return { code: data.code, status: data.code === 86090 ? 'scanned' : data.code === 86038 ? 'expired' : 'waiting' }
    const cookies = new Map()
    for (const cookie of response.headers.getSetCookie()) {
      const value = cookie.split(';')[0]
      const split = value.indexOf('=')
      if (split > 0) cookies.set(value.slice(0, split), value.slice(split + 1))
    }
    if (data.url) {
      const redirect = new URL(data.url)
      for (const key of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5']) {
        if (!cookies.has(key) && redirect.searchParams.has(key)) cookies.set(key, redirect.searchParams.get(key))
      }
    }
    if (!cookies.get('SESSDATA')) throw new BiliError('B 站未返回有效登录凭据，请重新扫码。')
    const previous = this.session.biliCookie
    this.session.biliCookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
    try {
      const user = await this.user()
      if (!user) throw new BiliError('登录尚未完成，请重新扫码。', 401)
      this.session.user = user
      delete this.session.qrKey
      return { code: 0, status: 'success', user }
    } catch (error) { this.session.biliCookie = previous; throw error }
  }

  async sources() {
    const user = await this.user()
    if (!user) throw new BiliError('请先连接 B 站账号。', 401)
    this.session.user = user
    const { data } = await this.request('/x/v3/fav/folder/created/list-all', { up_mid: user.mid })
    const owned = (data?.list || []).map((item) => ({ id: `favorite:${item.id}`, remoteId: item.id, kind: 'favorite', group: 'owned', title: item.title, count: item.media_count, cover: item.cover || '', owner: user.name }))
    const followed = []
    for (let page = 1; page <= 500; page++) {
      const { data: collected } = await this.request('/x/v3/fav/folder/collected/list', { up_mid: user.mid, pn: page, ps: 20, platform: 'web' })
      for (const item of collected?.list || []) {
        if (item.state === 1) continue
        const kind = (Number(item.attr) & 2) !== 0 ? 'favorite' : 'season'
        followed.push({ id: `${kind}:${item.id}`, remoteId: item.id, kind, group: 'followed', title: item.title, count: item.media_count, cover: item.cover || '', owner: item.upper?.name || '' })
      }
      if (!collected?.has_more) break
      if (page === 500) throw new BiliError('来源数量过多，本次未完整加载，请稍后重试。')
    }
    return { owned, followed }
  }

  async tracks(kind, id) {
    if (!['favorite', 'season'].includes(kind) || !/^\d+$/.test(String(id))) throw new BiliError('无效的专辑来源。', 400)
    const tracks = []
    const seenPages = new Set()
    let info = null
    for (let page = 1; page <= 1000; page++) {
      const path = kind === 'favorite' ? '/x/v3/fav/resource/list' : '/x/space/fav/season/list'
      const params = { [kind === 'favorite' ? 'media_id' : 'season_id']: id, pn: page, ps: 20 }
      const { data } = await this.request(path, params)
      if (!info) info = data?.info || null
      const media = data?.medias || []
      if (!media.length) break
      const pageSignature = media.map((item) => item.bvid || item.id).join(',')
      if (seenPages.has(pageSignature)) throw new BiliError('B 站分页返回了重复内容，已保留原有专辑，请稍后重试。')
      seenPages.add(pageSignature)
      tracks.push(...media.map((item) => normalizeTrack(item, info?.upper?.name)))
      const total = data?.info?.media_count || 0
      if (data?.has_more === false || (total > 0 && tracks.length >= total) || (data?.has_more == null && !total && media.length < 20)) break
      if (page === 1000) throw new BiliError('专辑超过单次同步上限，本次未完整加载。')
    }
    return { info, tracks: [...new Map(tracks.map((track) => [track.id, track])).values()], syncedAt: Date.now() }
  }

  async audio(bvid) {
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new BiliError('无效的视频编号。', 400)
    const { data: video } = await this.request('/x/web-interface/view', { bvid })
    const { data: nav } = await this.request('/x/web-interface/nav', {}, { nav: true })
    const imageKey = new URL(nav.wbi_img.img_url).pathname.split('/').pop().split('.')[0]
    const subKey = new URL(nav.wbi_img.sub_url).pathname.split('/').pop().split('.')[0]
    const params = signWbi({ bvid, cid: video.cid, fnval: 16, fnver: 0, fourk: 1 }, imageKey, subKey)
    const { data } = await this.request('/x/player/wbi/playurl', params)
    const streams = [...(data?.dash?.audio || [])].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))
    if (!streams.length) throw new BiliError('该视频没有可用音频，可能已失效或需要额外权限。')
    for (const audio of streams) {
      const backups = [audio.backupUrl, audio.backup_url].flatMap((value) => Array.isArray(value) ? value : [])
      const urls = [...new Set([audio.baseUrl, audio.base_url, ...backups].map(normalizeMediaUrl).filter(Boolean))]
      // Prefer ordinary HTTPS, keeping every address from this representation
      // as a fallback, including Bilibili's partner CDNs and peer nodes.
      const rank = (value) => { const url = new URL(value); return url.protocol === 'https:' ? Number(Boolean(url.port)) : 2 }
      urls.sort((a, b) => rank(a) - rank(b))
      if (urls.length) return { url: urls[0], duration: video.duration, title: video.title, backups: urls.slice(1) }
    }
    throw new BiliError('B 站暂未返回可用的音频地址，请稍后重试。')
  }
}

export function isMediaUrl(url) {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname) && !parsed.username && !parsed.password
  } catch { return false }
}

export function normalizeMediaUrl(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = new URL(value)
    return isMediaUrl(parsed.href) ? parsed.href : null
  } catch { return null }
}

export function isImageHost(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && ['hdslb.com', 'biliimg.com'].some((host) => parsed.hostname.endsWith(`.${host}`))
  } catch { return false }
}
