import * as mock from './mock';
import methods from '@/protocol/fetch-api/methods';

const IsMock = () => {
  const { public: { testMode } } = useRuntimeConfig();
  return testMode === 'T';
};

/** 建立訂單 */
export const CreateOrder = (params: CreateOrderParams) => {
  if (IsMock()) return mock.CreateOrder();
  return methods.post<CreateOrderRes>('/nuxt-api/orders', params);
};

/** 驗證折扣碼並預覽折抵金額（乘客 booking 確認頁用） */
export const ValidateDiscountCode = (params: ValidateDiscountParams) =>
  methods.post<ValidateDiscountRes>('/nuxt-api/discount-codes/validate', params as unknown as Record<string, unknown>);

/** 取得訂單列表 */
export const GetOrderList = (params: GetOrderListParams) => {
  if (IsMock()) return mock.GetOrderList();
  return methods.get<OrderItem[]>('/nuxt-api/orders', params);
};

/** P36：取得單筆訂單詳情（含司機資訊） */
export const GetOrder = (orderId: string) =>
  methods.get<OrderDetail>(`/nuxt-api/orders/${orderId}`, {});

/** 取得可接待接訂單（司機搶單） */
export const GetAvailableOrders = () =>
  methods.get<AvailableOrder[]>('/nuxt-api/orders/available', {});

/** P19：取得司機被指派的執行中訂單（confirmed/en_route/arrived_pickup/in_transit） */
export const GetAssignedOrders = () =>
  methods.get<AssignedOrder[]>('/nuxt-api/orders/assigned', {});

/** Wave 1 D1：取得司機自己的歷史訂單（completed / cancelled）— 支援 from/to 過濾 pickupDateTime */
export const GetDriverOrderHistory = (params: { from?: string; to?: string } = {}) =>
  methods.get<DriverHistoryOrder[]>('/nuxt-api/orders/history', params as Record<string, unknown>);

/** Wave 2 P4：取乘客自己「下一趟」訂單（pickupDateTime 最近 active 一筆）— 不存在回 null */
export const GetUpcomingOrder = () =>
  methods.get<UpcomingOrder | null>('/nuxt-api/orders/upcoming', {});

/** 更新訂單狀態或指派司機 */
export const PatchOrder = (orderId: string, params: PatchOrderParams) =>
  methods.patch<{ orderId: string }>(`/nuxt-api/orders/${orderId}`, params);

/** 地址自動完成（永遠打 BFF，key 在 server 端，不使用 mock） */
export const GetAutocomplete = (params: AutocompleteParams) =>
  methods.get<PlacePrediction[]>('/api/maps/autocomplete', params);

/** placeId → 座標 + 地址（永遠打 BFF） */
export const GetGeocode = (params: GeocodeParams) =>
  methods.get<GeocodeRes>('/api/maps/geocode', params);

/** 計算兩點距離與時間（永遠打 BFF） */
export const GetDistance = (params: DistanceParams) =>
  methods.get<DistanceRes>('/api/maps/distance', params);
