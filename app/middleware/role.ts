// 角色路由分流：確保乘客/司機/管理者只能進入各自的頁面
export default defineNuxtRouteMiddleware((to) => {
  const { role, authResolved } = StoreAuth();

  if (!authResolved.value) return;
  if (!role.value) return;

  if (to.path.startsWith('/admin') && role.value !== 'admin') {
    return navigateTo('/home');
  }

  if (to.path.startsWith('/driver') && role.value !== 'driver') {
    return navigateTo('/home');
  }

  if (!to.path.startsWith('/admin') && !to.path.startsWith('/driver') && role.value === 'admin') {
    return navigateTo('/admin/orders');
  }

  if (!to.path.startsWith('/driver') && !to.path.startsWith('/admin') && role.value === 'driver') {
    return navigateTo('/driver/dashboard');
  }
});
