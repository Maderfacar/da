// P19：UpdateLocationParams 加 accuracy；status 移除 'offline'（driver 端不可主動寫）
interface UpdateLocationParams {
  lat: number;
  lng: number;
  heading?: number;
  accuracy?: number;
  status?: 'online' | 'busy';
  displayName?: string;
}

// P19：DriverInfo 加 accuracy / lastActiveAt / activeOrder
interface DriverActiveOrder {
  orderId: string;
  orderStatus: string;
}

interface DriverInfo {
  driverId: string;
  displayName: string;
  status: 'online' | 'busy';
  lat: number;
  lng: number;
  heading: number | null;
  accuracy: number | null;
  updatedAt: number;
  lastActiveAt: number;
  activeOrder: DriverActiveOrder | null;
}

interface DriverStats {
  tripsToday: number;
  earningsToday: number;
  // P25-1 新增欄位（既有 stats.get 已回傳，client 漸進使用）
  todayTrips?: number;
  todayEarnings?: number;
  totalTrips?: number;
  totalEarnings?: number;
  totalDistanceKm?: number;
  todayOnlineSeconds?: number;   // 今日累計上線秒數（含當前 session live delta）
  totalOnlineSeconds?: number;
  status?: 'online' | 'busy' | 'offline';
}

// SU V2：車輛載運容量（立即生效）
interface SeatConfig {
  label: string;
  passengerCapacity: number;
  luggageSU: number;
}

interface VehicleCapacityDto {
  trunkVolumeLiters: number;
  derivedLuggageSU: number;
  seatConfigs: SeatConfig[] | null;
  updatedAt: string | null;
}

interface PatchVehicleCapacityBody {
  trunkVolumeLiters: number;
  seatConfigs?: SeatConfig[];
}
