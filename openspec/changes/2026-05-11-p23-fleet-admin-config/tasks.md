# Tasks — P23 Fleet 設定動態化

## Stage 0：理解現況

- [x] 0.1 grep `shared/pricing.ts` 所有 import 點（8 個檔）
- [x] 0.2 看 admin/settings/index.vue 既有 712 行單檔結構（無既有 CRUD 模式，要新建）
- [x] 0.3 確認 BookingStepOptions / fleet/index.vue / BookingStepConfirm 對 luggage / extra / vehicle 的渲染方式

## Stage 1：Firestore schema + server endpoints + seed

### 1.1 server utility

- [ ] `server/utils/fleet-config.ts`：
  - `getFleetConfig()`：一次撈 vehicles + luggageTypes + extras 三 collection（並行 Promise.all）
  - `seedFleetConfig()`：3 collection 任一為空時寫入 defaults
  - 內部用 Firebase Admin SDK

### 1.2 public endpoint

- [ ] `server/routes/nuxt-api/config/fleet.get.ts`：
  - 公開（無 auth）
  - 自動 seed if empty
  - 回傳 `{ vehicles, luggageTypes, extras }`

### 1.3 admin CRUD endpoints

- [ ] `server/routes/nuxt-api/admin/config/vehicles/index.post.ts`（新增）
- [ ] `server/routes/nuxt-api/admin/config/vehicles/[id].put.ts`（更新）
- [ ] `server/routes/nuxt-api/admin/config/vehicles/[id].delete.ts`（刪除）
- [ ] 同樣 3 組 endpoints for `luggage-types` 與 `extras`
- [ ] 全部用 `getAuthFromEvent` + 檢查 `auth.role === 'admin'`

### 1.4 lint + build pass

- [ ] G1.1 build pass
- [ ] G1.2 手動測試 GET `/nuxt-api/config/fleet` 回 seed defaults

## Stage 2：client config store + 取代 hardcoded pricing

### 2.1 type 統一

- [ ] `shared/pricing.ts` 改寫：
  - 移除 `VEHICLE_CONFIGS` / `EXTRA_SERVICES` / `EXTRA_SERVICE_PRICE` 三常數
  - 保留 `VehicleType` / `OrderType` type
  - `calculateFare` 改簽名：`calculateFare(vehicle: VehicleConfig, distanceKm: number, extras: Array<{ price: number }>) => number`
  - 加 `LuggageType` / `FleetVehicle` / `FleetExtra` interface
  - `ORDER_TYPES` 留著（這個沒要動）

### 2.2 Pinia store

- [ ] `app/stores/8.store-config.ts`：
  - state: `vehicles[]` / `luggageTypes[]` / `extras[]`
  - `Init()`：fetch /nuxt-api/config/fleet（app 啟動時自動跑一次）
  - getters：`GetVehicle(id)` / `GetLuggageType(id)` / `GetExtra(id)`

### 2.3 app init hook

- [ ] `app/plugins/` 或 layout init 觸發 `StoreConfig().Init()`

### 2.4 lint + build pass

## Stage 3：booking 行李 + 車型卡片重構

### 3.1 BookingStepOptions

- [ ] 移除既有 single number luggageCount stepper
- [ ] 新增 4 個 stepper（依 `StoreConfig().luggageTypes` 動態渲染，每 type 一個）
- [ ] state: `luggageItems = ref<Array<{ typeId, count }>>`
- [ ] 即時計算 `totalSU = sum(count * su)`
- [ ] 顯示「目前 X SU / 上限 Y SU」進度條
- [ ] 車型卡片：依 `totalSU` vs `vehicle.luggageSU` 邏輯：
  - `totalSU > luggageSU * 1.5` → 卡片 disabled + 紅字 i18n「行李超出車型容量」
  - `luggageSU < totalSU ≤ luggageSU * 1.5` → 警告 icon + 警告文案（但可選）
  - `totalSU ≤ luggageSU` → 正常
- [ ] extras 改從 `StoreConfig().extras` 動態渲染

### 3.2 booking/index.vue

