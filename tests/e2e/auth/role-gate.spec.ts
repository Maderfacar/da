import { test, expect } from './fixtures';

/**
 * Auth E2E 矩陣 — 場景 #7 + #8 — Role gate
 *
 * 風險覆蓋：
 *   - admin-2fa-totp（2026-06-16 commit d2a0aba）— middleware/role.ts L92-99
 *     未綁 2FA → 強跳 /admin/2fa/setup；已綁但 session 過期 → 跳 /admin/2fa/challenge
 *   - P27 司機申請（2026-05-12）— roles.includes('driver') 但 approved=false
 *     不應放行 /driver/* 受保護頁
 *
 * 涵蓋：
 *   #7 Admin 未綁 2FA → /admin/2fa/setup；已綁無 session → /admin/2fa/challenge
 *   #8 Driver pending → /driver/auth（重新登入入口）
 */

const TARGETS = ['/admin/orders', '/admin/settings', '/admin/drivers'] as const;

test.describe('auth #7 — Admin 2FA gate', () => {
  for (const target of TARGETS) {
    test(`adminNo2fa 訪問 ${target} → /admin/2fa/setup`, async ({ page, loginAs }) => {
      await loginAs('adminNo2fa');
      await page.goto(target, { waitUntil: 'load', timeout: 15_000 });

      // middleware/role 應 navigateTo('/admin/2fa/setup', { replace: true })
      await page.waitForURL(/\/admin\/2fa\/setup/, { timeout: 8_000 });
      expect(page.url(), `應跳 /admin/2fa/setup，實際 ${page.url()}`).toMatch(/\/admin\/2fa\/setup/);
    });

    test(`adminEnrolledNoSession 訪問 ${target} → /admin/2fa/challenge?next=...`, async ({ page, loginAs }) => {
      await loginAs('adminEnrolledNoSession');
      await page.goto(target, { waitUntil: 'load', timeout: 15_000 });

      // middleware/role 應 navigateTo({ path: '/admin/2fa/challenge', query: { next: to.fullPath } })
      await page.waitForURL(/\/admin\/2fa\/challenge/, { timeout: 8_000 });
      expect(page.url()).toMatch(/\/admin\/2fa\/challenge/);
      // 2026-08-29：原本斷言 encodeURIComponent(target)（%2Fadmin%2Forders）。
      // 實測 URL 是 `?next=/admin/orders` —— Vue Router 的 query 序列化不編碼斜線，
      // 而斜線在 query value 裡本來就合法。是斷言抄錯，網站行為正確。
      expect(page.url(), '應帶 next= 參數記住原 target').toContain(`next=${target}`);
    });
  }

  test('adminWith2fa 可直接進 /admin/orders（不被 2FA gate 攔）', async ({ page, loginAs }) => {
    await loginAs('adminWith2fa');
    await page.goto('/admin/orders', { waitUntil: 'load', timeout: 15_000 });

    // 不被踢、留在原 path
    expect(page.url()).toMatch(/\/admin\/orders/);
    expect(page.url()).not.toMatch(/\/admin\/2fa/);
  });
});

test.describe('auth #8 — Driver pending / 非司機 不可進 /driver/* 受保護頁', () => {
  const DRIVER_TARGETS = ['/driver/dashboard', '/driver/dispatched', '/driver/profile'] as const;
  // 被擋下來之後真正停在哪：**/driver/register**，不是 /driver/auth。
  //
  // 2026-08-29 實測 trail：/driver/dashboard → /driver/register（/driver/auth 連 frame
  // navigation 事件都沒留下 —— 它是 middleware 內 replace 的中繼站，同一個 tick 就被
  // 下一段 resolveDestination 接手了）。原本的 waitForURL(/\/driver\/auth/) 等的是一個
  // 從來不會停留的中繼 URL，所以必然 8 秒逾時。
  //
  // 停在 /driver/register 是 P27（2026-05-12 司機申請遷移）之後的正確落點：
  // 純乘客 → apply mode、申請中 → pending mode。斷言因此改成兩件事 ——
  // ①「沒進到受保護頁」（這才是 gate 的重點）②「停在司機端的登入／申請入口」。
  const NOT_ADMITTED = /\/driver\/(auth|register)/;

  for (const target of DRIVER_TARGETS) {
    test(`driverPending 訪問 ${target} → 擋在 /driver/register`, async ({ page, loginAs }) => {
      await loginAs('driverPending');
      await page.goto(target, { waitUntil: 'load', timeout: 15_000 });

      await page.waitForURL(NOT_ADMITTED, { timeout: 8_000 });
      expect(page.url(), '未核准司機不得停在受保護頁').not.toMatch(new RegExp(target));
      expect(page.url()).toMatch(NOT_ADMITTED);
    });
  }

  test('driverApproved 可直接進 /driver/dashboard', async ({ page, loginAs }) => {
    await loginAs('driverApproved');
    await page.goto('/driver/dashboard', { waitUntil: 'load', timeout: 15_000 });

    expect(page.url()).toMatch(/\/driver\/dashboard/);
    expect(page.url()).not.toMatch(NOT_ADMITTED);
  });

  test('passenger 訪問 /driver/dashboard → 擋在 /driver/register（無 driver role）', async ({ page, loginAs }) => {
    await loginAs('passenger');
    await page.goto('/driver/dashboard', { waitUntil: 'load', timeout: 15_000 });

    await page.waitForURL(NOT_ADMITTED, { timeout: 8_000 });
    expect(page.url()).not.toMatch(/\/driver\/dashboard/);
  });
});

/**
 * 入口決定端別，不是角色決定端別（2026-08-29）
 *
 * 舊行為：只要身上有 admin，不管從哪裡進來，一律被丟去 /admin/orders。
 * Brain AI 的原話：「我都 url 輸入 https://…/ 卻被導到 /admin 也不合理吧」。
 * 他的帳號是 passenger + admin + driver 三重身分，所以他**從來沒看過乘客首頁**。
 *
 * 2026-08-17 那次事故（司機 OA 進站被丟去 admin）只補了 entryEnd='driver' 一條，
 * 沒動「其餘一律 admin 優先」的預設 —— 這支守的就是那個預設被改掉之後不要長回來。
 */
test.describe('auth — 入口決定端別（多重身分不被 admin 優先蓋掉）', () => {
  for (const entry of ['/', '/login'] as const) {
    test(`multiRoleDriverAdmin 打 ${entry} → 落乘客端 /home，不進 /admin`, async ({ page, loginAs }) => {
      await loginAs('multiRoleDriverAdmin');
      await page.goto(entry, { waitUntil: 'load', timeout: 15_000 });

      await page.waitForURL(/\/home/, { timeout: 10_000 });
      expect(page.url(), '乘客端入口不該把人丟去 admin').not.toMatch(/\/admin/);
      expect(page.url(), '乘客端入口不該把人丟去司機端').not.toMatch(/\/driver/);
    });
  }

  test('adminWith2fa 打 / → 落乘客端 /home（要進 admin 走頂欄 ADMIN 鈕）', async ({ page, loginAs }) => {
    await loginAs('adminWith2fa');
    await page.goto('/', { waitUntil: 'load', timeout: 15_000 });

    await page.waitForURL(/\/home/, { timeout: 10_000 });
    expect(page.url()).not.toMatch(/\/admin/);
  });
});
