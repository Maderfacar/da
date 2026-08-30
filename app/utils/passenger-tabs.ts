// 乘客端四格 tab 的 SSOT（2026-08-30 自 front-desk layout 抽出）
//
// front-desk（桌機常駐導覽 + 手機四格）與 marketing（登入者在 /fare /faq /legal
// 也要看到同一組四格）共用同一份清單 —— 兩份清單漂移的下場見 route-exists.ts
// 檔頭：死路由進 tab bar，在 LIFF 裡不是 404 而是 entry-intent 重放迴圈。
export const PASSENGER_TABS = [
  { id: 'home',    path: '/home',          labelKey: 'tab.home',   icon: 'mdi:home-outline' },
  { id: 'booking', path: '/booking',       labelKey: 'tab.book',   icon: 'mdi:car-outline' },
  { id: 'orders',  path: '/orders',        labelKey: 'tab.orders', icon: 'mdi:file-document-outline' },
  { id: 'news',    path: '/notifications', labelKey: 'tab.news',   icon: 'mdi:bell-outline' },
] as const;

export type PassengerTab = (typeof PASSENGER_TABS)[number];
