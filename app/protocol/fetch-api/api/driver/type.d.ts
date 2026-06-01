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

// 車輛載運容量（SU 已停用 — airport-calibration wave；保留 deprecated 欄位向後相容舊資料）
/** @deprecated SU 系統已停用 */
interface SeatConfig {
  label: string;
  passengerCapacity: number;
  luggageSU: number;
}

interface VehicleCapacityDto {
  /** 後車廂照片（Firebase Storage URL；admin 審核司機背書「車輛符合所掛車型描述」） */
  trunkPhotoUrl: string | null;
  /** @deprecated SU 系統已停用 */
  trunkVolumeLiters?: number;
  /** @deprecated SU 系統已停用 */
  derivedLuggageSU?: number;
  /** @deprecated SU 系統已停用 */
  seatConfigs?: SeatConfig[] | null;
  updatedAt: string | null;
}

interface PatchVehicleCapacityBody {
  /** 後車廂照片 URL（https） */
  trunkPhotoUrl?: string | null;
}
