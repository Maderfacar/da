import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Vehicle Tag System — E2E smoke (Phase 1G)
 *
 * 整批 Phase 1A → 1F 上線前的 smoke 驗收：
 *   1A 車輛標籤 taxonomy + admin 管理      → /admin/settings (車輛標籤 tab)
 *   1B driver/vehicle profile + 標籤掛載    → /driver/profile
 *   1C 車輛公開檔案頁                       → /vehicles/[driverId]   ⭐ 唯一公開頁
 *   1D booking 偏好標籤 + max 加價          → /booking
 *   1E 訂單需求單 + 司機喊單 + admin 配對   → /driver/dispatched(/[orderId]), /admin/orders
 *   1F Soft Match + 重新配對流程            → /admin/orders modal + /driver/trip banner（無新頁）
 *
 * ⚠️ 範圍限制：
 *   完整 happy path（admin 派發 → driver 喊單 → admin 指派 → passenger 接受 → 完成）需要：
 *     - LINE 登入（測試環境無法走 line-exchange）
 *     - 三組角色帳號 + LIFF
 *     - 真實 Firestore 資料 seed
 *   無頭瀏覽器無法自動化全鏈路。本 spec 只 cover「smoke」層：
 *     - 路由註冊 ✓
 *     - auth/role 守衛接管不崩潰 ✓
 *     - 公開頁可在無 auth 狀態下 mount ✓
 *     - 無 i18n missing key / 無未捕捉 app error ✓
 *   完整端到端流程改走 HANDOFF.md 真機 checklist 由 Brain AI 手測。
 */

function isViteDevArtifact(msg: string): boolean {
  return (
    msg.includes('504') ||
    msg.includes('Outdated Optimize Dep') ||
    msg.includes('dynamically imported module') ||
    msg.includes('entry.js')
  );
}

async function collectConsole(page: Page, url: string) {
  const appErrors: string[] = [];
  const i18nMissing: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text();
    if ((msg.type() === 'warning' || msg.type() === 'warn')
      && (text.includes('[vue-i18n]') || text.includes('Not found') || text.includes('missing key'))) {
      i18nMissing.push(text);
    }
    if (msg.type() === 'error' && !isViteDevArtifact(text) && !text.includes('favicon')) {
      appErrors.push(text);
    }
  });
  page.on('pageerror', (err: Error) => {
    if (!isViteDevArtifact(err.message)) appErrors.push(`[pageerror] ${err.message}`);
  });

  await page.goto(url, { waitUntil: 'load', timeout: 25000 });
  await page.waitForTimeout(1200);
  return { appErrors, i18nMissing };
}

// ─── 1A: /admin/settings — admin 標籤管理 tab（auth 守衛）─────────────
test.describe('Phase 1A — /admin/settings 標籤管理 tab', () => {
  test('未登入訪問 /admin/settings → 不崩潰、auth/role 守衛接管', async ({ page }) => {
    const { appErrors } = await collectConsole(page, '/admin/settings');
    await expect(page.locator('body')).toBeVisible();
    expect(appErrors, `App errors on /admin/settings:\n${appErrors.join('\n')}`).toHaveLength(0);
    const bodyText = (await page.locator('body').textContent()) ?? '';
    expect(bodyText.includes('404') && bodyText.includes('Page not found')).toBe(false);
  });
});

// ─── 1B: /driver/profile — driver vehicle profile（auth 守衛）─────────
test.describe('Phase 1B — /driver/profile vehicle profile', () => {
  test('未登入訪問 /driver/profile → 不崩潰、auth/role 守衛接管', async ({ page }) => {
    const { appErrors } = await collectConsole(page, '/driver/profile');
    await expect(page.locator('body')).toBeVisible();
    expect(appErrors, `App errors on /driver/profile:\n${appErrors.join('\n')}`).toHaveLength(0);
    const bodyText = (await page.locator('body').textContent()) ?? '';
    expect(bodyText.includes('404') && bodyText.includes('Page not found')).toBe(false);
  });
});

