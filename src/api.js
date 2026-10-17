import { Capacitor } from '@capacitor/core'
import { isImageHost } from '../server/bilibili.js'

export const native = Capacitor.getPlatform() === 'android'
export const canAccountLogin = native || Boolean(window.conova?.login)
const base = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
const local = native ? import('./android-service') : null
export async function accountLogin() { return native ? (await local).androidLogin() : window.conova.login() }
export function mediaUrl(path) { return !native && path?.startsWith('/api/') ? `${base}${path}` : path }
export function coverUrl(url) {
  if (!url || url.startsWith('/') || url.startsWith('data:')) return url
  const image = url.replace(/^http:/, 'https:')
  if (native) return isImageHost(image) ? `/__conova/image?url=${encodeURIComponent(image)}` : ''
  return `${base}/api/image?url=${encodeURIComponent(image)}`
}
export async function api(path, { method = 'GET', body, signal } = {}) {
  if (native) return (await local).androidApi(path, { method, body, signal })
  let result
  try { result = await fetch(`${base}/api${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal }) }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('无法连接 Conova 服务，请检查网络后重试。') }
  let data
  try { data = await result.json() } catch { throw new Error('Conova 服务没有响应，请稍后重试。') }
  if (!result.ok) { const error = new Error(data.error || '操作未完成，请重试。'); error.status = result.status; throw error }
  return data
}
