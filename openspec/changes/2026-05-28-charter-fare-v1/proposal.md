# Charter Fare V1 — 包車車資（時長套餐 + 超時 + 過夜 + 來回 + 山區）

> Brain AI（架構師）與 Claude（Execution AI）2026-05-28 鎖定。
> 範圍：包車訂單（`orderType='charter'`）獨立計費路徑；不影響既有 fare-v2（接送 / 送機 / 交通接送）。

## Why

現行 `calculateFareV2`（fare-v2 公式）以「距離 + 時間 + 山區 + 跨縣市 + 國道」計價，**適用單點到單點接送**。包車的真實成本結構不同：

- **時長套餐**：包車是「司機 + 車輛時段租用」，計費單位是**小時**而非公里 — 4 小時 / 8 小時 / 10 小時三種市面常見組合
- **多停留點**：包車路線常有多個 stopover（觀光 / 用餐 / 購物），距離只是其中一個維度，總時長才是司機機會成本
- **超時 OT**：實際結束時間超過 plan 時長 → 按 30 分鐘為單位加收，且司機現場跟客人收費（系統不通知客）
- **多日 / 過夜**：跨日包車要按天分別選 plan，並加收司機住宿補貼
- **來回判定**：「最後停靠點回上車點」是常見需求，依路徑幾何特徵判定有別於距離

包車流量雖小於接送，但客單價是接送 5-10 倍，公式不對會直接吃利潤或失客。

## What Changes

### 新公式骨架（hardcode in `shared/pricing.ts::calculateCharterFareV2`）

```
A = plan.basePrice                                              # 套餐底價
B = max(0, distanceKm - plan.includedKm) * plan.extraKmRate     # 超公里加收
mountainScaled = (A + B) * mountainMul                          # 山區係數作用於 A + B

C = isRoundTrip ? roundTripFlatFee : 0                          # 來回固定加收
D = nights * overnightFlatFee                                   # 過夜固定加收（每晚）
E = overtimeBlocks * plan.overtimeRatePer30min                  # OT 段加收
F = Σ extras.price                                              # 加值服務
G = surcharge                                                   # 時段加價（複用 fare-v2）
H = promoDiscount                                               # 時段優惠（複用 fare-v2）

raw   = mountainScaled + C + D + E + F + G - H
final = ⌈ raw / charter.rounding ⌉ × charter.rounding
```

**包車不套用** fare-v2 的：`crossCountyFee`、`freewayToll`、`distanceTier`（距離分段折扣，包車已含 includedKm 在 plan）

### 三檔套餐（每車型獨立設定）

| Plan | durationHours | 適用情境 |
|------|---|---|
| `4h` | 4 | 半日遊（北投 / 淡水半日） |
| `8h` | 8 | 全日遊（九份 / 平溪一日） |
| `10h` | 10 | 多點全日（環雙北 / 阿里山接駁） |

每 plan 持有：`basePrice` / `includedKm` / `extraKmRate` / `overtimeRatePer30min` / `enabled`。
admin 可在 `/admin/settings`（fleet vehicles 區）為每車型獨立配置 3 個 plan。

### 來回判定（演算法）

```
A = pickupLocation, X = 最後 stopover, D = dropoffLocation

條件 1：D 到 (X → A polyline) 最短距離 ≤ charter.roundTripBufferKm（預設 5 km）
條件 2：D 到 A 直線距離 ≤ charter.roundTripOverShootMaxKm（預設 15 km，過頭情境）

isRoundTrip = 條件 1 OR 條件 2
```

W1 只定義 type / breakdown / config；演算法在 W2 細究實作（含 polyline shortest-distance 數學）。

### OT 計算

```
plannedEnd = pickupTime + plan.durationHours
actualEnd = driver app 紀錄（W5 整合）
overtimeMin = max(0, (actualEnd - plannedEnd 分鐘) - charter.overtimeGraceMin)   # 預設 grace 15 min
overtimeBlocks = overtimeMin > 0 ? ⌈ overtimeMin / 30 ⌉ : 0
overtimeCharge = overtimeBlocks * plan.overtimeRatePer30min
```

**收費方式**：司機現場跟客人收（現金 / 刷卡），系統不通知客人。admin 後台顯示 OT charge 作對帳參考。

### 多日 / 過夜

booking 加「行程天數」selector（預設 1）→ `days > 1` 觸發每天獨立選 plan（同車型，可不同 plan）→ `nights = days - 1` × `overnightFlatFee`（預設 NT$2000/晚，admin 可調）。

