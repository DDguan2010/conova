import { test, expect } from '@playwright/test'

async function holdCover(page) {
  const cover = page.getByTestId('current-cover')
  await expect(cover).toBeVisible()
  const rect = await cover.boundingBox()
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up()
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible()
}
async function swipe(page, dx, dy) {
  const rect = await page.getByTestId('current-cover').boundingBox()
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 9 })
  await page.mouse.up()
}

test('normal canvas has no text or playback icons and audio overlays stay within the square', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?demo=1')
  const cover = page.getByTestId('current-cover')
  await expect(cover).toHaveCount(1)
  await expect(page.locator('main')).toHaveText('')
  await expect(page.locator('svg')).toHaveCount(0)
  await cover.hover()
  await expect(page.locator('main')).toHaveText('')
  await expect(page.getByRole('button', { name: /^(播放|暂停|上一首|下一首)$/ })).toHaveCount(0)
  const progress = page.getByRole('slider', { name: '播放进度' })
  const coverBox = await cover.boundingBox(), progressBox = await progress.boundingBox()
  expect(progressBox.y).toBeGreaterThan(coverBox.y)
  expect(progressBox.y + progressBox.height).toBeLessThanOrEqual(coverBox.y + coverBox.height + .5)
  await expect(page.locator('.cover-audio')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await cover.click()
  await expect(page.locator('.app')).toHaveClass(/playing/)
  await expect(progress).not.toHaveValue('0')
  await progress.fill('12')
  await page.waitForTimeout(400)
  await page.screenshot({ path: '.artifacts/minimal-player-desktop.png' })
  await cover.click()
  await expect(page.locator('.app')).toHaveClass(/paused/)
  await expect.poll(() => page.locator('.tile.active').evaluate((node) => getComputedStyle(node).filter)).toBe('grayscale(1)')
  expect(errors).toEqual([])
})

test('scrubbing a two-hour recording previews continuously and performs one seek on release', async ({ page }) => {
  const seconds = 7200, sampleRate = 8000, total = 44 + seconds * sampleRate * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(total - 8, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(total - 44, 40)
  const ranges = []
  await page.addInitScript(() => {
    window.seekAssignments = []
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...descriptor, set(value) { window.seekAssignments.push(value); descriptor.set.call(this, value) } })
    const Audio = window.Audio
    window.Audio = function (...args) { const element = new Audio(...args); window.playbackProbe = element; return element }
    window.Audio.prototype = Audio.prototype
  })
  const track = { id: 'long', bvid: 'BV1234567890', title: 'Long recording', artist: 'Test', cover: '/covers/0.jpg', duration: seconds }
  await page.route('**/api/session', (route) => route.fulfill({ json: { user: { mid: 1 }, library: [{ id: 'favorite:1', title: 'Long', tracks: [track] }] } }))
  await page.route('**/api/track/*', (route) => route.fulfill({ json: { url: '/api/audio/long-test', duration: seconds } }))
  await page.route('**/api/audio/long-test', async (route) => {
    const range = route.request().headers().range || 'bytes=0-'
    const match = /bytes=(\d+)-(\d*)/.exec(range)
    const start = Number(match?.[1] || 0), end = Math.min(start + 256 * 1024 - 1, match?.[2] ? Number(match[2]) : total - 1, total - 1)
    ranges.push({ start, end })
    const body = Buffer.alloc(end - start + 1)
    if (start < header.length) header.copy(body, 0, start, Math.min(header.length, end + 1))
    await route.fulfill({ status: 206, headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(body.length), 'Content-Range': `bytes ${start}-${end}/${total}`, 'Accept-Ranges': 'bytes' }, body })
  })
  await page.goto('/')
  await page.getByTestId('current-cover').click()
  await expect(page.locator('.app')).toHaveClass(/playing/)
  await expect.poll(() => page.evaluate(() => window.playbackProbe.duration)).toBe(seconds)
  await page.waitForTimeout(700)
  const slider = page.getByRole('slider', { name: '播放进度' }), rect = await slider.boundingBox()
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * .75, rect.y + rect.height / 2, { steps: 18 })
  expect(await page.evaluate(() => window.seekAssignments.length)).toBe(0)
  expect(Number(await slider.inputValue())).toBeGreaterThan(5000)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.seekAssignments.length)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.playbackProbe.seeking)).toBe(false)
  expect(await page.evaluate(() => window.playbackProbe.currentTime)).toBeGreaterThan(5000)
  expect(ranges.some(({ start }) => start > 60_000_000)).toBe(true)
  await expect(page.locator('main')).toHaveText('')
})

