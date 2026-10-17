import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/ui', timeout: 30000, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', channel: 'msedge', headless: true, screenshot: 'only-on-failure', launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30000 },
})
