import { test, expect } from './fixtures';

/**
 * Auth E2E 矩陣 — 場景 #9 — Token 401 自動 refresh + retry 一次
 *
 * 風險覆蓋：methods.ts W3（2026-06-18 commit ?）— 401 即試 refresh idToken + retry 原 request 一次。
 *   refresh 失敗或 retry 仍 401 → SignOut → /login（單一收斂點）。
 *
 * 驗證：
 *   - 第一次 /nuxt-api/orders 回 401 → wrapper 試 refresh + retry → 第二次回 200
 *   - server 應收到 2 個 request（retry 確認）
 *   - 頁面正常 mount、url 留在原頁（沒被踢 /login）
 *
 * Mock 環境特殊處理：
 *   - 真實環境 GetFreshIdToken 用 Firebase SDK 的 currentUser.getIdToken()
 *   - Mock 環境無 Firebase → 透過 __authStore setter monkey patch 覆蓋 refresh fn
 */

test.describe('auth #9 — 401 自動 refresh + retry', () => {
  test('第一次 401、第二次 200 → page 正常 mount 不踢 /login', async ({ page, loginAs }) => {
    await loginAs('passenger');

    // Monkey patch GetFreshIdToken：plugin 把 store 賦給 window 時即覆蓋
    // 真實環境此 fn 走 Firebase；mock 環境用 setter 攔下 fixture-level patch
    await page.addInitScript(() => {
      let _store: unknown = null;
      Object.defineProperty(window, '__authStore', {
        configurable: true,
        get: () => _store,
        set: (s: { GetFreshIdToken?: () => Promise<string>; idToken?: string }) => {
          _store = s;
          // patch refresh fn，讓 retry 路徑「refresh 成功」可被驗
          s.GetFreshIdToken = async () => 'fresh-mock-id-token';
          s.idToken = 'initial-mock-id-token';
        },
      });
    });

    // 攔 /orders endpoint 計次：第 1 次 401，第 2 次起 200
    let callCount = 0;
    await page.route('**/nuxt-api/orders**', async (route) => {
      callCount += 1;
      const url = route.request().url();
      // 只攔列表 endpoint，個別資源 endpoint 走 fixture default
      if (!url.includes('/nuxt-api/orders?') && !url.endsWith('/nuxt-api/orders')) {
        return route.fallback();
      }
      if (callCount === 1) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {},
            status: { code: 401, message: { zh_tw: 'Token 失效', en: 'Unauthorized', ja: '' } },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { list: [], total: 0, page: 1, limit: 20 },
          status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
        }),
      });
    });

    await page.goto('/orders', { waitUntil: 'load', timeout: 15_000 });
    // 給 wrapper 時間跑 refresh + retry
    await page.waitForTimeout(2_000);

    // 驗證：未被踢 /login
    expect(page.url(), `應停留 /orders 不被踢 /login，實際 ${page.url()}`).toMatch(/\/orders/);
    expect(page.url()).not.toMatch(/\/login/);

    // 驗證：endpoint 被 call 至少 2 次（第 1 次 401 + retry 第 2 次 200）
    expect(callCount, `應 call /nuxt-api/orders 至少 2 次（觸發 retry），實際 ${callCount}`).toBeGreaterThanOrEqual(2);
  });

  test('refresh 失敗（持續 401）→ SignOut 至 /login', async ({ page, loginAs }) => {
    await loginAs('passenger');

    // patch GetFreshIdToken return 空字串 → policy 判 refresh 失敗 → SignOut
    await page.addInitScript(() => {
      let _store: unknown = null;
      Object.defineProperty(window, '__authStore', {
        configurable: true,
        get: () => _store,
        set: (s: { GetFreshIdToken?: () => Promise<string> }) => {
          _store = s;
          s.GetFreshIdToken = async () => ''; // refresh 失敗
        },
      });
    });

    // 所有 /nuxt-api/orders 永遠回 401
    await page.route('**/nuxt-api/orders**', async (route) => {
      const url = route.request().url();
      if (!url.includes('/nuxt-api/orders?') && !url.endsWith('/nuxt-api/orders')) {
        return route.fallback();
      }
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {},
          status: { code: 401, message: { zh_tw: 'Token 失效', en: '', ja: '' } },
        }),
      });
    });

    await page.goto('/orders', { waitUntil: 'load', timeout: 15_000 });

    // 應被踢 /login（policy.signOutToLogin）
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login/);
  });
});
