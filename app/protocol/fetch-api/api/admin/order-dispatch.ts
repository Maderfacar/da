import methods from '@/protocol/fetch-api/methods';

// Phase 1E：訂單需求單 / 司機喊單 / 配對 — admin 端 API ----------------------

export interface OrderBidDto {
  driverId: string;
  driverDisplayName: string;
  bidAt: string | null;
  withdrawnAt: string | null;
}

export interface AdminBidWithMatch {
  driverId: string;
  driverDisplayName: string;
  bidAt: string | null;
  withdrawnAt: string | null;
  matchCount: number;
  matchedTagNames: string[];
  preferenceCount: number;
  completedOrders: number;
  verifiedAt: string | null;
}

export interface AdminOrderBidsRes {
  preferenceTagIds: string[];
  bids: AdminBidWithMatch[];
}

/** Admin：對某筆 pending 訂單發出需求單（觸發 LINE multicast 給所有 active driver） */
export const DispatchOrder = (orderId: string) =>
  methods.post<{ orderId: string; dispatched: boolean }>(
    `/nuxt-api/admin/orders/${orderId}/dispatch`,
    {},
  );

/** Admin：取某筆訂單目前所有 bids + 對應 driver match 計算 */
export const GetAdminOrderBids = (orderId: string) =>
  methods.get<AdminOrderBidsRes>(`/nuxt-api/admin/orders/${orderId}/bids`, {});

/** Admin：從 bids 中挑一個 driver 指派該訂單（觸發雙向 LINE 推播） */
export const AssignDriverFromBids = (orderId: string, body: { driverId: string }) =>
  methods.post<{ orderId: string; driverId: string; assigned: boolean }>(
    `/nuxt-api/admin/orders/${orderId}/assign`,
    body as unknown as Record<string, unknown>,
  );
