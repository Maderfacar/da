// Firebase Auth + LINE LIFF 客戶端初始化
// .client.ts 確保此 plugin 僅在瀏覽器執行，完全規避 SSR 的 window/navigator 未定義問題
//
// Debug：開發者可在 DevTools Console 透過 window.__authStore 即時讀取
// roles / lineProfile / approved 等狀態，便於排查 auth 流程問題（無 console log 噪音）。
export default defineNuxtPlugin(() => {
  const { testMode } = useRuntimeConfig().public;
  const authStore = StoreAuth();

  if (typeof window !== 'undefined') {
    (window as unknown as { __authStore: ReturnType<typeof StoreAuth> }).__authStore = authStore;
  }

  if (testMode === 'T') {
    // 本地開發模式：直接 mock passenger 角色，跳過 LIFF / Firebase
    authStore.MockSignIn(['passenger']);
    return;
  }

  authStore.InitAuthFlow();
});
