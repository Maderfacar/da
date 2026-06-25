import { test, expect } from './fixtures';

/**
 * Auth E2E 矩陣 — 場景 #10 — Firestore lazy read 失敗 5s timeout 顯示重試 UI
 *
 * 風險覆蓋：
 *   - W4 lazy-load 設計決策 4（2026-06-18）— `Ensure*` 內 Firestore read 失敗 silently swallow，
 *     roles 留空。app/composables/use-roles-load-guard.ts 提供 5s timeout 兜底：
 *     state 'loading'→'failed' → front-desk layout 顯示「載入失敗，請重新登入」按鈕。
 *
 * 涵蓋 layout：front-desk（layouts/front-desk.vue L154-159）
 *   class `.LayoutFrontDesk__roles-failed` 容器
 *   class `.LayoutFrontDesk__roles-failed-btn` 按鈕 → 點擊 navigateTo('/login', { replace: true })
 *
 * Mock 環境 simulate：
 *   - MockSignIn 預設 fallback ['passenger']（store-auth L715），無法直接傳空 roles
 *   - 透過 __authStore setter 在 plugin MockSignIn 跑完後 setTimeout 0 清空 roles
 */

const ROLES_FAILED = '.LayoutFrontDesk__roles-failed';
const RETRY_BTN = '.LayoutFrontDesk__roles-failed-btn';
const SPINNER = '.LayoutFrontDesk__content-loading';
// 5s timeout + buffer，給渲染 + microtask 一些餘裕
const FAILED_UI_TIMEOUT = 8_000;

test.describe('auth #10 — lazy read 失敗 5s timeout 顯示重試 UI', () => {
  test('roles 空陣列 5s 後顯示「載入失敗，請重新登入」', async ({ page, loginAs }) => {
    await loginAs('passenger');

    // 在 store 賦給 window 後立刻清空 roles —— microtask 排程確保
    // MockSignIn（同步）已跑完
    await page.addInitScript(() => {
      let _store: unknown = null;
      Object.defineProperty(window, '__authStore', {
        configurable: true,
        get: () => _store,
        set: (s: { roles?: unknown[]; $patch?: (p: unknown) => void }) => {
          _store = s;
          // 等同個事件 loop tick 結束後清 roles，simulate「Firestore Ensure* 失敗 → roles 留空」
          setTimeout(() => {
            try {
              if (s.$patch) s.$patch({ roles: [] });
              else s.roles = [];
            } catch { /* Pinia proxy 不接受時 fallback 取 .value */ }
          }, 0);
        },
      });
    });

    await page.goto('/orders', { waitUntil: 'load', timeout: 15_000 });

    // spinner 應在 authResolved 後消失（authResolved=true by MockSignIn）
    await expect(page.locator(SPINNER)).toHaveCount(0, { timeout: 3_000 });

    // 5s + buffer 後應出現 roles-failed UI
    await expect(page.locator(ROLES_FAILED)).toBeVisible({ timeout: FAILED_UI_TIMEOUT });
    await expect(page.locator(RETRY_BTN)).toBeVisible();
    await expect(page.locator(RETRY_BTN)).toContainText('重新登入');
  });

  test('點「重新登入」按鈕導向 /login', async ({ page, loginAs }) => {
    await loginAs('passenger');

    await page.addInitScript(() => {
      let _store: unknown = null;
      Object.defineProperty(window, '__authStore', {
        configurable: true,
        get: () => _store,
        set: (s: { roles?: unknown[]; $patch?: (p: unknown) => void }) => {
          _store = s;
          setTimeout(() => {
            try {
              if (s.$patch) s.$patch({ roles: [] });
              else s.roles = [];
            } catch { /* ignore */ }
          }, 0);
        },
      });
    });

    await page.goto('/orders', { waitUntil: 'load', timeout: 15_000 });
    await expect(page.locator(RETRY_BTN)).toBeVisible({ timeout: FAILED_UI_TIMEOUT });

    await page.locator(RETRY_BTN).click();

    // navigateTo('/login', { replace: true })
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(page.url()).toMatch(/\/login/);
  });
});
