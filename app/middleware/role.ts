// 角色路由守衛：依 roles 陣列決定存取權限
// 乘客路由 (/)：登入即可，無需 role 檢查
// 司機路由 (/driver)：roles 需包含 'driver' 或 'admin'；否則導向 /driver/register
// 管理路由 (/admin)：roles 需嚴格包含 'admin'；否則導向 /
export default defineNuxtRouteMiddleware((to) => {
  const store = StoreAuth();

  if (!store.authResolved) return;

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isRegisterPath = to.path.startsWith('/driver/register');

  // Admin 路由：必須有 admin 權限
  if (isAdminPath && !store.roles.includes('admin')) {
    return navigateTo('/');
  }

  // Driver 路由：/driver/register 為申請頁，不做 role 攔截
  if (isDriverPath && !isRegisterPath) {
    const hasDriverAccess = store.roles.includes('driver') || store.roles.includes('admin');
    if (!hasDriverAccess) {
      return navigateTo('/driver/register');
    }
  }
});
