// 角色路由分流（P10 多角色版本）：
//   - admin 路徑：roles 必須包含 'admin'
//   - driver 路徑：roles 必須包含 'driver' 且 approved=true
//   - 乘客路徑：所有已登入使用者皆可進入（admin / approved driver 也能訂車）
//
// /driver/auth 與 /driver/register 為公開申請入口，永遠放行
//
// 注意：middleware 每次路由切換重新呼叫，無 reactivity 需求；
// 直接讀 store proxy 即可，不需 storeToRefs。
export default defineNuxtRouteMiddleware((to) => {
  const authStore = StoreAuth();

  if (!authStore.authResolved) return;

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isDriverPublic = to.path.startsWith('/driver/auth') || to.path.startsWith('/driver/register');

  // /driver/auth 與 /driver/register 永遠放行（公開申請入口）
  if (isDriverPublic) return;

  if (authStore.roles.length === 0) return;

  // Admin 路徑：必須包含 admin role
  if (isAdminPath && !authStore.roles.includes('admin')) {
    return navigateTo('/');
  }

  // Driver 路徑：必須包含 driver role 且已核准
  // 未核准 driver / 純 passenger / admin 但無 driver 身分 → 導至 /driver/register
  if (isDriverPath && (!authStore.roles.includes('driver') || !authStore.approved)) {
    return navigateTo('/driver/register');
  }

  // P10：移除「admin / approved driver 不得進入乘客路由」的 redirect
  // 多角色身分允許 admin 與 driver 在乘客端訂車；layout Header 提供切回後台的按鈕
});
