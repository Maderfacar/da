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
interface CreateOrderParams {
  userId?: string;
  lineUserId?: string;
  orderType: 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers?: GooglePlace[];
  passengerCount: number;
  luggageCount: number;
  vehicleType: 'sedan' | 'suv' | 'van' | 'premium';
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
interface GetOrderListParams {
  userId?: string;
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
  luggageCount: number;
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

// ===== 更新訂單 =====
// P19：orderStatus 擴充新增 en_route / arrived_pickup
// P22：admin 可改更多欄位（server 端依角色限制，passenger/driver 帶這些欄位會被拒）
interface PatchOrderParams {
  orderStatus?: 'pending' | 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit' | 'completed' | 'cancelled' | string;
  assignedDriverId?: string;
  cancelReason?: string;
  // admin-only
  pickupDateTime?: string;
  pickupLocation?: GooglePlace;
  dropoffLocation?: GooglePlace;
  stopovers?: GooglePlace[];
  vehicleType?: string;
  passengerCount?: number;
  luggageCount?: number;
  estimatedFare?: number;
  extraServices?: string[];
  flightNumber?: string | null;
  terminal?: string | null;
  notes?: string | null;
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
