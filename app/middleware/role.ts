// 角色路由分流（W4 lazy load 版，2026-06-18）：
//
// W4 起 user-specific Firestore doc 改 lazy load — middleware/role 進對應路徑時才 await Ensure*。
// onAuthStateChanged 只設 Firebase user + idToken，不再 eager 讀 Firestore。
//
// 「該 await 哪些 Ensure*」由純函式 `resolveRequiredLoads(path)` 決定（shared/auth/required-loads.ts）：
//   - 公開頁（非 login entry）→ 全 false
//   - login entry（/、/login、/driver/auth）→ user（為了算分流 target）
//   - /driver/register → user（檢查 approved driver 該不該跳 dashboard）
//   - /driver/* → user + driver
//   - /admin/2fa/* → user（避免 2FA gate 自我迴圈）
//   - /admin/* → user + admin + admin2fa
//   - 其他受保護頁（/home /booking /orders 等）→ user
//
// 分流邏輯（與 W2 共用 SSOT 不變）：
//   - 乘客路徑：所有已登入使用者皆可進入（admin / approved driver 也能訂車）
//   - admin 路徑：roles 必須包含 'admin'；不符合 → 引回乘客端 /home
//   - driver 路徑：roles 必須包含 'driver' 且 approved=true；不符合 → 導向 /driver/auth
//
// 路徑例外（driver 端公開入口）：
//   /driver/auth     — driver LINE LIFF 公開登入入口；未登入放行（顯示登入按鈕）
//   /driver/register — driver 申請入口；放行給 1) 純 passenger（apply mode）、
//                      2) driver 申請中（pending mode）、3) driver 被拒（rejected mode）；
//                      已核准 driver 強制導去 /driver/dashboard
//
// Ensure* 內部 sticky promise，重複進站 0 額外 Firestore read。
import { isLoginEntry, resolveAuthTarget } from '~shared/utils/auth-target';
import { resolveLiffTarget } from '~shared/utils/liff-target';
import { resolveRequiredLoads } from '~shared/auth/required-loads';
import { logMiddleware } from '~/utils/error-log';

export default defineNuxtRouteMiddleware(async (to) => {
  const authStore = StoreAuth();

  if (!authStore.authResolved) return; // auth.ts middleware 已等過 12s
  if (!authStore.isSignIn) return; // auth.ts middleware 已踢到 /login

  // W4：依路徑並發 await 所需 doc loads（sticky promise dedup）
  const needs = resolveRequiredLoads(to.path);
  const ensures: Promise<void>[] = [];
  if (needs.user) ensures.push(authStore.EnsureUserDocLoaded());
  if (needs.driver) ensures.push(authStore.EnsureDriverDocLoaded());
  if (needs.admin) ensures.push(authStore.EnsureAdminDocLoaded());
  if (needs.admin2fa) ensures.push(authStore.EnsureAdmin2faSessionVerified());
  if (ensures.length > 0) await Promise.all(ensures);

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isDriverAuth = to.path.startsWith('/driver/auth');
  const isDriverRegister = to.path.startsWith('/driver/register');

  // === W2 / W4：login-entry 分流（/、/login、/driver/auth）===
  if (isLoginEntry(to.path)) {
    const liffTarget = resolveLiffTarget({
      query: to.query as Record<string, string | string[] | null | undefined>,
      pathname: import.meta.client ? window.location.pathname : undefined,
    });
    if (liffTarget && liffTarget !== to.path) {
      logMiddleware({
        event: 'middleware.redirect.liff-target',
        message: `${to.path} → ${liffTarget}`,
        metadata: { from: to.path, to: liffTarget, reason: 'liff-state-target' },
      });
      return navigateTo(liffTarget, { replace: true });
    }
    const target = resolveAuthTarget({
      entryPath: to.path,
      isSignIn: authStore.isSignIn,
      roles: authStore.roles,
      approved: authStore.approved,
    });
    if (target && target !== to.path) {
      logMiddleware({
        event: 'middleware.redirect.auth-target',
        message: `${to.path} → ${target}`,
        metadata: { from: to.path, to: target, reason: 'login-entry-resolve', roles: authStore.roles },
      });
      return navigateTo(target, { replace: true });
    }
    return;
  }

  // /driver/auth 未登入放行（上方已處理已登入分流）
  if (isDriverAuth) return;

  // /driver/register：已核准 driver 強制導去 dashboard，其他放行
  if (isDriverRegister) {
    if (authStore.roles.includes('driver') && authStore.approved) {
      logMiddleware({
        event: 'middleware.redirect.driver-approved',
        message: `${to.path} → /driver/dashboard`,
        metadata: { from: to.path, to: '/driver/dashboard', reason: 'approved-driver-on-register' },
      });
      return navigateTo('/driver/dashboard', { replace: true });
    }
    return;
  }

  // === Admin 路徑 ===
  if (isAdminPath) {
    if (authStore.roles.length === 0) {
      // 已 authResolved 但 roles 為空（line-exchange 失敗 / Firestore rules 阻擋）— 放行讓 page 處理
      return;
    }
    if (!authStore.roles.includes('admin')) {
      logMiddleware({
        event: 'middleware.redirect.admin-denied',
        message: `${to.path} → /home`,
        metadata: { from: to.path, to: '/home', reason: 'not-admin', roles: authStore.roles },
      });
      return navigateTo('/home', { replace: true });
    }
    // /admin/2fa/* 永遠放行（避免 setup / challenge 自己被擋進無窮迴圈）
    if (!to.path.startsWith('/admin/2fa')) {
      if (!authStore.admin2faEnrolled) {
        logMiddleware({
          event: 'middleware.redirect.admin-2fa-setup',
          message: `${to.path} → /admin/2fa/setup`,
          metadata: { from: to.path, to: '/admin/2fa/setup', reason: 'not-enrolled' },
        });
        return navigateTo('/admin/2fa/setup', { replace: true });
      }
      if (!authStore.admin2faSessionVerified) {
        logMiddleware({
          event: 'middleware.redirect.admin-2fa-challenge',
          message: `${to.path} → /admin/2fa/challenge`,
          metadata: { from: to.path, to: '/admin/2fa/challenge', reason: 'session-unverified' },
        });
        return navigateTo({ path: '/admin/2fa/challenge', query: { next: to.fullPath } }, { replace: true });
      }
    }
    return;
  }

  // === Driver 路徑（非 auth / 非 register）===
  if (isDriverPath) {
    if (authStore.roles.length === 0) {
      logMiddleware({
        event: 'middleware.redirect.driver-no-roles',
        message: `${to.path} → /driver/auth`,
        metadata: { from: to.path, to: '/driver/auth', reason: 'roles-empty' },
      });
      return navigateTo('/driver/auth', { replace: true });
    }
    if (!authStore.roles.includes('driver') || !authStore.approved) {
      logMiddleware({
        event: 'middleware.redirect.driver-denied',
        message: `${to.path} → /driver/auth`,
        metadata: {
          from: to.path, to: '/driver/auth',
          reason: !authStore.roles.includes('driver') ? 'not-driver' : 'not-approved',
          roles: authStore.roles, approved: authStore.approved,
        },
      });
      return navigateTo('/driver/auth', { replace: true });
    }
    return;
  }

  // 其他受保護頁 — Ensure* 已 await 完成；無額外 redirect 規則
});
