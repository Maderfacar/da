# P23 Fleet 設定動態化 — admin/settings 可編輯所有計價參數 + 行李 SU 制

## Why

目前 fleet 顯示資訊全 hardcode 在 [shared/pricing.ts](shared/pricing.ts)：

- `VEHICLE_CONFIGS`：4 種車型的 capacity / luggageCapacity / baseFare / perKmRate 寫死
- `EXTRA_SERVICES`：4 項加值服務寫死
- `EXTRA_SERVICE_PRICE = 200`：所有加值服務共用同一價格
- booking `luggageCount` 是單一數字，無法區分行李尺寸

業務需求改變時必須改 code + redeploy，admin 無法即時調整。本 spec 把所有 fleet 計價參數移到 Firestore，admin 可在 `/admin/settings` 即時編輯，並引入業界通行的 **SU（Standard Unit）** 行李容量制。

## What Changes

### 1. 配置全面動態化（Firestore）

新增 3 個 Firestore collection：

| Collection | 用途 |
|---|---|
| `fleet_vehicles/{vehicleId}` | 車型：label(三語) / capacity / luggageSU / baseFare / perKmRate / icon / sortOrder / enabled |
| `fleet_luggage_types/{typeId}` | 行李類型：label(三語) / su / sortOrder（admin 可改 SU 值） |
| `fleet_extras/{extraId}` | 加值服務：label(三語) / price / icon / sortOrder / enabled（admin 可任意新增/刪除） |

### 2. SU（Standard Unit）行李制

初始 seed 值（admin 上線後可隨時改）：

**行李類型**：

| typeId | 中文 | EN | JA | SU |
|---|---|---|---|---|
| `small` | 20 吋以下登機箱 | Carry-on (≤ 20") | 機内持込（20"以下） | 1 |
| `medium` | 24-26 吋中型 | Medium (24-26") | 中型（24-26"） | 2 |
| `large` | 28-32 吋大型 | Large (28-32") | 大型（28-32"） | 3 |
| `special` | 特殊物品（高爾夫袋/嬰兒車） | Special (golf bag / stroller) | 特殊（ゴルフ/ベビーカー） | 4 |

**車型 SU 容量**：

| vehicleId | 中文 | capacity | luggageSU | baseFare | perKmRate |
|---|---|---|---|---|---|
| `sedan` | 轎車 | 3 | 4 | 300 | 25 |
| `suv` | 休旅車 | 6 | 7 | 400 | 35 |
| `van` | 廂型車 | 8 | 14 | 500 | 40 |
| `premium` | 豪華轎車 | 4 | 4 | 800 | 60 |

### 3. Booking 行李 UI 重構

- `luggageCount: number` → `luggageItems: { typeId: string; count: number }[]`
- BookingStepOptions 把單一 number stepper 改為 **4 個 stepper**（依 `fleet_luggage_types` 動態渲染）
- 即時顯示「目前 X SU / 上限 Y SU」進度條
- 超出處理：
  - 總 SU > 車型 capacity ×1.5 → **車型卡片 disabled** + 紅字「行李超出車型容量」
  - 車型 capacity < 總 SU ≤ 車型 capacity ×1.5 → 警告但可繼續
- 加值服務改為 `fleet_extras` collection 動態渲染（每項自己的價格）

### 4. Admin/settings 加 3 個 CRUD 區塊

- 「**車型管理**」tab：列表 + 新增/編輯/刪除/啟用切換，編輯彈窗含三語 label
- 「**行李類型**」tab：列表 + 編輯 SU 值 + 三語 label
- 「**加值服務**」tab：列表 + 新增/編輯/刪除/啟用切換 + 三語 label + icon picker（或 emoji 文字輸入）

### 5. 訂單 schema 改造

- `CreateOrderParams.luggageCount: number` → 移除
- 新增 `CreateOrderParams.luggageItems: Array<{ typeId: string; count: number }>`
- Firestore order doc 同步改寫
- driver/admin trip modal 改顯示「20" 登機箱 × 2、24-26" 中型 × 1」這種明細
- **既有測試訂單不兼容**（user 確認上線前可清庫）

### 6. shared/pricing.ts 退役

- `VEHICLE_CONFIGS` / `EXTRA_SERVICES` / `EXTRA_SERVICE_PRICE` 全部移除
- `calculateFare` 改接 `VehicleConfig` 物件參數而非 type key
- 8 個 import 點全改走新 `StoreConfig()` Pinia store

## Capabilities

### New

- `fleet-config-admin`：admin 可在 `/admin/settings` 即時編輯車型/行李/加值服務
- `luggage-su-calculation`：booking 表單 SU 動態計算 + 車型容量校驗

### Modified

- `passenger-booking`：行李欄位 + 車型選擇邏輯重構
- `passenger-fleet-page`：改讀動態 config
- `order-data-model`：`luggageCount` 移除，新增 `luggageItems`
- `driver-trip-mission` / `admin-orders`：modal 顯示行李明細

### Removed

- `shared/pricing.ts` 內 hardcoded `VEHICLE_CONFIGS` / `EXTRA_SERVICES` / `EXTRA_SERVICE_PRICE` 三個常數

## Impact

- **影響 8 個 import 檔**：fleet/index.vue、booking/index.vue、BookingStepOptions、BookingStepConfirm、driver/trip、admin/orders、upcoming、store-order
- **i18n**：fleet/booking 既有 `fleet.extras.*` / `fleet.vehicleType.*` keys 改為從 Firestore label 三語讀取，i18n 檔對應 key **可移除**（avoid double-source-of-truth）
- **舊訂單**：不兼容，user 確認上線前清測試資料
- **Firestore 初始化**：seed script 或 admin/settings 首次開啟自動 seed defaults
- **效能**：fleet config 啟動時 fetch 一次後 cache 於 Pinia，admin 改完後手動 reload（或建 listener，本 spec 不做）

## Out of Scope

- icon picker 進階 UI（先用 emoji 或 mdi 字串輸入）
- 加值服務的「按時計費 / 條件式定價」（先一律單次定額）
- 多幣別（先 TWD only）
- admin 編輯後即時推播給所有在線乘客（先 reload page 才生效）
