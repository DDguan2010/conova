import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

export class SessionStore {
  constructor(directory) { this.directory = directory; this.sessions = new Map(); this.pending = Promise.resolve() }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try { this.key = await readFile(join(this.directory, 'session.key')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.key = randomBytes(32)
      await writeFile(join(this.directory, 'session.key'), this.key, { mode: 0o600, flag: 'wx' })
    }
    try {
      const encrypted = await readFile(join(this.directory, 'sessions.enc'))
      const decipher = createDecipheriv('aes-256-gcm', this.key, encrypted.subarray(0, 12))
      decipher.setAuthTag(encrypted.subarray(12, 28))
      const contents = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()])
      for (const [id, session] of JSON.parse(contents.toString())) {
        if (session.expiresAt > Date.now()) this.sessions.set(id, session)
      }
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('本地会话文件无法解密，请先备份并检查数据目录。') }
    return this
  }
  get(id) {
    const session = this.sessions.get(id)
    if (session?.expiresAt > Date.now()) return session
    if (session) this.sessions.delete(id)
    return null
  }
  create() {
    const id = randomBytes(32).toString('hex')
    const session = { expiresAt: Date.now() + 30 * 86400000, library: [] }
    this.sessions.set(id, session)
    return { id, session }
  }
  save() {
    this.pending = this.pending.catch(() => {}).then(async () => {
      for (const [id, value] of this.sessions) if (value.expiresAt < Date.now()) this.sessions.delete(id)
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
      const encrypted = Buffer.concat([cipher.update(JSON.stringify([...this.sessions])), cipher.final()])
      const file = join(this.directory, 'sessions.enc')
      await writeFile(`${file}.tmp`, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]), { mode: 0o600 })
      await rename(`${file}.tmp`, file)
    })
    return this.pending
  }
}
