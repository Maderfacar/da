import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },        // 393×851, Chrome 最常見 Android 機型
    },
    {
      name: 'iphone-14',
      use: { ...devices['iPhone 14'] },      // 390×844, Safari Mobile
    },
  ],
  // CI 時自動起 dev server；本地維持手動（避免每次跑 e2e 都 reload dev）
  // CI workflow 內已預先寫好 minimal .env.dev（NUXT_PUBLIC_TEST_MODE=T）
  webServer: process.env.CI
    ? {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        timeout: 120_000,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
});