- [ ] 移除 `luggageCount` ref
- [ ] 新增 `luggageItems` ref
- [ ] `SyncToStore` 與 `ClickSubmit` 對齊新欄位

### 3.3 BookingStepConfirm

- [ ] 行李顯示改成明細：「20" 登機箱 × 2、24-26" 中型 × 1」
- [ ] extras 顯示已是動態，沿用

### 3.4 store-order draft schema

- [ ] `luggageCount` 移除
- [ ] `luggageItems: []` 加入 draft + ResetDraft

### 3.5 lint + build pass

## Stage 4：fleet 頁改用動態 config

- [ ] `app/pages/fleet/index.vue`：
  - 移除 `import { VEHICLE_CONFIGS, EXTRA_SERVICES, EXTRA_SERVICE_PRICE }`
  - 車型卡片 v-for 改 `StoreConfig().vehicles`
  - 加值服務改 `StoreConfig().extras`
  - 車型規格顯示「行李 N SU」而非「N 件」
- [ ] lint + build pass

## Stage 5：admin/settings 新增 3 個 CRUD 區塊

### 5.1 列表 + 編輯彈窗組件抽象

- [ ] `app/components/admin/SettingsFleetVehicles.vue`：
  - 表格列出 vehicles（含 enabled toggle）
  - 「新增」開彈窗、「編輯」開彈窗、「刪除」確認後呼叫 API
  - 編輯彈窗：三語 label / capacity / luggageSU / baseFare / perKmRate / icon / sortOrder
- [ ] `app/components/admin/SettingsFleetLuggageTypes.vue`：類似結構，SU 值可改
- [ ] `app/components/admin/SettingsFleetExtras.vue`：類似結構，可新增/刪除任意項目

### 5.2 admin/settings/index.vue tab 整合

- [ ] 加 3 個新 tab 或 section：「車型 / 行李 / 加值服務」
- [ ] 從 `StoreConfig()` 讀取列表，動作後 reload store

### 5.3 lint + build pass

## Stage 6：order schema 改造 + driver/admin modal

### 6.1 type + server

- [ ] `CreateOrderParams.luggageCount` 移除、加 `luggageItems`
- [ ] `server/routes/nuxt-api/orders/index.post.ts`：CreateOrderBody 改 + 寫入 Firestore
- [ ] `assigned.get.ts` 加 `luggageItems` 回傳

### 6.2 driver/admin modal 顯示

- [ ] `app/pages/driver/trip/index.vue`：行李顯示改明細
- [ ] `app/pages/admin/orders/index.vue`：modal 行李顯示改明細
- [ ] `app/pages/upcoming/index.vue`：乘客自己看訂單同步調整

### 6.3 i18n 清理

- [ ] zh/en/ja 移除 `fleet.vehicleType.*` 跟 `fleet.extras.*` 三檔對應 key（label 已移到 Firestore）
- [ ] 新增 SU 相關 key：`booking.luggage.suTotal`、`booking.luggage.suExceed`、`booking.luggage.suWarn`

### 6.4 lint + build pass

## Stage Gate

- [ ] G1 server endpoints 完整可 CRUD（含 admin auth）
- [ ] G2 fleet 頁所有資料來自 Firestore
- [ ] G3 booking 行李 stepper 動態渲染 + SU 計算正確
- [ ] G4 超 SU 1.5 倍車型卡片 disabled + 紅字
- [ ] G5 admin/settings 可新增/編輯/刪除三種資源
- [ ] G6 三語 label 在 fleet/booking 切換語言正確顯示
- [ ] G7 訂單寫入 Firestore 含 luggageItems，driver/admin modal 顯示明細
- [ ] G8 既有 luggageCount 訂單清庫前 driver/admin modal 不噴錯（用 `?? []` fallback）

## 工作量估算

| Stage | 預估 diff | session |
|---|---|---|
| 1 | ~300 行 | 1 |
| 2 | ~150 行 | 0.5 |
| 3 | ~200 行 | 0.5 |
| 4 | ~80 行 | 0.3 |
| 5 | ~500 行 | 1 |
| 6 | ~150 行 | 0.5 |
| **總** | **~1400 行** | **3-4 session** |
