// 角色路由分流（P10 多角色版本，2026-05-15 修 driver loop bug；W2 收斂 page redirect）：
//   - 乘客路徑：所有已登入使用者皆可進入（admin / approved driver 也能訂車）
//   - admin 路徑：roles 必須包含 'admin'；不符合 → 引回乘客端 /home
//   - driver 路徑：roles 必須包含 'driver' 且 approved=true；不符合 → 導向 /driver/auth
//
// W2 新增 login-entry 分流：
//   過去 PageIndex / PageLogin / PageDriverAuth 各自 watch immediate 做 redirect，
//   三處 edge case 行為分歧。現統一交給此 middleware：
//     - /、/login、/driver/auth 入口 + isSignIn → 依角色 + LIFF deep link 算 target，replace 過去
//     - 未登入則放行（讓 page 顯示登入畫面 / hero）
//   分流 logic 抽至 shared/utils/auth-target，page 內 watch 同 import 兜底（race 防呆）。
//
// 路徑例外（driver 端公開入口）：
//   /driver/auth     — driver LINE LIFF 公開登入入口；未登入放行（顯示登入按鈕）
//   /driver/register — driver 申請入口；放行給 1) 純 passenger（apply mode）、
//                      2) driver 申請中（pending mode）、3) driver 被拒（rejected mode）；
//                      已核准 driver 強制導去 /driver/dashboard
//
// 注意：middleware 每次路由切換重新呼叫，無 reactivity 需求；直接讀 store proxy 即可。
import { isLoginEntry, resolveAuthTarget } from '~shared/utils/auth-target';
import { resolveLiffTarget } from '~shared/utils/liff-target';

export default defineNuxtRouteMiddleware((to) => {
  const authStore = StoreAuth();

  if (!authStore.authResolved) return;

  // === W2：login-entry 分流（/、/login、/driver/auth）===
  if (isLoginEntry(to.path) && authStore.isSignIn) {
    // 優先序 1：LIFF OAuth callback 目標（liff.state / next query 或 client pathname）
    const liffTarget = resolveLiffTarget({
      query: to.query as Record<string, string | string[] | null | undefined>,
      pathname: import.meta.client ? window.location.pathname : undefined,
    });
    if (liffTarget && liffTarget !== to.path) {
      return navigateTo(liffTarget, { replace: true });
    }
    // 優先序 2：依角色算目標
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

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isDriverAuth = to.path.startsWith('/driver/auth');
  const isDriverRegister = to.path.startsWith('/driver/register');

  // /driver/auth 未登入放行（上方已處理已登入分流）
  if (isDriverAuth) return;

  // /driver/register：已核准 driver 強制導去 dashboard，其他放行
  if (isDriverRegister) {
    if (authStore.roles.includes('driver') && authStore.approved) {
      return navigateTo('/driver/dashboard', { replace: true });
    }
    return;
  }

  if (authStore.roles.length === 0) {
    // 已 authResolved 但 roles 為空（line-exchange 失敗 / Firestore rules 阻擋）：
    // - driver path → 導 /driver/auth（上方 entry 分流會把純乘客 → /driver/register）
    // - 其他 path → 放行（後續 auth.ts 已等過 12s，視同未登入）
    if (isDriverPath) return navigateTo('/driver/auth', { replace: true });
    return;
  }

  // Admin 路徑：必須 admin role；不符合 → 引回乘客端
  if (isAdminPath && !authStore.roles.includes('admin')) {
    return navigateTo('/home', { replace: true });
  }

  // Admin 2FA gate：
  //   - /admin/2fa/* 永遠放行（避免 setup / challenge 自己被擋進無窮迴圈）
  //   - 未綁定 → /admin/2fa/setup（強制 enrollment）
  //   - 已綁定但 session 未驗證 → /admin/2fa/challenge?next={path}
  if (isAdminPath && authStore.roles.includes('admin') && !to.path.startsWith('/admin/2fa')) {
    if (!authStore.admin2faEnrolled) {
      return navigateTo('/admin/2fa/setup', { replace: true });
    }
    if (!authStore.admin2faSessionVerified) {
      return navigateTo({ path: '/admin/2fa/challenge', query: { next: to.fullPath } }, { replace: true });
    }
  }

  // Driver 路徑（非 auth / 非 register）：必須 driver role + approved；不符合 → 導向 /driver/auth
  if (isDriverPath && (!authStore.roles.includes('driver') || !authStore.approved)) {
    return navigateTo('/driver/auth', { replace: true });
  }
});
