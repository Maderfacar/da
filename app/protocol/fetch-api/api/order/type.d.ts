// ===== 共用地點型別 =====
interface GooglePlace {
  address: string;      // 格式化地址（傳給 API 使用）
  lat: number;
  lng: number;
  placeId?: string;
  displayName?: string; // 顯示用：「地點名稱 (地址)」格式
}

// ===== 建立訂單 =====
// P17：userId / lineUserId 改為 optional — server 從 ID token 取，不再信任 client
// P20：補上 contactPhone（必填）+ flightNumber / terminal / notes（optional）
// P23：vehicleType / extraServices 改 string（fleet config 動態化），luggageCount 改 luggageItems 陣列
interface OrderLuggageItem {
  typeId: string;
  count: number;
}

interface CreateOrderParams {
  userId?: string;
  lineUserId?: string;
  orderType: 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers?: GooglePlace[];
  passengerCount: number;
  luggageItems: OrderLuggageItem[];
  vehicleType: string;
  extraServices?: string[];
  contactPhone: string;
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
}

interface CreateOrderRes {
  orderId: string;
  estimatedFare: number;
  estimatedTime: number;
  distanceKm: number;
  orderStatus: string;
}

// ===== 取得訂單列表 =====
// P17：userId 改為 optional — passenger 由 server 強制使用 auth.lineUid，
// 此參數僅 admin / driver 可帶用於查指定使用者
// Wave 1 P3：from / to 為 ISO string（exclusive end）— server 內存過濾 pickupDateTime
interface GetOrderListParams {
  userId?: string;
  from?: string;
  to?: string;
}

interface OrderItem {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  vehicleType: string;
  passengerCount: number;
  estimatedFare: number;
  orderStatus: string;
  createdAt?: number;
}

// ===== 可接訂單（司機搶單） =====
interface AvailableOrder {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  vehicleType: string;
  passengerCount: number;
  estimatedFare: number;
  distanceKm: number;
}

// ===== P19：司機被指派的執行中訂單 =====
type AssignedOrderStatus = 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit';

interface AssignedOrder {
  orderId: string;
  userId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers: GooglePlace[];
  vehicleType: string;
  passengerCount: number;
  luggageItems: OrderLuggageItem[];
  estimatedFare: number;
  estimatedTime: number;
  distanceKm: number;
  extraServices: string[];
  flightNumber: string | null;
  terminal: string | null;
  notes: string | null;
  orderStatus: AssignedOrderStatus;
  createdAt: number;
  passengerName: string;
  passengerPhone: string | null;
}

// ===== Wave 1 D1：司機歷史訂單（completed / cancelled）=====
interface DriverHistoryOrder {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  vehicleType: string;
  passengerCount: number;
  estimatedFare: number;
  distanceKm: number;
  orderStatus: 'completed' | 'cancelled' | string;
  cancelReason: string | null;
  createdAt: number;
}

// ===== Wave 2 P4：乘客下一趟訂單 =====
interface UpcomingOrder {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  vehicleType: string;
  passengerCount: number;
  estimatedFare: number;
  orderStatus: string;
}

// ===== P36：訂單詳情（單筆完整資訊）=====
type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'en_route'
  | 'arrived_pickup'
  | 'in_transit'
  | 'completed'
  | 'cancelled';

interface OrderStatusHistory {
  confirmedAt: string | null;
  enRouteAt: string | null;
  arrivedPickupAt: string | null;
  inTransitAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

interface OrderDriverInfo {
  displayName: string;
  pictureUrl: string;
  plateNumber: string;
  vehicleType: string;
  /** P36 選項 A：真實電話（drivers.application.phone）；未設定回 null */
  phone: string | null;
}

/** P36：/nuxt-api/orders/[orderId] 回傳完整訂單 + 司機資訊（confirmed 後才有） */
interface OrderDetail {
  orderId: string;
  userId: string;
  orderType: string;
  orderStatus: OrderStatus | string;
  pickupDateTime: string;
  pickupLocation: GooglePlace | null;
  dropoffLocation: GooglePlace | null;
  stopovers: GooglePlace[];
  vehicleType: string;
  passengerCount: number;
  luggageItems: OrderLuggageItem[];
  extraServices: string[];
  estimatedFare: number;
  estimatedTime: number;
  distanceKm: number;
  contactPhone: string | null;
  flightNumber: string | null;
  terminal: string | null;
  notes: string | null;
  cancelReason: string | null;
  createdAt: string | null;
  statusHistory: OrderStatusHistory;
  driver: OrderDriverInfo | null;
}

// ===== 更新訂單 =====
// P19：orderStatus 擴充新增 en_route / arrived_pickup
// P22：admin 可改更多欄位（server 端依角色限制，passenger/driver 帶這些欄位會被拒）
interface PatchOrderParams {
  orderStatus?: 'pending' | 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit' | 'completed' | 'cancelled' | string;
  assignedDriverId?: string;
  cancelReason?: string;
  // admin-only
  orderType?: string;
  pickupDateTime?: string;
  pickupLocation?: GooglePlace;
  dropoffLocation?: GooglePlace;
  stopovers?: GooglePlace[];
  vehicleType?: string;
  passengerCount?: number;
  luggageItems?: OrderLuggageItem[];
  estimatedFare?: number;
  extraServices?: string[];
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
  passengerName?: string;
  contactPhone?: string;
  /** Wave 1 D2：driver 推進 4 個狀態 (en_route/arrived_pickup/in_transit/completed) 時，
   *  附上當下 GPS 座標。server 寫入 orders.statusHistoryLocations.{state}。
   *  其他角色 / 其他狀態提供本欄位會被 server 忽略。*/
  driverLocation?: { lat: number; lng: number };
}

// ===== Maps =====
interface AutocompleteParams {
  input: string;
  sessiontoken?: string;
}

interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface GeocodeParams {
  placeId: string;
  sessiontoken?: string;
}

interface GeocodeRes {
  lat: number;
  lng: number;
  address: string;
  placeId: string;
}

interface DistanceParams {
  origin: string;
  destination: string;
}

interface DistanceRes {
  distance_km: number;
  duration_minutes: number;
  origin: string;
  destination: string;
}
