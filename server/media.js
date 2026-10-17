// Keep open-ended media reads small so a seek does not leave a whole long
// recording downloading at the old position. The CDN supplies the real total.
export const AUDIO_CHUNK_SIZE = 2 * 1024 * 1024

export function audioRange(value) {
  if (typeof value !== 'string' || !/^bytes=(?:\d{1,20}-\d{0,20}|-\d{1,20})$/.test(value)) return null
  const match = /^bytes=(\d+)-(\d*)$/.exec(value)
  if (!match) return value
  const start = BigInt(match[1]), limit = start + BigInt(AUDIO_CHUNK_SIZE - 1)
  const end = match[2] ? BigInt(match[2]) : limit
  return `bytes=${start}-${end < limit ? end : limit}`
}
