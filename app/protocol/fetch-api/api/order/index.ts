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

/** 取得訂單列表 */
export const GetOrderList = (params: GetOrderListParams) => {
  if (IsMock()) return mock.GetOrderList();
  return methods.get<OrderItem[]>('/nuxt-api/orders', params);
};

/** 取得可接待接訂單（司機搶單） */
export const GetAvailableOrders = () =>
  methods.get<AvailableOrder[]>('/nuxt-api/orders/available', {});

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
