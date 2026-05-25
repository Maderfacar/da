import methods from '@/protocol/fetch-api/methods';
import type { DispatchLevel } from '~shared/types/dispatch-visibility';

export type { DispatchLevel } from '~shared/types/dispatch-visibility';

// Phase 1E：訂單需求單 / 司機喊單 — driver 端 API -----------------------------
// OrderPreferencesDto / OrderLuggageItem 為 type.d.ts 內 ambient 型別（全域）

export interface DriverDispatchedOrderItem {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: { address: string; lat: number; lng: number; displayName?: string; city?: string; district?: string };
  dropoffLocation: { address: string; lat: number; lng: number; displayName?: string; city?: string; district?: string };
  stopovers: Array<{ address: string; lat: number; lng: number; displayName?: string; city?: string; district?: string }>;
  vehicleType: string;
  passengerCount: number;
  /** Booking v2 批次 2：大人數（舊單 fallback = passengerCount） */
  adultCount?: number;
  /** Booking v2 批次 2：兒童數（舊單 fallback = 0） */
  childCount?: number;
  estimatedFare: number;
  distanceKm: number;
  notes: string | null;
  flightNumber: string | null;
  terminal: string | null;
  preferences: OrderPreferencesDto | null;
  dispatchAt: string | null;
  activeBidCount: number;
  myBidStatus: 'none' | 'bid' | 'withdrawn';
  /**
   * Wave 2B+2C：當前派單可見等級（'0'/'1'/'2'，舊單 fallback '0'）。
   * 司機端 server filter 已過濾不可見訂單；此欄位給 UI 顯示「目前 X 級開放」與倒數計算。
   */
  dispatchCurrentLevel: DispatchLevel;
  /**
   * Wave 2B+2C：當前等級開放時間 ISO（給倒數 UI 計算 = openedAt + duration[currentLevel]）。
   * 舊單無此值 → null，UI 不顯示倒數。
   */
  dispatchOpenedAt: string | null;
  /**
   * Wave 2B+2C：下一次自動降級時間 ISO（server 端依 orderType + currentLevel + openedAt 算）。
   *  - currentLevel='0' 或 orderType 無設定 → null
   *  - UI 倒數 = nextDowngradeAt - now；歸 0 顯示「即將降級」並等下次 GET 觸發 lazy
   */
  dispatchNextDowngradeAt: string | null;
}

export interface DriverDispatchedOrderDetail extends DriverDispatchedOrderItem {
  luggageItems: Array<{ typeId: string; count: number }>;
  extraServices: string[];
  estimatedTime: number;
}

/** Driver：列所有 dispatched 但未指派的訂單（含自己的 bid 狀態）
 *  region filter：regionField=pickup|dropoff + cities=台北市,新北市 + districts=中正區,信義區 */
export interface GetDispatchedOrdersParams {
  regionField?: 'pickup' | 'dropoff';
  /** 逗號分隔的縣市中文全名 list */
  cities?: string;
  /** 逗號分隔的鄉鎮市區中文全名 list */
  districts?: string;
}

export const GetDispatchedOrders = (params: GetDispatchedOrdersParams = {}) =>
  methods.get<DriverDispatchedOrderItem[]>('/nuxt-api/driver/dispatched-orders', params as Record<string, unknown>);

/** Driver：取單筆訂單詳情（給接單看板進入詳情頁用；訂單必須仍 dispatchable） */
export const GetDispatchedOrderDetail = (orderId: string) =>
  methods.get<DriverDispatchedOrderDetail>(`/nuxt-api/driver/dispatched-orders/${orderId}`, {});

/** Driver：對某筆訂單喊單 */
export const PostOrderBid = (orderId: string) =>
  methods.post<{ orderId: string; bid: boolean }>(
    `/nuxt-api/driver/orders/${orderId}/bid`,
    {},
  );

/** Driver：撤回對某筆訂單的喊單（admin 還沒指派前都可撤） */
export const DeleteOrderBid = (orderId: string) =>
  methods.delete<{ orderId: string; withdrawn: boolean }>(
    `/nuxt-api/driver/orders/${orderId}/bid`,
    {},
  );
