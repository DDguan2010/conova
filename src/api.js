import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

export const native = Capacitor.isNativePlatform()
let nativeToken = ''
let base = (localStorage.getItem('conova.service') || import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
if (native) nativeToken = (await Preferences.get({ key: 'conova.session' })).value || ''
export const serviceBase = () => base
export function setServiceBase(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname))) throw new Error('请输入 HTTPS 服务地址。')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('服务地址只需包含域名和端口。')
  base = url.origin
  localStorage.setItem('conova.service', base)
  nativeToken = ''
  if (native) Preferences.remove({ key: 'conova.session' })
}
export function mediaUrl(path) { return path?.startsWith('/api/') ? `${base}${path}` : path }
export function coverUrl(url) {
  if (!url || url.startsWith('/') || url.startsWith('data:')) return url
  return `${base}/api/image?url=${encodeURIComponent(url.replace(/^http:/, 'https:'))}`
}
export async function api(path, { method = 'GET', body, signal } = {}) {
  if (native && !base) throw new Error('请先设置你的 Conova 服务地址。')
  const headers = { 'Content-Type': 'application/json', ...(native ? { 'X-Conova-Client': 'native', ...(nativeToken ? { Authorization: `Bearer ${nativeToken}` } : {}) } : {}) }
  let data, status
  if (native) {
    const result = await CapacitorHttp.request({ url: `${base}/api${path}`, method, headers, data: body, connectTimeout: 20000, readTimeout: 180000, responseType: 'json' })
    data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
    status = result.status
  } else {
    let result
    try { result = await fetch(`${base}/api${path}`, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body), signal }) }
    catch (error) { if (error.name === 'AbortError') throw error; throw new Error('无法连接 Conova 服务，请检查网络后重试。') }
    status = result.status
    try { data = await result.json() } catch { throw new Error('Conova 服务没有响应，请检查服务地址。') }
  }
  if (status < 200 || status >= 300) { const error = new Error(data.error || '操作未完成，请重试。'); error.status = status; throw error }
  if (data.token && native) { nativeToken = data.token; await Preferences.set({ key: 'conova.session', value: data.token }) }
  return data
}
