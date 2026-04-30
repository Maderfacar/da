// 角色路由分流：確保乘客/司機/管理者只能進入各自的頁面
// driver 須 approved: true；admin 須 role === 'admin'（role 本身即白名單）
// 未核准者一律導至乘客端首頁 /
export default defineNuxtRouteMiddleware((to) => {
  const { role, approved, authResolved } = StoreAuth();

  if (!authResolved.value) return;
  if (!role.value) return;

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');

  // Admin 路由：必須是 admin role（role 本身即白名單）
  if (isAdminPath && role.value !== 'admin') {
    return navigateTo('/');
  }

  // Driver 路由：必須是 driver role 且 approved: true
  if (isDriverPath && (role.value !== 'driver' || !approved.value)) {
    return navigateTo('/');
  }

  // Admin 不得進入乘客路由
  if (!isAdminPath && !isDriverPath && role.value === 'admin') {
    return navigateTo('/admin/traffic');
  }

  // 已核准 Driver 不得進入乘客路由
  if (!isDriverPath && !isAdminPath && role.value === 'driver' && approved.value) {
    return navigateTo('/driver/dashboard');
  }
});
