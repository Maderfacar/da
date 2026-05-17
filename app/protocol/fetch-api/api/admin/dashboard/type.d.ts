// Admin Dashboard 總覽 type 定義（admin-auto-notify-dashboard 變更 + 後續強化）
//
// 對齊 server/routes/nuxt-api/admin/dashboard/summary.get.ts 回應結構。

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

/** 訂單狀態計數：待確認 = pending/confirmed；進行中 = en_route/arrived_pickup/in_transit */
export interface DashboardOrderCounts {
  pendingConfirm: number;
  inProgress: number;
}

/** 啟用中折扣碼（enabled 且在有效時間區間內） */
export interface ActiveDiscountCode {
  code: string;
  discountAmount: number;
  validFrom: string; // ISO，無則空字串
  validUntil: string; // ISO，無則空字串
  maxRedemptions: number | null;
  redemptionCount: number;
}

export interface DashboardSummaryRes {
  passengers: { count: number; list: OnlineUser[] };
  drivers: { count: number; list: OnlineDriver[] };
  orderCounts: DashboardOrderCounts;
  discountCodes: ActiveDiscountCode[];
  generatedAt: string; // ISO，前端顯示「資料時間」
}
