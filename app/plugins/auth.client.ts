// Firebase Auth + LINE LIFF 客戶端初始化
// .client.ts 確保此 plugin 僅在瀏覽器執行，完全規避 SSR 的 window/navigator 未定義問題
export default defineNuxtPlugin(() => {
  const { testMode } = useRuntimeConfig().public;

  if (testMode === 'T') {
    // 本地開發模式：直接 mock passenger 角色，跳過 LIFF / Firebase
    StoreAuth().MockSignIn('passenger');
    return;
  }

  StoreAuth().InitAuthFlow();
});