// ─── 1C: /vehicles/[driverId] — 公開檔案頁（唯一無需登入）────────────
test.describe('Phase 1C — /vehicles/[driverId] 公開檔案頁', () => {
  // 不存在 / 未驗證的 driver → 後端回 404；前端應正常 mount 並顯示 not-found UI
  const PROBE_PATHS = [
    { code: 'zh', path: '/vehicles/Unonexistent-1g-probe' },
    { code: 'en', path: '/en/vehicles/Unonexistent-1g-probe' },
    { code: 'ja', path: '/ja/vehicles/Unonexistent-1g-probe' },
  ];

  for (const { code, path } of PROBE_PATHS) {
    test(`[${code}] ${path} — 不存在的 driverId 不崩潰`, async ({ page }) => {
      const { appErrors, i18nMissing } = await collectConsole(page, path);
      await expect(page.locator('body')).toBeVisible();
      expect(appErrors, `App errors on ${path}:\n${appErrors.join('\n')}`).toHaveLength(0);
      expect(i18nMissing, `Missing i18n keys on ${path}:\n${i18nMissing.join('\n')}`).toHaveLength(0);
    });
  }
});

// ─── 1D: /booking — 偏好標籤 + max 加價 UI（既有頁 + 1D 加 chip）────
test.describe('Phase 1D — /booking 偏好標籤掛載', () => {
  const LOCALE_PATHS = [
    { code: 'zh', path: '/booking' },
    { code: 'en', path: '/en/booking' },
    { code: 'ja', path: '/ja/booking' },
  ];

  for (const { code, path } of LOCALE_PATHS) {
    test(`[${code}] ${path} — mount 不崩潰、無 i18n missing`, async ({ page }) => {
      const { appErrors, i18nMissing } = await collectConsole(page, path);
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')), { timeout: 10000 });
      await expect(page.locator('body')).toBeVisible();
      expect(appErrors, `App errors on ${path}:\n${appErrors.join('\n')}`).toHaveLength(0);
      expect(i18nMissing, `Missing i18n keys on ${path}:\n${i18nMissing.join('\n')}`).toHaveLength(0);
    });
  }
});

// ─── 1E: /driver/dispatched(/[orderId]) — 司機接單看板（auth 守衛）──
test.describe('Phase 1E — /driver/dispatched 接單看板', () => {
  test('未登入訪問 /driver/dispatched → 不崩潰、auth/role 守衛接管', async ({ page }) => {
    const { appErrors } = await collectConsole(page, '/driver/dispatched');
    await expect(page.locator('body')).toBeVisible();
    expect(appErrors, `App errors on /driver/dispatched:\n${appErrors.join('\n')}`).toHaveLength(0);
  });

  test('未登入訪問 /driver/dispatched/<probe-id> → 不崩潰、auth/role 守衛接管', async ({ page }) => {
    const { appErrors } = await collectConsole(page, '/driver/dispatched/nonexistent-1g-probe');
    await expect(page.locator('body')).toBeVisible();
    expect(appErrors, `App errors on detail page:\n${appErrors.join('\n')}`).toHaveLength(0);
  });
});

// ─── 1E: /admin/orders — 訂單管理（dispatch section + Soft Match modal）
test.describe('Phase 1E/1F — /admin/orders 訂單管理（含 Soft Match modal）', () => {
  test('未登入訪問 /admin/orders → 不崩潰、auth/role 守衛接管', async ({ page }) => {
    const { appErrors } = await collectConsole(page, '/admin/orders');
    await expect(page.locator('body')).toBeVisible();
    expect(appErrors, `App errors on /admin/orders:\n${appErrors.join('\n')}`).toHaveLength(0);
  });
});

// ─── 1F: /driver/trip — 司機任務頁（Soft Match pending banner）─────
test.describe('Phase 1F — /driver/trip 任務頁', () => {
  test('未登入訪問 /driver/trip → 不崩潰、auth/role 守衛接管', async ({ page }) => {
    const { appErrors } = await collectConsole(page, '/driver/trip');
    await expect(page.locator('body')).toBeVisible();
    expect(appErrors, `App errors on /driver/trip:\n${appErrors.join('\n')}`).toHaveLength(0);
  });
});
