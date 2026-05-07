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

// 車種（訂單系統 + 司機申請共用）
type VehicleType = 'sedan' | 'mpv' | 'suv' | 'van' | 'premium';

// 司機申請文件 URL（Firebase Storage download URL）
interface DriverDocuments {
  licenseUrl: string;        // 駕照
  registrationUrl: string;   // 行照
  insuranceUrl: string;      // 保險卡
  goodCitizenUrl: string;    // 良民證
}

// 司機申請資料（Firestore users/{uid}.driverApplication）
interface DriverApplication {
  driverName: string;        // 司機真實姓名
  phone: string;
  plateNumber: string;
  vehicleType: VehicleType;
  bankCode: string;          // 銀行代號（3 碼）
  bankAccount: string;
  documents: DriverDocuments;
  appliedAt: string;         // ISO timestamp
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectedAt: string | null; // 拒絕時間，24h 內無法重申
  rejectReason: string | null;
}

// 司機申請文件種類
type DriverDocumentType = 'license' | 'registration' | 'insurance' | 'goodCitizen';

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

### 4.4 司機申請（server/routes/nuxt-api/driver/）

**POST `/nuxt-api/driver/upload`**（單一文件上傳，呼叫前端先上傳每個證件取得 URL，再呼叫 apply）
```typescript
// 請求：multipart/form-data
//   field: file (圖片檔，5MB 上限，jpg/png/pdf)
//   field: docType (DriverDocumentType)
// 後端：寫入 Firebase Storage drivers/{uid}/{docType}-{timestamp}.{ext}
type UploadDriverDocResponse = UnifiedResponse<{
  docType: DriverDocumentType;
  url: string;       // Firebase Storage download URL
  path: string;      // Storage path（供日後刪除參考）
}>;
```

**POST `/nuxt-api/driver/apply`**（送出申請）
```typescript
interface ApplyDriverRequest {
  driverName: string;
  phone: string;
  plateNumber: string;
  vehicleType: VehicleType;
  bankCode: string;
  bankAccount: string;
  documents: DriverDocuments;  // 4 個 URL，由 upload API 先取得
}

type ApplyDriverResponse = UnifiedResponse<{
  applied: boolean;
  appliedAt: string;
}>;
// 失敗回應：
//   400 INVALID_INPUT — 欄位缺失或格式錯誤
//   403 COOLDOWN — rejectedAt 在 24h 內，回傳 cooldownUntil 時間
//   409 ALREADY_APPLIED — 已是 driver 且 approved=true
```

### 4.5 Admin 端使用者管理（server/routes/nuxt-api/admin/）

**GET `/nuxt-api/admin/users`**（列出使用者，可按 role / approved 篩選；server 端用 `roles` array-contains 比對）
```typescript
// Query: role (passenger|driver|admin), approved (true|false 可選)
type Role = 'passenger' | 'driver' | 'admin';
interface AdminUser {
  uid: string;            // 對應 Firebase UID（含 'line:' 前綴）
  lineUserId: string;
  roles: Role[];          // 多角色陣列（最少含 'passenger'）
  approved: boolean;      // 僅代表 driver 是否核准；passenger / admin 永遠視為 true
  displayName: string;
  pictureUrl: string;
  driverCategory?: string;
  driverApplication?: DriverApplication;
  createdAt: string;
}
type AdminUsersResponse = UnifiedResponse<AdminUser[]>;
```

**PATCH `/nuxt-api/admin/users/[uid]`**（admin 審核操作）
```typescript
type Role = 'passenger' | 'driver' | 'admin';
interface UpdateUserRequest {
  addRole?: Role;                  // arrayUnion 加入 role
  removeRole?: 'admin' | 'driver'; // arrayRemove 移除 role；禁止移除 passenger
  approved?: boolean;              // 核准 / 停用 driver
  rejectedAt?: string | null;      // 設為 ISO timestamp 拒絕；設為 null 解除冷卻
  rejectReason?: string;           // 配合 rejectedAt 寫入
  driverCategory?: string;         // 調整搶單排序權重
  displayName?: string;            // 建立新使用者文件時可同步寫入
}
type UpdateUserResponse = UnifiedResponse<{ uid: string; updated?: boolean }>;
```

## 5. 錯誤代碼表

| Code | 說明 |
|------|------|
| `INVALID_ROUTE` | 路線計算失敗或超出台灣本島 |
| `INVALID_INPUT` | 申請欄位缺失或格式錯誤 |
| `ORDER_NOT_FOUND` | 訂單不存在 |
| `DRIVER_UNAVAILABLE` | 目前無可用司機 |
| `FLIGHT_API_ERROR` | 航班 API 錯誤 |
| `AUTH_FAILED` | LINE / Firebase 認證失敗 |
| `COOLDOWN` | 司機申請被拒絕後 24h 冷卻中 |
| `ALREADY_APPLIED` | 已為核准司機，無法重新申請 |
| `UPLOAD_FAILED` | Firebase Storage 上傳失敗 |
| `FILE_TOO_LARGE` | 證件圖片超過 5MB |
| `UNSUPPORTED_FILE_TYPE` | 證件檔案類型非 jpg/png/pdf |

---

**版本紀錄**
- 版本：v1.2（新增司機申請、文件上傳、admin 審核 API；補 `mpv` 車種；新增 `DriverApplication` 等型別）
- 更新日期：2026/05/06
- 歷史：v1.1（2026/04/26）統一為 UnifiedResponse 格式，移除 `any`
