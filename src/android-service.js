import { registerPlugin } from '@capacitor/core'
import QRCode from 'qrcode'
import { createLocalService } from './local-service'

const bridge = registerPlugin('ConovaNative')
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
  media: { register: (options) => bridge.registerAudio(options), update: (options) => bridge.updateMedia(options), clear: () => bridge.clearMedia() },
  login: () => bridge.login(),
  clearLogin: () => bridge.clearLogin(),
  qrImage: (url) => QRCode.toDataURL(url, { width: 240, margin: 1, errorCorrectionLevel: 'M' }),
})

export const androidApi = service.request
export const androidLogin = service.accountLogin
export const androidMedia = {
  update: (options) => bridge.updateMedia(options),
  addListener: (event, callback) => bridge.addListener(event, callback),
}
