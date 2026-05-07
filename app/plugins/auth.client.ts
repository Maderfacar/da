// Firebase Auth + LINE LIFF 客戶端初始化
// .client.ts 確保此 plugin 僅在瀏覽器執行，完全規避 SSR 的 window/navigator 未定義問題
export default defineNuxtPlugin(() => {
  const { testMode } = useRuntimeConfig().public;
  const authStore = StoreAuth();

  // Debug：把 store 暴露至 window，方便 DevTools Console 即時查 state
  // 使用方式：window.__authStore.roles / .lineProfile / .approved 等
  if (typeof window !== 'undefined') {
    (window as unknown as { __authStore: ReturnType<typeof StoreAuth> }).__authStore = authStore;
    console.info('[plugin/auth] window.__authStore exposed for debugging');
  }

  if (testMode === 'T') {
    // 本地開發模式：直接 mock passenger 角色，跳過 LIFF / Firebase
    authStore.MockSignIn(['passenger']);
    return;
  }

  authStore.InitAuthFlow();
});
