// 角色路由分流：確保乘客/司機/管理者只能進入各自的頁面
// driver 須 approved: true；admin 須 role === 'admin'（role 本身即白名單）
// P8（2026/05/06 起）：未核准 driver / passenger / 新使用者進 /driver/* 統一導至 /driver/register
//   - /driver/auth 與 /driver/register 為公開入口，永遠放行
//   - 已被拒絕的 driver（rejectedAt 有值）也走 /driver/register，由頁面顯示「需聯絡管理者」
export default defineNuxtRouteMiddleware((to) => {
  const { role, approved, authResolved } = StoreAuth();

  if (!authResolved.value) return;

  const isAdminPath = to.path.startsWith('/admin');
  const isDriverPath = to.path.startsWith('/driver');
  const isDriverPublic = to.path.startsWith('/driver/auth') || to.path.startsWith('/driver/register');

  // /driver/auth 與 /driver/register 永遠放行（公開申請入口）
  if (isDriverPublic) return;

  if (!role.value) return;

  // Admin 路由：必須是 admin role（role 本身即白名單）
  if (isAdminPath && role.value !== 'admin') {
    return navigateTo('/');
  }

  // Driver 路由：未核准 driver / passenger / 其他 → 導至 /driver/register
  // 已核准 driver (approved=true) 才能進入 dashboard / pending / trip / profile 等
  if (isDriverPath && (role.value !== 'driver' || !approved.value)) {
    return navigateTo('/driver/register');
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
