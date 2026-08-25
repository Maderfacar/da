// 視覺回歸基線（W0.2）
//
// 目的：全站 49% 的程式碼是 <style>（26,593 / 54,733 行），而既有 610+ 測試全是邏輯測試。
// 動全站色彩而無截圖比對，破圖會靜默發生。這組基線就是那道防護網。
//
// 用法（**對 production build 拍，不要用 dev server**）：
//   1. `pnpm build`
//   2. `PORT=3000 node .output/server/index.mjs`
//   3. 產生／更新基線：`npx playwright test tests/e2e/visual --update-snapshots`
//   4. 比對：`npx playwright test tests/e2e/visual`
//
// 為什麼不用 dev server：實測 dev 的 vite-node 會 IPC crash，讓 /admin/* 回 500
// （production build 同一路徑是 200）。那是 dev 基礎設施的不穩定，不是應用的錯，
// 但會污染基線。順帶好處：prod server 沒有隨編譯，整輪從 2.7 分鐘降到 45 秒。
//
// 換色票後預期「全部 diff」—— 那不是失敗，是要逐張人工確認「變得對」後才接受新基線。
//
// 身分沿用 tests/e2e/auth/fixtures.ts 的 mock（不打真實 Firebase / LINE）。
import { test, expect } from '../auth/fixtures';
import type { Page } from '@playwright/test';

// 司機端沒有定位權限就會被「需要位置權限」全屏彈窗蓋住，整張基線只剩那個 modal。
// 預先授權 + 給一個固定座標（台北車站），讓畫面穩定且拍得到底下的實際 UI。
test.use({
  permissions: ['geolocation'],
  geolocation: { latitude: 25.0478, longitude: 121.5170 },
});

type Identity = 'passenger' | 'driverApproved' | 'adminWith2fa';

interface VisualTarget {
  /** 截圖檔名（不含副檔名與 project 後綴） */
  name: string;
  path: string;
  identity: Identity;
}

const TARGETS: readonly VisualTarget[] = [
  // ── 乘客端 ────────────────────────────────────────────────
  { name: 'passenger-landing', path: '/', identity: 'passenger' },
  { name: 'passenger-booking', path: '/booking', identity: 'passenger' },
  { name: 'passenger-orders', path: '/orders', identity: 'passenger' },
  { name: 'passenger-fare', path: '/fare', identity: 'passenger' },
  // 註：沒有 /vehicles 列表頁（只有 /vehicles/[driverId]）；/home 是登入後的乘客首頁
  { name: 'passenger-home', path: '/home', identity: 'passenger' },
  // ── 司機端 ────────────────────────────────────────────────
  { name: 'driver-dashboard', path: '/driver/dashboard', identity: 'driverApproved' },
  { name: 'driver-trip', path: '/driver/trip', identity: 'driverApproved' },
  // ── 管理端 ────────────────────────────────────────────────
  { name: 'admin-orders', path: '/admin/orders', identity: 'adminWith2fa' },
  { name: 'admin-dashboard', path: '/admin/dashboard', identity: 'adminWith2fa' },
  // /admin/settings 呼叫 20+ 支 API，逐一精準 mock 不划算（fixture 萬用 {data:{}} 會炸）；
  // 改用同樣具代表性的 admin 頁面 —— 側欄、表格、卡片一樣涵蓋到。
  { name: 'admin-drivers', path: '/admin/drivers', identity: 'adminWith2fa' },
  { name: 'admin-audit-logs', path: '/admin/audit-logs', identity: 'adminWith2fa' },
];

/**
 * 壓掉會讓截圖 flaky 的來源。
 * 動畫由 toHaveScreenshot 的 animations:'disabled' 處理，這裡處理它蓋不到的：
 * 無限迴圈動畫的中間態、捲動位置、以及仰賴 IntersectionObserver 的入場效果。
 */
