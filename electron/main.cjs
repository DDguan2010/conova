const { app, BrowserWindow, ipcMain, session, shell } = require('electron')
const { join } = require('node:path')
const { randomBytes } = require('node:crypto')
const { pathToFileURL } = require('node:url')

let mainWindow, server, origin, loginWindow
const bridgeToken = randomBytes(32).toString('hex')
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })

const isOfficial = (value) => { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) } catch { return false } }
const validateSender = (event) => { if (!mainWindow || event.sender !== mainWindow.webContents || new URL(event.senderFrame.url).origin !== origin) throw new Error('Invalid IPC sender') }

async function start() {
  const { createApp } = await import(pathToFileURL(join(__dirname, '../server/app.js')).href)
  const { app: service } = await createApp({ dataDir: join(app.getPath('userData'), 'data'), desktopToken: bridgeToken })
  server = await new Promise((resolve, reject) => { const listener = service.listen(0, '127.0.0.1', () => resolve(listener)); listener.on('error', reject) })
  origin = `http://127.0.0.1:${server.address().port}`
  mainWindow = new BrowserWindow({ width: 1440, height: 940, minWidth: 370, minHeight: 680, backgroundColor: '#000000', title: 'Conova', icon: join(__dirname, '../build/icon.png'), autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (isOfficial(url)) shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault() })
  mainWindow.on('closed', () => { mainWindow = null; loginWindow?.destroy() })
  await mainWindow.loadURL(origin)
}

ipcMain.handle('conova:login', async (event) => {
  validateSender(event)
  if (loginWindow) { loginWindow.focus(); return { cancelled: true } }
  const loginSession = session.fromPartition('persist:conova-bilibili')
  return new Promise((resolve) => {
    let completed = false, checking = false
    loginWindow = new BrowserWindow({ width: 1024, height: 760, backgroundColor: '#fff', title: '哔哩哔哩 · 账号登录', autoHideMenuBar: true, webPreferences: { partition: 'persist:conova-bilibili', nodeIntegration: false, contextIsolation: true, sandbox: true } })
    loginWindow.webContents.setWindowOpenHandler(({ url }) => { if (isOfficial(url)) shell.openExternal(url); return { action: 'deny' } })
    loginWindow.webContents.on('will-navigate', (navigation, url) => { if (!isOfficial(url)) navigation.preventDefault() })
    const check = async () => {
      if (completed || checking) return
      checking = true
      try {
        const cookies = await loginSession.cookies.get({ domain: '.bilibili.com' })
        if (!cookies.some((cookie) => cookie.name === 'SESSDATA' && cookie.value)) return
        const appCookies = await mainWindow.webContents.session.cookies.get({ url: origin, name: 'conova_session' })
        const response = await fetch(`${origin}/api/auth/desktop`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: appCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') }, body: JSON.stringify({ cookies: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '), bridgeToken }) })
        if (!response.ok) return
        completed = true
        clearInterval(timer)
        loginWindow?.destroy(); loginWindow = null
        resolve({ ok: true })
      } finally { checking = false }
    }
    const timer = setInterval(() => { check().catch(() => {}) }, 2000)
    loginWindow.on('closed', () => { clearInterval(timer); loginWindow = null; if (!completed) { completed = true; resolve({ cancelled: true }) } })
    loginWindow.loadURL('https://passport.bilibili.com/login').catch(() => {})
  })
})
ipcMain.handle('conova:clearLogin', async (event) => { validateSender(event); await session.fromPartition('persist:conova-bilibili').clearStorageData(); return true })
app.whenReady().then(start).catch((error) => { console.error(error); app.quit() })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { server?.closeAllConnections(); server?.close() })
