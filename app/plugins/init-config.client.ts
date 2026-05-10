// P23：app 啟動時拉一次 fleet config（車型 / 行李類型 / 加值服務）
//
// 三端都要：乘客 fleet / booking、driver/trip 顯示車型 label、admin/orders 顯示車型 label
// 不掛 await — fire and forget；各 page 用 store 時若尚未 ready 會收到空陣列（fleet/booking
// 自己有 loading 態處理）。網路失敗時 Init() 內已自行吞掉。
export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return;
  void StoreConfig().Init();
});