async function settle(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      /* scroll-reveal 元素若還沒進 viewport 會是 opacity:0 → 強制顯示，避免半透明抖動 */
      [class*="reveal"], [class*="fade"] { opacity: 1 !important; transform: none !important; }
    `,
  });
  // 讓字體載入完成，否則會拍到 fallback 字體
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * 可忽略的 console 噪音。
 * - hydration mismatch：SSR/CSR 差異的 Vue 警告，全站幾乎每頁都有，與色票無關；
 *   它是既有技術債，不該讓視覺基線為它停擺（另開議題處理）。
 * - favicon / vite dev 相關：與應用無關。
 * - SSL connect error：WebKit 對被 route.abort() 擋下的第三方請求所報的錯。同源的
 *   http://localhost:3000 不可能產生 SSL 錯誤，所以只會遮住刻意擋掉的外部請求，
 *   不會掩蓋本地資源（例如字檔 404）的問題。
 *
 * - `[history] load failed`（/orders）：**mock 模式的既有缺陷，與視覺無關**。
 *   `GetOrderList()` 在 `IsMock()` 為真時走 `mock-res.ts` 的 `CreateRes()`，
 *   而它回的 `status.code` 是 **0** 不是 200；頁面拿到 code≠success 就 console.error。
 *   實測：請求根本沒出門（Playwright 收不到任何 /nuxt-api/orders 的 response），
 *   所以不是網路或 fixture 問題。頁面本身渲染完整，截圖是好的。
 *   根治屬「mock 回傳包絡 code 0」那條線（參照 api-envelope-zero-code），另開議題。
 *
 * 真正的 TypeError 等仍會讓測試失敗 —— 那代表頁面沒渲染完整，基線會是壞的。
 */
const IGNORED_CONSOLE = /Hydration completed but contains mismatches|favicon|Outdated Optimize Dep|504|SSL connect error|\[history\] load failed/;

/** 可見文字。務必用 innerText 而非 textContent —— 後者會把 <script> 裡的
 *  `window.__NUXT__={...}` 一起算進去，長度動輒數千字，任何「內容夠不夠」的判斷都會失效。 */
const visibleText = (page: Page): Promise<string> =>
  page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

/** 等頁面真的長出內容（boot gate 解除、lazy load 完成），而不是只等固定秒數。 */
async function waitForContent(page: Page, minChars = 60, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const t = (await visibleText(page)).replace(/\s+/g, '');
    if (t.length >= minChars) return;
    await page.waitForTimeout(500);
  }
}

/**
 * 拍照前的健全性檢查。
 *
 * 為什麼需要：第一次跑基線時 10 張全部「通過」，但 admin 三張拍到的是 500 錯誤頁、
 * driver 兩張拍到的是 boot splash。toHaveScreenshot 只保證「拍到了」，不保證「拍對了」——
 * 基線若含垃圾，之後的 diff 全部失去意義，而且不會有任何紅燈。
 */
async function assertRenderedForReal(page: Page, target: VisualTarget): Promise<void> {
  const text = (await visibleText(page)).replace(/\s+/g, '');

  const errorPage = /\b(404|500)\b/.test(text)
    && /(ServerError|Pagenotfound|回到首頁)/.test(text);
  expect(errorPage, `${target.path} 落在 Nuxt 錯誤頁`).toBe(false);

  // 仍停在 boot splash（CommonBootSplash 只有品牌字 + spinner，可見文字極短）
  expect(
    text.length,
    `${target.path} 仍停在 boot splash／空白（可見文字僅 ${text.length} 字：「${text.slice(0, 60)}」）`,
  ).toBeGreaterThanOrEqual(60);
}

for (const target of TARGETS) {
  test(`visual: ${target.name}`, async ({ page, loginAs }) => {
    const appErrors: string[] = [];
    page.on('pageerror', (e) => appErrors.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) appErrors.push(m.text());
    });

    // 擋掉所有第三方請求（GTM / Clarity / Google Maps…）。
    // 兩個理由：① 視覺基線不該讓分析腳本參與，否則截圖受外部服務狀態影響；
    // ② WebKit on Windows 對這些外部網域一律回 SSL connect error，會淹沒真正的錯誤。
    // 字體是 @nuxt/fonts 自架於同源 /_fonts/，不受影響。
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('http') && !/^https?:\/\/localhost:3000/.test(url)) return route.abort();
      return route.continue();
    });

    await loginAs(target.identity);

    await page.goto(target.path, { waitUntil: 'load', timeout: 25000 });
    await waitForContent(page);
    await settle(page);

    await assertRenderedForReal(page, target);
    expect(appErrors, `${target.path} 有 app 層錯誤：\n${appErrors.join('\n')}`).toHaveLength(0);

    await expect(page).toHaveScreenshot(`${target.name}.png`, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      // 色票換裝預期整片變動；比對階段本就要人工看 diff，不設寬容值
      maxDiffPixelRatio: 0,
    });
  });
}
