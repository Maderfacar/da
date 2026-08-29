import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Auth E2E 矩陣 — 場景 #5 + #6 — /booking 進得去 + 不出 race
 *
 * 風險覆蓋：
 *   - W4 lazy-load 重構（2026-06-18 4 commits）— middleware/role lazy await Ensure*，
 *     /booking 進站不該因 Firestore 失敗卡住 splash > 5s
 *   - SPA auth race fix（2026-06-07 commit 8052053）— Suspense + BootGate +
 *     push→replace 不該在 warm boot 觸發 race
 *
 * **Brain AI 多次反映 /booking 進不去 → 本檔是主場 debug spec**
 *
 * 涵蓋：
 *   #5 cold boot：fresh browser → goto /booking → 5s 內 mount，不停在 spinner
 *   #6 warm boot：先 /home mount 完，再切 /booking → 不出 race（不被踢 /login、不卡 spinner）
 */

const SPINNER = '.LayoutFrontDesk__content-loading';
const ROLES_FAILED = '.LayoutFrontDesk__roles-failed';

test.describe('auth #5 — cold boot /booking 5s 內 mount', () => {
  test('passenger 直接進 /booking 不卡 splash', async ({ page, loginAs }) => {
    await loginAs('passenger');

    const start = Date.now();
    await page.goto('/booking', { waitUntil: 'load', timeout: 15_000 });

    // spinner 5s 內消失（front-desk layout 在 authResolved=true 後撤掉）
    await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 5_000 });
    const elapsed = Date.now() - start;
    expect(elapsed, `mount 花了 ${elapsed}ms，超過 5s 上限`).toBeLessThan(5_000);

    // 未被踢去 /login、未停在 404
    expect(page.url(), `URL 被改寫到非 /booking：${page.url()}`).toMatch(/\/booking/);
    await expect(page.locator(ROLES_FAILED)).toHaveCount(0);

    // body 不應顯示 404 文案（layout slot 必須有 render）
    const bodyText = (await page.locator('body').textContent()) ?? '';
    expect(bodyText.includes('404') && bodyText.includes('Page not found')).toBe(false);
  });

  // driver / admin 也能進 /booking（roles 包含其他身份不影響乘客端）
  for (const identity of ['driverApproved', 'adminWith2fa'] as const) {
    test(`${identity} 也能進 /booking（乘客端對所有身份開放）`, async ({ page, loginAs }) => {
      await loginAs(identity);

      await page.goto('/booking', { waitUntil: 'load', timeout: 15_000 });
      await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 5_000 });
      expect(page.url()).toMatch(/\/booking/);
    });
  }
});

// middleware 的導向是非同步的：goto 回來、URL 也已經是 /home 了，middleware 內那一發
// navigateTo('/home', { replace: true }) 仍可能還在飛。Chromium 會把它併掉，**WebKit 不會**
// —— 下一個 page.goto 會被它打斷，報 "interrupted by another navigation" / "Frame load
// interrupted"。這不是網站有 race，是測試沒等前一段導向落地就發下一段。
//
// 所以每段導向後統一走這裡：先等 URL 真的到位，再等一小段安靜期讓殘餘導向跑完。
// 「落定」＝ URL 連續 STABLE_MS 沒再變過。
//
// 第一版是固定 sleep 400ms，單獨跑一直過，但在整套 57 支併行跑、機器被吃滿的時候
// 偶爾還是被下一段 navigateTo 打斷（WebKit only）。固定 sleep 的長度是猜的，
// 機器一慢就不夠 —— 改成看 URL 有沒有真的停下來，跟機器速度脫鉤。
const STABLE_MS = 450;
const POLL_MS = 100;
const SETTLE_DEADLINE_MS = 8_000;

async function settleAt(page: Page, urlRe: RegExp): Promise<void> {
  await page.waitForURL(urlRe, { timeout: 10_000 });
  let last = page.url();
  let stable = 0;
  const deadline = Date.now() + SETTLE_DEADLINE_MS;
  while (stable < STABLE_MS && Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);
    const now = page.url();
    if (now === last) { stable += POLL_MS; } else { last = now; stable = 0; }
  }
}

test.describe('auth #6 — warm boot SPA 內 push→replace 不出 race', () => {
  test('home → booking 切換不卡 spinner、不踢 /login', async ({ page, loginAs }) => {
    await loginAs('passenger');

    // 第一段：home 完整 mount（plugin boot + auth state 就緒）
    await page.goto('/home', { waitUntil: 'load', timeout: 15_000 });
    await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 5_000 });
    await settleAt(page, /\/home/);

    // 第二段：warm 狀態切到 /booking
    // 此時 store 內已有 user/roles/authResolved，middleware/auth 不該再等 12s WaitForAuthResolved
    const start = Date.now();
    await page.goto('/booking', { waitUntil: 'load', timeout: 15_000 });
    await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 5_000 });
    const elapsed = Date.now() - start;
    expect(elapsed, `warm 切換花 ${elapsed}ms，明顯偏慢可能有 race`).toBeLessThan(5_000);

    // 關鍵 race 驗證：未被踢去 /login
    expect(page.url()).toMatch(/\/booking/);
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('連續多次切換 /home ↔ /booking 不累積 race', async ({ page, loginAs }) => {
    await loginAs('passenger');

    await page.goto('/home', { waitUntil: 'load' });
    await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 5_000 });
    await settleAt(page, /\/home/);

    // 5 輪 ping-pong；每輪 < 5s
    for (let i = 0; i < 5; i++) {
      await page.goto('/booking', { waitUntil: 'load' });
      await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 5_000 });
      await settleAt(page, /\/booking/);

      await page.goto('/home', { waitUntil: 'load' });
      await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 5_000 });
      await settleAt(page, /\/home/);
    }
  });
});
