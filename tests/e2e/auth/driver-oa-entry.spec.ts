import { test, expect } from './fixtures';

/**
 * 重現：多重身分者（passenger + driver + admin）從司機 OA richmenu 進站會閃一張全螢幕 500。
 *
 * 現場回報的關鍵區別：**重開 LINE 後第一次點不會 500，之後每次都會。**
 * 對應到程式，兩次進站的差異是「登入狀態是否已存在」——
 * 未登入時 middleware/role 會在 `if (!authStore.isSignIn) return` 早退，後面整段都不跑；
 * 已登入才會往下跑 resolveRequiredLoads → Ensure* → 分流。
 *
 * 因此本檔的重點不是「開得起來」，而是**同一個 page 連續進站兩次**，
 * 第二次才是出事的那次。
 *
 * ⚠️ 涵蓋範圍的誠實說明：fixture 的 __E2E_MODE__ 會讓 plugin 跳過 InitAuthFlow，
 * 所以 liff.init / LIFF 整頁重載這兩段**不在本檔涵蓋內**。本檔驗的是
 * 「多重身分 + 已登入 + login-entry 分流」這條路徑；若跑綠，代表 500 來自 LIFF 專屬環節，
 * 需要另一種重現方式（不可據此宣稱已修好）。
 */

const ERROR_PAGE = '#Error';

// Vue 的 SSR/CSR 標記不一致警告：以 console.error 發出，但不會產生錯誤頁，
// 與本檔要抓的 500 無關。是獨立議題（司機頁多處 ssr:false + client-only 元件），
// 不在此處斷言，否則這組迴歸測試會永遠是紅的而失去防線價值。
const IGNORED_CONSOLE = [/Hydration completed but contains mismatches/];

async function collectPageErrors(page: import('@playwright/test').Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

test.describe('司機 OA 進站 — 多重身分', () => {
  test('第一次進 / ：不出現錯誤頁，且導向司機端而非 admin', async ({ page, loginAs }) => {
    await loginAs('multiRoleDriverAdmin');
    const errors = await collectPageErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator(ERROR_PAGE)).toHaveCount(0);
    expect(errors, `console/page 錯誤：\n${errors.join('\n')}`).toEqual([]);
  });

  test('第二次進 /（登入狀態已存在）：不應出現錯誤頁 — 這是現場出事的那次', async ({ page, loginAs }) => {
    await loginAs('multiRoleDriverAdmin');

    // 第一次進站：建立登入狀態（現場等同「重開 LINE 後第一次點」，不會 500）
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 從第二次開始才蒐集錯誤，避免第一次的雜訊混淆
    const errors = await collectPageErrors(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator(ERROR_PAGE)).toHaveCount(0);
    expect(errors, `第二次進站的 console/page 錯誤：\n${errors.join('\n')}`).toEqual([]);
  });

  test('連續進站四條 richmenu 路徑：全程不出現錯誤頁', async ({ page, loginAs }) => {
    await loginAs('multiRoleDriverAdmin');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const errors = await collectPageErrors(page);

    // 現場 richmenu 的四個目標
    for (const target of ['/driver/trip', '/driver/dispatched', '/driver/traffic', '/driver/announcements']) {
      await page.goto(target);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(ERROR_PAGE), `${target} 出現錯誤頁`).toHaveCount(0);
    }

    expect(errors, `四條路徑的 console/page 錯誤：\n${errors.join('\n')}`).toEqual([]);
  });
});
