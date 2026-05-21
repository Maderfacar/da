import methods from '@/protocol/fetch-api/methods';

// Phase 1E：訂單需求單 / 司機喊單 — driver 端 API -----------------------------
// OrderPreferencesDto / OrderLuggageItem 為 type.d.ts 內 ambient 型別（全域）

export interface DriverDispatchedOrderItem {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: { address: string; lat: number; lng: number; displayName?: string };
  dropoffLocation: { address: string; lat: number; lng: number; displayName?: string };
  stopovers: Array<{ address: string; lat: number; lng: number; displayName?: string }>;
  vehicleType: string;
  passengerCount: number;
  estimatedFare: number;
  distanceKm: number;
  notes: string | null;
  flightNumber: string | null;
  terminal: string | null;
  preferences: OrderPreferencesDto | null;
  dispatchAt: string | null;
  activeBidCount: number;
  myBidStatus: 'none' | 'bid' | 'withdrawn';
}

export interface DriverDispatchedOrderDetail extends DriverDispatchedOrderItem {
  luggageItems: Array<{ typeId: string; count: number }>;
  extraServices: string[];
  estimatedTime: number;
}

/** Driver：列所有 dispatched 但未指派的訂單（含自己的 bid 狀態） */
export const GetDispatchedOrders = () =>
  methods.get<DriverDispatchedOrderItem[]>('/nuxt-api/driver/dispatched-orders', {});

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
