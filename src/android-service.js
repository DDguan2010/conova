import { registerPlugin } from '@capacitor/core'
import QRCode from 'qrcode'
import { createLocalService } from './local-service'

const bridge = registerPlugin('ConovaNative')
let nativeMediaActive = false
const updateMedia = (options) => {
  if (options?.playing) nativeMediaActive = true
  if (!options?.playing && !nativeMediaActive) return undefined
  return bridge.updateMedia(options)
}
const service = createLocalService({
  storage: {
    read: async () => { const { value } = await bridge.readState(); return value ? JSON.parse(value) : null },
    write: async (value) => { await bridge.writeState({ value }) },
  },
  fetcher: async (url, options) => {
    options.signal?.throwIfAborted()
    const result = await bridge.request({ url: String(url), headers: options.headers })
    options.signal?.throwIfAborted()
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => JSON.parse(result.data), headers: { getSetCookie: () => result.setCookies || [] } }
  },
  media: { register: (options) => bridge.registerAudio(options), update: updateMedia, clear: () => { nativeMediaActive = false; return bridge.clearMedia() } },
  login: () => bridge.login(),
  clearLogin: () => bridge.clearLogin(),
  qrImage: (url) => QRCode.toDataURL(url, { width: 240, margin: 1, errorCorrectionLevel: 'M' }),
})

export const androidApi = service.request
export const androidLogin = service.accountLogin
export const androidMedia = {
  update: updateMedia,
  addListener: (event, callback) => bridge.addListener(event, callback),
}