test('long press scatters covers to plain text settings, single mode returns to textless canvas', async ({ page }) => {
  await page.goto('/?demo=1')
  await holdCover(page)
  await page.waitForTimeout(700)
  await expect(page.locator('h1,h2,h3,.view-description,.eyebrow')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '管理专辑', exact: true })).toBeVisible()
  await page.screenshot({ path: '.artifacts/minimal-settings-desktop.png' })
  await page.getByRole('button', { name: '单曲循环', exact: true }).click()
  await expect(page.locator('.app')).toHaveClass(/single-mode/)
  await expect(page.locator('main')).toHaveText('')
  await page.waitForTimeout(700)
  const center = await page.getByTestId('current-cover').boundingBox()
  const viewport = page.viewportSize()
  expect(Math.abs(center.x + center.width / 2 - viewport.width / 2)).toBeLessThan(1)
  expect(Math.abs(center.y + center.height / 2 - viewport.height / 2)).toBeLessThan(1)
  await holdCover(page)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('slider', { name: '音量', exact: true })).toBeVisible()
  await page.getByRole('slider', { name: '音量', exact: true }).fill('0.3')
  await expect(page.getByRole('slider', { name: '音量', exact: true })).toHaveValue('0.3')
})

test('phone swipes switch songs and albums with no text or chrome', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=1')
  await page.getByTestId('current-cover').click()
  await expect(page.locator('.app')).toHaveClass(/playing/)
  await expect(page.getByTestId('current-cover')).toHaveAttribute('aria-label', /凌晨四点/)
  await swipe(page, -85, 0)
  await expect(page.getByTestId('current-cover')).toHaveAttribute('aria-label', /缓慢经过/)
  await page.waitForTimeout(650)
  await swipe(page, 0, -90)
  await expect(page.getByTestId('current-cover')).toHaveAttribute('aria-label', /^After the rain/)
  await expect(page.locator('main')).toHaveText('')
  await page.waitForTimeout(650)
  await page.screenshot({ path: '.artifacts/minimal-player-phone.png' })
  await holdCover(page)
  await page.getByRole('button', { name: '管理专辑', exact: true }).click()
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
})

test('first entry contains only login choices, QR errors stay in the center', async ({ page }) => {
  await page.route('**/api/auth/qr', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'B 站暂时无法连接。' }) }))
  await page.goto('/')
  await expect(page.locator('main')).toHaveText('扫码登录')
  await page.waitForTimeout(700)
  await page.screenshot({ path: '.artifacts/minimal-welcome.png' })
  await page.getByRole('button', { name: '扫码登录' }).click()
  await expect(page.getByRole('status')).toHaveText('B 站暂时无法连接。')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.locator('main')).toHaveText('扫码登录')
})

test('rapid swipe reversal and returning mid-scatter preserve continuous tile motion', async ({ page }) => {
  await page.goto('/?demo=1')
  await expect(page.getByTestId('current-cover')).toHaveAttribute('aria-label', /^凌晨四点/)
  await page.waitForTimeout(150)
  await page.evaluate(() => {
    const tile = document.querySelector('[data-testid="current-cover"]').closest('.tile')
    const probe = { tile, frames: [], running: true }
    window.motionProbe = probe
    const sample = (time) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(tile).transform)
      probe.frames.push({ time, x: matrix.m41, y: matrix.m42 })
      if (probe.running) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await swipe(page, -100, 0)
  await expect(page.getByTestId('current-cover')).toHaveAttribute('aria-label', /^缓慢经过/)
  await swipe(page, 100, 0)
  await expect(page.getByTestId('current-cover')).toHaveAttribute('aria-label', /^凌晨四点/)
  // Open while the grid is still moving, then reverse the scatter before it settles.
  await page.getByTestId('current-cover').dispatchEvent('contextmenu')
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible()
  await page.waitForTimeout(75)
  const offset = await page.evaluate(() => {
    const { tile } = window.motionProbe
    const rect = tile.getBoundingClientRect()
    return Math.hypot(rect.x + rect.width / 2 - innerWidth / 2, rect.y + rect.height / 2 - innerHeight / 2)
  })
  expect(offset).toBeGreaterThan(20)
  await page.keyboard.press('Escape')
  await expect(page.locator('main')).toHaveText('')
  await page.waitForTimeout(1000)
  const report = await page.evaluate(() => {
    const probe = window.motionProbe
    probe.running = false
    let maxSpeed = 0
    for (let i = 1; i < probe.frames.length; i++) {
      const a = probe.frames[i - 1], b = probe.frames[i]
      maxSpeed = Math.max(maxSpeed, Math.hypot(b.x - a.x, b.y - a.y) / Math.max(8, b.time - a.time))
    }
    const rect = probe.tile.getBoundingClientRect()
    return { maxSpeed, frames: probe.frames.length, connected: probe.tile.isConnected, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 }
  })
  expect(report.frames).toBeGreaterThan(25)
  expect(report.connected).toBe(true)
  expect(report.maxSpeed).toBeLessThan(9.5)
  expect(Math.abs(report.centerX - page.viewportSize().width / 2)).toBeLessThan(1)
  expect(Math.abs(report.centerY - page.viewportSize().height / 2)).toBeLessThan(1)
})
