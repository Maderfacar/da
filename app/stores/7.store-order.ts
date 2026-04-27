// 乘客端訂單狀態管理（對齊 api-contracts + 訂單建立表單狀態）

export const StoreOrder = defineStore('StoreOrder', () => {

  // ── 表單草稿（跨步驟共享） ──────────────────────────────────────────────
  const draft = ref<Partial<CreateOrderParams>>({
    orderType: undefined,
    pickupDateTime: '',
    pickupLocation: undefined,
    dropoffLocation: undefined,
    stopovers: [],
    passengerCount: 1,
    luggageCount: 0,
    vehicleType: 'sedan',
    extraServices: [],
  });

  /** 路線資訊（Step 2 計算後暫存） */
  const routeInfo = ref<{ distanceKm: number; durationMinutes: number } | null>(null);

  /** 預估車資（Step 3 選完車種後計算） */
  const estimatedFare = ref(0);

  // ── 已送出訂單 ──────────────────────────────────────────────────────────
  const currentOrder = ref<CreateOrderRes | null>(null);

  /** 歷史訂單列表 */
  const orderHistory = ref<OrderItem[]>([]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const SetDraft = (partial: Partial<CreateOrderParams>) => {
    draft.value = { ...draft.value, ...partial };
  };

  const SetRouteInfo = (info: { distanceKm: number; durationMinutes: number }) => {
    routeInfo.value = info;
  };

  const SetEstimatedFare = (fare: number) => {
    estimatedFare.value = fare;
  };

  const SetCurrentOrder = (order: CreateOrderRes) => {
    currentOrder.value = order;
  };

  const AddToHistory = (item: OrderItem) => {
    orderHistory.value.unshift(item);
  };

  const ResetDraft = () => {
    draft.value = {
      orderType: undefined,
      pickupDateTime: '',
      pickupLocation: undefined,
      dropoffLocation: undefined,
      stopovers: [],
      passengerCount: 1,
      luggageCount: 0,
      vehicleType: 'sedan',
      extraServices: [],
    };
    routeInfo.value = null;
    estimatedFare.value = 0;
  };

  // ── Return ───────────────────────────────────────────────────────────────
  return {
    draft,
    routeInfo,
    estimatedFare,
    currentOrder,
    orderHistory,
    SetDraft,
    SetRouteInfo,
    SetEstimatedFare,
    SetCurrentOrder,
    AddToHistory,
    ResetDraft,
  };
});
