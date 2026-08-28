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
  // CI 時自動起 server；本地維持手動（避免每次跑 e2e 都重啟）
  //
  // 2026-08-29：從 `pnpm dev` 改成 production build 的 node server，兩個理由 ——
  //
  //   ① 跟本地與視覺基線用同一種產物。dev 的 vite-node 會 IPC crash 讓 /admin/* 回 500
  //      （見 tests/e2e/visual/baseline.spec.ts 檔頭），那是 dev 基礎設施不穩、不是應用壞，
  //      但在 CI 上會變成查不出原因的紅。
  //   ② **不再設 NUXT_PUBLIC_TEST_MODE=T**。那個 env 不只 auth plugin 在看 ——
  //      `app/protocol/fetch-api/api/{order,auth,file}/index.ts` 的 `IsMock()` 也看它，
  //      為 T 時整層 API 直接回罐頭資料、**完全不發網路請求**，於是 fixture 的
  //      `page.route('**/nuxt-api/**')` 全部形同虛設，測到的不是真的行為。
  //      身分 mock 改為只靠 fixture 注入的 `window.__E2E_MODE__`（auth.client.ts 本來就吃）。
  webServer: process.env.CI
    ? {
        command: 'node .output/server/index.mjs',
        url: 'http://localhost:3000',
        timeout: 120_000,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { PORT: '3000' },
      }
    : undefined,
});
