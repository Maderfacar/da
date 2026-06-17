// 角色路由分流（W4 lazy load 版，2026-06-18）：
//
// W4 起 user-specific Firestore doc 改 lazy load — middleware/role 進對應路徑時才 await Ensure*。
// onAuthStateChanged 只設 Firebase user + idToken，不再 eager 讀 Firestore（Phase 3 起）。
//
// 分流邏輯（與 W2 共用 SSOT 不變）：
//   - 乘客路徑：所有已登入使用者皆可進入（admin / approved driver 也能訂車）
//   - admin 路徑：roles 必須包含 'admin'；不符合 → 引回乘客端 /home
//   - driver 路徑：roles 必須包含 'driver' 且 approved=true；不符合 → 導向 /driver/auth
//
// login-entry 分流（/、/login、/driver/auth）：
//   - 已登入 → 依角色 + LIFF deep link 算 target，replace 過去
//   - 未登入 → 放行（讓 page 顯示登入畫面 / hero）
//
// 路徑例外（driver 端公開入口）：
//   /driver/auth     — driver LINE LIFF 公開登入入口；未登入放行（顯示登入按鈕）
//   /driver/register — driver 申請入口；放行給 1) 純 passenger（apply mode）、
//                      2) driver 申請中（pending mode）、3) driver 被拒（rejected mode）；
//                      已核准 driver 強制導去 /driver/dashboard
//
// W4 lazy load 設計：
//   - 不依賴 InitAuthFlow eager load；按 path 子集 await Ensure*
//   - login entry / register / passenger 受保護頁 → users
//   - driver 受保護頁 → users + drivers
//   - admin 受保護頁 → users + admins + 2FA session
//   - /admin/2fa/* → 只 users（避免 2FA gate 自我擋進迴圈）
//   - Ensure* 內部 sticky promise，重複進站 0 額外 Firestore read
//
// middleware 為 async；Vue Router 會 await。Pinia store proxy 直接讀即可（無 reactivity 需求）。
import { isLoginEntry, resolveAuthTarget } from '~shared/utils/auth-target';
import { resolveLiffTarget } from '~shared/utils/liff-target';

export default defineNuxtRouteMiddleware(async (to) => {
  const authStore = StoreAuth();

  if (!authStore.authResolved) return; // auth.ts middleware 已等過 12s
  if (!authStore.isSignIn) return; // auth.ts middleware 已踢到 /login

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isDriverAuth = to.path.startsWith('/driver/auth');
  const isDriverRegister = to.path.startsWith('/driver/register');

  // === W2 / W4：login-entry 分流（/、/login、/driver/auth）===
  // 需 users doc 才能算分流 target
  if (isLoginEntry(to.path)) {
    await authStore.EnsureUserDocLoaded();
    const liffTarget = resolveLiffTarget({
      query: to.query as Record<string, string | string[] | null | undefined>,
      pathname: import.meta.client ? window.location.pathname : undefined,
    });
    if (liffTarget && liffTarget !== to.path) {
      return navigateTo(liffTarget, { replace: true });
    }
    const target = resolveAuthTarget({
      entryPath: to.path,
      isSignIn: authStore.isSignIn,
      roles: authStore.roles,
      approved: authStore.approved,
    });
    if (target && target !== to.path) {
      return navigateTo(target, { replace: true });
    }
    return;
  }

  // /driver/auth 未登入放行（上方已處理已登入分流）
  if (isDriverAuth) return;

  // /driver/register：已核准 driver 強制導去 dashboard，其他放行
  if (isDriverRegister) {
    await authStore.EnsureUserDocLoaded();
    if (authStore.roles.includes('driver') && authStore.approved) {
      return navigateTo('/driver/dashboard', { replace: true });
    }
    return;
  }

  // === Admin 路徑 ===
  if (isAdminPath) {
    await authStore.EnsureUserDocLoaded();
    if (authStore.roles.length === 0) {
      // 已 authResolved 但 roles 為空（line-exchange 失敗 / Firestore rules 阻擋）— 放行讓 page 處理
      return;
    }
    if (!authStore.roles.includes('admin')) {
      return navigateTo('/home', { replace: true });
    }
    // /admin/2fa/* 永遠放行（避免 setup / challenge 自己被擋進無窮迴圈）
    if (!to.path.startsWith('/admin/2fa')) {
      // 進 admin 才 load admin doc + 2FA session（lazy，parallel 並發省 round-trip）
      await Promise.all([
        authStore.EnsureAdminDocLoaded(),
        authStore.EnsureAdmin2faSessionVerified(),
      ]);
      if (!authStore.admin2faEnrolled) {
        return navigateTo('/admin/2fa/setup', { replace: true });
      }
      if (!authStore.admin2faSessionVerified) {
        return navigateTo({ path: '/admin/2fa/challenge', query: { next: to.fullPath } }, { replace: true });
      }
    }
    return;
  }

  // === Driver 路徑（非 auth / 非 register）===
  if (isDriverPath) {
    await Promise.all([
      authStore.EnsureUserDocLoaded(),
      authStore.EnsureDriverDocLoaded(),
    ]);
    if (authStore.roles.length === 0) {
      return navigateTo('/driver/auth', { replace: true });
    }
    if (!authStore.roles.includes('driver') || !authStore.approved) {
      return navigateTo('/driver/auth', { replace: true });
    }
    return;
  }

  // === 其他受保護頁（passenger /home /booking /orders /profile 等）===
  await authStore.EnsureUserDocLoaded();
});
