// ===== 共用地點型別 =====
interface GooglePlace {
  address: string;      // 格式化地址（傳給 API 使用）
  lat: number;
  lng: number;
  placeId?: string;
  displayName?: string; // 顯示用：「地點名稱 (地址)」格式
}

// ===== 建立訂單 =====
interface CreateOrderParams {
  userId: string;
  lineUserId: string;
  orderType: 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers?: GooglePlace[];
  passengerCount: number;
  luggageCount: number;
  vehicleType: 'sedan' | 'suv' | 'van' | 'premium';
  extraServices?: string[];
}

interface CreateOrderRes {
  orderId: string;
  estimatedFare: number;
  estimatedTime: number;
  distanceKm: number;
  orderStatus: string;
}

// ===== 取得訂單列表 =====
interface GetOrderListParams {
  userId: string;
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