### 山區係數（沿用 fare-v2 訊號偵測）

- **訊號**：fareRules.mountain 三訊號（海拔 / 曲折度 / 無塞時速 + `apiSourcesOk` 偵測）— **不重做偵測**
- **multiplier**：`charter.mountain.tiers` 獨立階梯（預設 2 分 1.4x / 3 分 1.6x，admin 可調，與 fare-v2 1.3/1.5 分離）

### 新增 Firestore schema

- `fare_rules/v1` 加 `charter` block（CharterRule）— 既有 doc 擴充，不另開 collection
- `fleet_vehicles/{vehicleId}` 加 optional `charterPlans` map（CharterPlanKey → CharterPlan）
- `orders/{orderId}` charter 訂單加 `charter` block（OrderCharter snapshot）

### 新增 / 修改程式碼

| 檔案 | 動作 |
|---|---|
| `shared/pricing.ts` | 加 `CharterPlanKey` / `CharterPlan` / `CharterRule` / `CharterFareBreakdownV2` / `calculateCharterFareV2` stub |
| `shared/pricing.spec.ts` | 加 14 個 `it.todo`（W2 實作填入）|
| `app/protocol/fetch-api/api/config/type.d.ts` | `FleetVehicleDto` 加 `charterPlans?` |
| `app/protocol/fetch-api/api/order/type.d.ts` | 加 `OrderCharter` interface；`OrderDetail` 加 `charter?` |

### 不在本變更（後續 W2-W5）

- **W2**：計費引擎實作（14 個 `it.todo` 對應實作）+ 來回判定演算法 + Routes API 多段路線整合
- **W3**：Admin UI（`/admin/settings` 加 charter 規則編輯 + 試算機）+ 車型 charterPlans CRUD
- **W4**：Booking UI（orderType=charter 時的天數 selector / 每天 plan picker / stopover 拖拉 / 明細卡）
- **W5**：Driver app 整合（actualEndTime 紀錄 + OT 段計算回寫 + admin 後台對帳視圖）

## Impact

### Affected specs
- 新建：`charter-fare`（本變更鎖定 W1 範圍）
- 之後修改（W3-W5）：`booking-flow`、`admin-settings`、`driver-trip-mission`

### Affected code

W1 範圍僅型別 + stub + 文件：

| 檔案 | 動作 |
|---|---|
| `shared/pricing.ts` | 加 charter types + `DEFAULT_FARE_RULES.charter` + `calculateCharterFareV2` stub |
| `shared/pricing.spec.ts` | 加 charter describe + 14 個 `it.todo` |
| `app/protocol/fetch-api/api/config/type.d.ts` | `FleetVehicleDto.charterPlans?` |
| `app/protocol/fetch-api/api/order/type.d.ts` | `OrderCharter` + `OrderDetail.charter?` |

### 不影響
- 現行 fare-v2（接送 / 送機 / 交通接送）公式完全不動
- 既有 13 個 fare-v2 vitest 測試持續綠
- 既有 charter 訂單（若有）的 `estimatedFare` 不重算
- `fleet_vehicles.charterPlans` 缺省時 charter 訂單 fallback fare-v2（W2 編排層決定）

## 待 Brain AI 拍板的參數（W2-W3 之前）

業務邏輯已 hardcode（不需拍板）：
- 公式骨架（`(A+B)×mountainMul + C + D + E + F + G − H` → 最後進位）
- 山區判定：沿用 fare-v2 三訊號偵測，僅 multiplier 階梯獨立
- 來回判定：兩條件 OR
- OT 計算：寬限 + 30 min 段
- 過夜費：扁平加總 `nights × overnightFlatFee`

CharterRule 預設值（design.md schema）：

| 欄位 | 預設 |
|---|---|
| `rounding` | 100 |
| `overtimeGraceMin` | 15 |
| `roundTripFlatFee` | 1500 |
| `roundTripBufferKm` | 5 |
| `roundTripOverShootMaxKm` | 15 |
| `overnightFlatFee` | 2000 |
| `mountain.tiers` | `[{ minScore: 2, multiplier: 1.4 }, { minScore: 3, multiplier: 1.6 }]` |
| `applySurchargeWindows` | true |
| `applyPromoWindows` | true |

每車型 CharterPlan 預設（admin 在 W3 之後填）：W1 不強制給數字 — 留空時 charter 訂單 fallback fare-v2（W2 編排層決定）。
