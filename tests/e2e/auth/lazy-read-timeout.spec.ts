import { test, expect } from './fixtures';

/**
 * Auth E2E 矩陣 — 場景 #10 — Firestore lazy read 失敗 5s timeout 顯示重試 UI
 *
 * 風險覆蓋：
 *   - W4 lazy-load 設計決策 4（2026-06-18）— `Ensure*` 內 Firestore read 失敗 silently swallow，
 *     roles 留空。app/composables/use-roles-load-guard.ts 提供 5s timeout 兜底：
 *     state 'loading'→'failed' → front-desk layout 顯示「載入失敗，請重新登入」按鈕。
 *
 * 涵蓋 layout：front-desk（layouts/front-desk.vue）
 *   class `.LayoutFrontDesk__roles-failed` 容器
 *   class `.LayoutFrontDesk__roles-failed-btn` 按鈕 → 點擊 navigateTo('/login', { replace: true })
 *
 * ── 2026-08-29 重寫：原版從寫出來就不可能通過 ──────────────────────────────
 *
 * 原版先 `loginAs('passenger')`（roles=['passenger']），再用 `__authStore` setter +
 * `setTimeout(0)` 事後把 roles 清空，想藉此 simulate「Ensure* 失敗」。兩個致命點：
 *
 *   1. `MockSignIn` 當時寫死「空陣列 → ['passenger']」，所以根本 mock 不出 roles=[]；
 *   2. `UseRolesLoadGuard` 的初始 state 在 roles 非空時就是 'ready'，而它的 watch
 *      **只往 'ready' 走、不會走回去**。等 setTimeout 跑到時 guard 早已 'ready'，
 *      5 秒 timer 從一開始就沒被排上（`if (state.value === 'loading')` 才排）。
 *
 * 正解是讓 roles **從頭就是空的** —— 那才是 prod 真正的失敗形狀。
 * 新增 `rolesLoadFailed` 身分（roles: []），並把 MockSignIn 的內建 fallback 拿掉
 * （預設值本來就在呼叫端）。
 */

const ROLES_FAILED = '.LayoutFrontDesk__roles-failed';
const RETRY_BTN = '.LayoutFrontDesk__roles-failed-btn';
// 5s timeout + buffer，給渲染 + microtask 一些餘裕
const FAILED_UI_TIMEOUT = 9_000;

test.describe('auth #10 — lazy read 失敗 5s timeout 顯示重試 UI', () => {
  test('roles 空陣列 5s 後顯示「載入失敗，請重新登入」', async ({ page, loginAs }) => {
    await loginAs('rolesLoadFailed');
    await page.goto('/orders', { waitUntil: 'load', timeout: 15_000 });

    await expect(page.locator(ROLES_FAILED)).toBeVisible({ timeout: FAILED_UI_TIMEOUT });
    await expect(page.locator(RETRY_BTN)).toBeVisible();
    await expect(page.locator(RETRY_BTN)).toContainText('重新登入');
  });

  test('roles 正常載入時不該出現這個 UI（守衛不誤觸發）', async ({ page, loginAs }) => {
    await loginAs('passenger');
    await page.goto('/orders', { waitUntil: 'load', timeout: 15_000 });

    // 等超過 5 秒 timeout，確認它不是「還沒到時間」而是真的不會出現
    await page.waitForTimeout(FAILED_UI_TIMEOUT);
    await expect(page.locator(ROLES_FAILED)).toHaveCount(0);
  });

  test('點「重新登入」按鈕導向 /login', async ({ page, loginAs }) => {
    await loginAs('rolesLoadFailed');
    await page.goto('/orders', { waitUntil: 'load', timeout: 15_000 });

    await expect(page.locator(RETRY_BTN)).toBeVisible({ timeout: FAILED_UI_TIMEOUT });
    await page.locator(RETRY_BTN).click();

    // navigateTo('/login', { replace: true })
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(page.url()).toMatch(/\/login/);
  });
});
