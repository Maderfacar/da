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

/**
 * Admin：對「已派發但未指派」訂單**重發需求單** — 重新 LINE multicast 給所有 active driver。
 *
 * 與 DispatchOrder 差異：
 *   - DispatchOrder：首次發單；訂單必須 `!dispatchAt`
 *   - RedispatchOrder：重發；訂單必須已 `dispatchAt` 但 `!assignedDriverId`
 *
 * 行為：dispatchAt 保留首發時間，新寫 lastDispatchAt + dispatchCount++；bids 陣列保留。
 */
export const RedispatchOrder = (orderId: string) =>
  methods.post<{ orderId: string; redispatched: boolean }>(
    `/nuxt-api/admin/orders/${orderId}/redispatch`,
    {},
  );

/** Admin：取某筆訂單目前所有 bids + 對應 driver match 計算 */
export const GetAdminOrderBids = (orderId: string) =>
  methods.get<AdminOrderBidsRes>(`/nuxt-api/admin/orders/${orderId}/bids`, {});

/** Admin：從 bids 中挑一個 driver 指派該訂單（觸發雙向 LINE 推播 + Phase 1F Soft Match 判定） */
export const AssignDriverFromBids = (orderId: string, body: { driverId: string }) =>
  methods.post<{
    orderId: string;
    driverId: string;
    assigned: boolean;
    /** Phase 1F：本次 assign 後乘客確認狀態（auto = 自動接受 / pending = 需 3 選 1） */
    passengerConfirmationStatus?: 'auto' | 'pending';
    matchCount?: number;
    preferenceCount?: number;
  }>(
    `/nuxt-api/admin/orders/${orderId}/assign`,
    body as unknown as Record<string, unknown>,
  );

// ── Phase 1F：強制重新配對 ─────────────────────────────────────────

/**
 * Admin：對 confirmed 訂單觸發「強制重新配對」（rematchOrder）。
 * - 移除目前中選 driver + 重新派發給全部 active driver + 推 3 個通知
 * - 訂單狀態回 'pending'，reMatchRound +1，bids 移到 bidHistory
 */
export const ForceRematchOrder = (orderId: string, body: { reason?: string }) =>
  methods.post<{ orderId: string; rematched: boolean; reMatchRound: number; prevDriverId: string }>(
    `/nuxt-api/admin/orders/${orderId}/rematch`,
    body as unknown as Record<string, unknown>,
  );

// ── Phase 1F：passenger Soft Match 3 選 1（web fallback；主要走 LINE postback）────

export type SoftMatchDecision = 'accept' | 'wait' | 'cancel';

export const PostSoftMatchDecision = (orderId: string, body: { decision: SoftMatchDecision }) =>
  methods.post<{
    orderId: string;
    decision: SoftMatchDecision;
    orderStatus: string;
    passengerConfirmationStatus?: 'accepted' | 'declined';
    reMatchRound?: number;
  }>(
    `/nuxt-api/passenger/orders/${orderId}/soft-match-decision`,
    body as unknown as Record<string, unknown>,
  );
