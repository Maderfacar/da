// Firebase Auth + LINE LIFF 客戶端初始化
// .client.ts 確保此 plugin 僅在瀏覽器執行，完全規避 SSR 的 window/navigator 未定義問題
export default defineNuxtPlugin(() => {
  const { testMode } = useRuntimeConfig().public;

  if (testMode === 'T') {
    // 本地開發模式：跳過 Firebase/LIFF，只解除 auth loading
    // 角色由登入頁「DEV MODE」按鈕手動選擇
    StoreAuth().authResolved.value = true;
    return;
  }

  StoreAuth().InitAuthFlow();
});
