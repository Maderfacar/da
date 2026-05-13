// 角色路由分流（P10 多角色版本）：
//   - 乘客路徑：所有已登入使用者皆可進入（admin / approved driver 也能訂車）
//   - admin 路徑：roles 必須包含 'admin'；不符合 → 引回乘客端 /home
//   - driver 路徑：roles 必須包含 'driver' 且 approved=true；不符合 → 引回乘客端 /home
//
// 路徑例外（driver 端公開入口，不受 roles 限制）：
//   /driver/auth     — driver LINE LIFF 公開登入入口，永遠放行
//   /driver/register — driver 申請入口；放行給 1) 純 passenger（apply mode）、
//                      2) driver 申請中（pending mode）、3) driver 被拒（rejected mode）；
//                      已核准 driver 強制導去 /driver/dashboard，避免無謂留在 register 頁
//
// 注意：middleware 每次路由切換重新呼叫，無 reactivity 需求；直接讀 store proxy 即可。
export default defineNuxtRouteMiddleware((to) => {
  const authStore = StoreAuth();

  if (!authStore.authResolved) return;

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isDriverAuth = to.path.startsWith('/driver/auth');
  const isDriverRegister = to.path.startsWith('/driver/register');

  // /driver/auth 永遠放行（driver 公開登入入口）
  if (isDriverAuth) return;

  // /driver/register：已核准 driver 強制導去 dashboard，其他放行（apply / pending / rejected）
  if (isDriverRegister) {
    if (authStore.roles.includes('driver') && authStore.approved) {
      return navigateTo('/driver/dashboard');
    }
    return;
  }

  if (authStore.roles.length === 0) return;

  // Admin 路徑：必須 admin role；不符合 → 引回乘客端
  if (isAdminPath && !authStore.roles.includes('admin')) {
    return navigateTo('/home');
  }

  // Driver 路徑（非 auth / 非 register）：必須 driver role + approved；不符合 → 引回乘客端
  if (isDriverPath && (!authStore.roles.includes('driver') || !authStore.approved)) {
    return navigateTo('/home');
  }
});
