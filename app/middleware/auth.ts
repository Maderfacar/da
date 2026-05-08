// 驗證登入狀態，未登入時導向對應的登入頁
//
// P18 hotfix（stage gate 暴露的 P14 後 race condition）：
// 原本 `if (!authResolved) return` 直接放行 navigation 卻沒 await，
// 導致 page `onMounted` 跑時 Firebase auth 尚未從 IndexedDB 復原 →
// `getAuth().currentUser=null` → `GetFreshIdToken()` 回空字串 →
// onRequest 沒帶 Authorization header → 受 require-auth 保護 endpoint 一律 401「未授權」。
// 重整 /admin/orders 永遠看不到訂單即此源頭。
//
// 改成真的 await authResolved（watch 直到變 true）。上限隱含於 InitAuthFlow 的 12 秒
// safetyTimer（逾時會強制 authResolved=true，避免無限等）；firebase IndexedDB 復原
// 通常 <500ms，使用者感知不到延遲。
export default defineNuxtRouteMiddleware(async (to) => {
  const authStore = StoreAuth();

  if (!authStore.authResolved) {
    await new Promise<void>((resolve) => {
      const stop = watch(() => authStore.authResolved, (v) => {
        if (v) { stop(); resolve(); }
      }, { immediate: true });
    });
  }

  if (!authStore.isSignIn) {
    const loginPath = to.path.startsWith('/driver') ? '/driver/auth' : '/login';
    return navigateTo(loginPath);
  }
});
