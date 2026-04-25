// Firebase Auth + LINE LIFF 客戶端初始化
// .client.ts 確保此 plugin 僅在瀏覽器執行，完全規避 SSR 的 window/navigator 未定義問題
export default defineNuxtPlugin(() => {
  StoreAuth().InitAuthFlow();
});
