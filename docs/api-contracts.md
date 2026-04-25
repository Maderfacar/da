# API 合約文件 (API Contracts)

> ⚠️ **適配說明**：原始規格的錯誤格式（`{ success: boolean }`）已統一為本專案的 `UnifiedResponse` 格式，與 `backend-conventions.md` 一致。

## 1. 通用原則

- 所有外部 API 呼叫必須透過 Nitro `server/api/` 進行（BFF 模式）
- 所有請求與回應必須使用 TypeScript 明確型別，**嚴禁 `any`**
- 日期時間統一使用 ISO 8601 格式（UTC）

## 2. 統一響應格式

```typescript
interface UnifiedResponse<T> {
  data: T;
  status: {
    code: number;
    message: { zh_tw: string; en: string; ja: string };
  };
}
```

**成功**：`status.code === 200`  
**失敗**：對應 HTTP 狀態碼（400 / 401 / 403 / 404 / 500）

## 3. 共用 TypeScript 型別

```typescript
// 訂單狀態
type OrderStatus = 'pending' | 'confirmed' | 'assigned' | 'in-progress' | 'completed' | 'cancelled';

// 司機行程狀態（對應 StoreTrip 狀態機）
type TripStatus = 'idle' | 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled';

// 車種
type VehicleType = 'sedan' | 'suv' | 'van' | 'premium';

// Google Maps 地點
interface GooglePlace {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

// 司機位置
interface DriverLocation {
  driverId: string;
  name: string;
  lat: number;
  lng: number;
  lastUpdated: string;
  currentOrderId?: string;
}

// 航班資訊
interface FlightInfo {
  flightNumber: string;
  status: 'on-time' | 'delayed' | 'boarding' | 'landed';
  terminal?: string;
  gate?: string;
  estimatedArrival?: string;
}
```

## 4. 主要 API 合約

### 4.1 BFF 代理端點（server/api/）

**GET `/api/maps/distance`**
```typescript
// Query: origin, destination
type DistanceResponse = UnifiedResponse<{
  distance_km: number;
  duration_minutes: number;
  origin: string;
  destination: string;
}>
```

**GET `/api/flight/status`**
```typescript
// Query: flight（航班號碼）
type FlightStatusResponse = UnifiedResponse<FlightInfo>
```

**POST `/api/trip/sync`**
```typescript
interface TripSyncPayload {
  trip_id: string;
  driver_id: string;
  gps_trail: Array<{ lat: number; lng: number; timestamp: number }>;
  offline_events: Array<{ type: string; payload: unknown; timestamp: number }>;
}
type TripSyncResponse = UnifiedResponse<{ synced: boolean }>
```

### 4.2 訂單相關（server/routes/nuxt-api/orders/）

**POST `/nuxt-api/orders`**（建立訂單）
```typescript
interface CreateOrderRequest {
  userId: string;
  lineUserId: string;
  orderType: 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';
  pickupDateTime: string;
  pickupLocation: GooglePlace;
  dropoffLocation: GooglePlace;
  stopovers?: GooglePlace[];
  passengerCount: number;
  luggageCount: number;
  vehicleType: VehicleType;
  extraServices?: string[];
}

type CreateOrderResponse = UnifiedResponse<{
  orderId: string;
  estimatedFare: number;
  estimatedTime: number;
  orderStatus: OrderStatus;
}>
```

**GET `/nuxt-api/orders`**（訂單列表）
```typescript
// Query: userId
type OrderListResponse = UnifiedResponse<Order[]>
```

### 4.3 司機相關（server/routes/nuxt-api/drivers/）

**GET `/nuxt-api/drivers/available`**
```typescript
type AvailableDriversResponse = UnifiedResponse<DriverLocation[]>
```

**PUT `/nuxt-api/drivers/[id]/location`**
```typescript
interface UpdateLocationPayload {
  lat: number;
  lng: number;
}
type UpdateLocationResponse = UnifiedResponse<{ updated: boolean }>
```

## 5. 錯誤代碼表

| Code | 說明 |
|------|------|
| `INVALID_ROUTE` | 路線計算失敗或超出台灣本島 |
| `ORDER_NOT_FOUND` | 訂單不存在 |
| `DRIVER_UNAVAILABLE` | 目前無可用司機 |
| `FLIGHT_API_ERROR` | 航班 API 錯誤 |
| `AUTH_FAILED` | LINE / Firebase 認證失敗 |

---

**版本紀錄**
- 版本：v1.1（統一為 UnifiedResponse 格式，移除 `any`）
- 更新日期：2026/04/26
