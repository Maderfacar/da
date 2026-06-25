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
      expect(page.url(), '應帶 next= 參數記住原 target').toContain(encodeURIComponent(target));
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

test.describe('auth #8 — Driver pending 不可進 /driver/dashboard', () => {
  const DRIVER_TARGETS = ['/driver/dashboard', '/driver/dispatched', '/driver/profile'] as const;

  for (const target of DRIVER_TARGETS) {
    test(`driverPending 訪問 ${target} → /driver/auth`, async ({ page, loginAs }) => {
      await loginAs('driverPending');
      await page.goto(target, { waitUntil: 'load', timeout: 15_000 });

      // middleware/role L109-111：roles 含 driver 但 approved=false → 跳 /driver/auth
      await page.waitForURL(/\/driver\/auth/, { timeout: 8_000 });
      expect(page.url()).toMatch(/\/driver\/auth/);
    });
  }

  test('driverApproved 可直接進 /driver/dashboard', async ({ page, loginAs }) => {
    await loginAs('driverApproved');
    await page.goto('/driver/dashboard', { waitUntil: 'load', timeout: 15_000 });

    expect(page.url()).toMatch(/\/driver\/dashboard/);
    expect(page.url()).not.toMatch(/\/driver\/auth/);
  });

  test('passenger 訪問 /driver/dashboard → /driver/auth（無 driver role）', async ({ page, loginAs }) => {
    await loginAs('passenger');
    await page.goto('/driver/dashboard', { waitUntil: 'load', timeout: 15_000 });

    // middleware/role L109：!roles.includes('driver') → 跳 /driver/auth
    await page.waitForURL(/\/driver\/auth/, { timeout: 8_000 });
    expect(page.url()).toMatch(/\/driver\/auth/);
  });
});
