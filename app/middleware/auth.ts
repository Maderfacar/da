// 驗證登入狀態，未登入時導向對應的登入頁
export default defineNuxtRouteMiddleware((to) => {
  const { authResolved, isSignIn } = StoreAuth();

  if (!authResolved.value) return; // 等待 Firebase 解析，layout 顯示 loading

  if (!isSignIn.value) {
    const loginPath = to.path.startsWith('/driver') ? '/driver/auth' : '/login';
    return navigateTo(loginPath);
  }
});
