// Admin Dashboard 線上名單 type 定義（admin-auto-notify-dashboard 變更）
//
// 對齊 server/routes/nuxt-api/admin/dashboard/online.get.ts 回應結構。

export interface OnlineUser {
  uid: string;
  displayName: string;
  pictureUrl: string;
  lastSeenAt: string; // ISO
}

export interface OnlineDriver {
  uid: string;
  displayName: string;
  pictureUrl: string;
  lastActiveAt: string; // ISO
  driverStatus: string;
}

export interface DashboardOnlineRes {
  passengers: { count: number; list: OnlineUser[] };
  drivers: { count: number; list: OnlineDriver[] };
  generatedAt: string; // ISO，前端顯示「資料時間」
}
