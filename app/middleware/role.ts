// 角色路由分流（P10 多角色版本，2026-05-15 修 driver loop bug）：
//   - 乘客路徑：所有已登入使用者皆可進入（admin / approved driver 也能訂車）
//   - admin 路徑：roles 必須包含 'admin'；不符合 → 引回乘客端 /home
//   - driver 路徑：roles 必須包含 'driver' 且 approved=true；不符合 → 導向 /driver/auth
//     （讓 auth 頁 watch 處理跳轉：純乘客 → register 申請；admin → /admin/orders；
//      approved driver → dashboard）
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
      return navigateTo('/driver/dashboard', { replace: true });
    }
    return;
  }

  if (authStore.roles.length === 0) {
    // 已 authResolved 但 roles 為空（line-exchange 失敗 / Firestore rules 阻擋）：
    // - driver path → 導 /driver/auth 讓 watch 處理（純乘客 → register 申請流程）
    // - 其他 path → 放行（後續 auth.ts 已等過 12s，視同未登入）
    if (isDriverPath) return navigateTo('/driver/auth', { replace: true });
    return;
  }

  // Admin 路徑：必須 admin role；不符合 → 引回乘客端
  if (isAdminPath && !authStore.roles.includes('admin')) {
    return navigateTo('/home', { replace: true });
  }

  // Driver 路徑（非 auth / 非 register）：必須 driver role + approved；不符合 → 導向 /driver/auth
  //
  // 修 bug（原本是 navigateTo('/home')）：
  //   - 純乘客（roles=['passenger']）點 driver LIFF link 跳 /driver/dashboard → 被擋去 /home
  //   - /home 沒 driver 入口（drawer 沒列），user 再點 driver link 又被擋 → 循環
  //   - 永遠到不了 /driver/register 申請司機
  //
  // 現在統一走 /driver/auth：
  //   - 純乘客 → watch 跳 /driver/register（顯示申請表單）
  //   - admin → watch 跳 /admin/orders
  //   - driver pending/rejected → watch 跳 /driver/register
  //   - approved driver → watch 跳 /driver/dashboard
  if (isDriverPath && (!authStore.roles.includes('driver') || !authStore.approved)) {
    return navigateTo('/driver/auth', { replace: true });
  }
});
