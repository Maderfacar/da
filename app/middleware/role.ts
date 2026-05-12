// 角色路由分流（P10 多角色版本 + 2026-05-12 driver/register 收緊）：
//   - admin 路徑：roles 必須包含 'admin'
//   - driver 路徑：roles 必須包含 'driver' 且 approved=true
//   - 乘客路徑：所有已登入使用者皆可進入（admin / approved driver 也能訂車）
//
// /driver/auth：永遠放行（公開登入入口）
// /driver/register：放行給 1) 純 passenger（apply mode）、2) driver 申請中（pending mode）、
//                   3) driver 被拒（rejected mode）；**已核准 driver 強制導至 /driver/dashboard**
//   理由：register 頁內 3 模式中只有 apply 對 approved driver 無意義，其餘兩個是狀態顯示，
//   pending/rejected 用戶仍需此頁查看自己的審核進度，無法導去 dashboard（dashboard 反而會被
//   本 middleware 踢回 register，造成 redirect loop）。
//
// 注意：middleware 每次路由切換重新呼叫，無 reactivity 需求；直接讀 store proxy 即可。
export default defineNuxtRouteMiddleware((to) => {
  const authStore = StoreAuth();

  if (!authStore.authResolved) return;

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isDriverAuth = to.path.startsWith('/driver/auth');
  const isDriverRegister = to.path.startsWith('/driver/register');

  // /driver/auth 永遠放行（公開登入入口）
  if (isDriverAuth) return;

  // /driver/register：已核准 driver 強制導至 dashboard，其他放行
  if (isDriverRegister) {
    if (authStore.roles.includes('driver') && authStore.approved) {
      return navigateTo('/driver/dashboard');
    }
    return;
  }

  if (authStore.roles.length === 0) return;

  // Admin 路徑：必須包含 admin role
  if (isAdminPath && !authStore.roles.includes('admin')) {
    return navigateTo('/');
  }

  // Driver 路徑（非 auth / 非 register）：必須包含 driver role 且已核准
  // 未核准 driver / 純 passenger / admin 但無 driver 身分 → 導至 /driver/register
  if (isDriverPath && (!authStore.roles.includes('driver') || !authStore.approved)) {
    return navigateTo('/driver/register');
  }

  // P10：移除「admin / approved driver 不得進入乘客路由」的 redirect
  // 多角色身分允許 admin 與 driver 在乘客端訂車；layout Header 提供切回後台的按鈕
});
