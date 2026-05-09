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
}
