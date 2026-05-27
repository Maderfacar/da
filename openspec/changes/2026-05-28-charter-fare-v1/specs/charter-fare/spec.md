## ADDED Requirements

### Requirement: 包車車資公式骨架
系統 SHALL 在 `shared/pricing.ts::calculateCharterFareV2` 提供包車（`orderType='charter'`）獨立計費路徑。公式骨架為：

```
A = plan.basePrice（多日累加）
B = max(0, distanceKm − plan.includedKm) × plan.extraKmRate
mountainScaled = (A + B) × mountainMul
raw = mountainScaled + roundTripFee + overnightFee + overtimeCharge + extrasTotal + surcharge − promoDiscount
final = ⌈ raw / charter.rounding ⌉ × charter.rounding
```

公式 MUST hardcode 於 `shared/pricing.ts`，**不可改**：
- 套餐底價（A）+ 超公里加收（B）**被**山區係數連乘
- 來回 / 過夜 / OT / extras / 時段加減 **不被**山區係數連乘
- 進位**只執行一次**（最後一步，用 `charter.rounding`，非 `rules.rounding`）
- 包車**不套**：`crossCountyFee`、`freewayToll`、`distanceTier`（與 fare-v2 公式關鍵差異）

#### Scenario: W1 stub 拋例外
- **WHEN** W1 階段呼叫 `calculateCharterFareV2(...)`
- **THEN** 拋出 `Error('charter fare engine not implemented yet — W2')`
- **AND** 既有 13 個 fare-v2 vitest 測試持續綠
- **AND** 14 個 charter `it.todo` 顯示為 todo，不 fail

#### Scenario: 公式骨架不被改動
- **WHEN** W2 實作後修改公式
- **THEN** 必須維持「(A+B)×mountainMul + C + D + E + F + G − H」結構
- **AND** 進位只執行一次
- **AND** crossCountyFee / freewayToll / distanceTier **不**參與包車計算

### Requirement: 三檔時長套餐
系統 SHALL 提供三檔時長套餐（`CharterPlanKey = '4h' | '8h' | '10h'`），每車型可獨立配置。每 plan 持有：

- `key: CharterPlanKey`
- `durationHours: number`（4 / 8 / 10）
- `basePrice: number`（套餐底價）
- `includedKm: number`（含里程）
- `extraKmRate: number`（超公里 NTD/km）
- `overtimeRatePer30min: number`（OT 段價 NTD / 30min）
- `enabled: boolean`

#### Scenario: 三 plan key 鎖定
- **WHEN** 讀取 `shared/pricing.ts`
- **THEN** 匯出 `CharterPlanKey` 為 `'4h' | '8h' | '10h'` union（不可擴充其他鍵）
- **AND** 匯出 `CharterPlan` interface 含上述 7 欄位

#### Scenario: fleet_vehicles 持有 plans
- **WHEN** 讀取 `FleetVehicle` / `FleetVehicleDto` 型別
- **THEN** 包含 `charterPlans?: Record<CharterPlanKey, CharterPlan>` optional 欄位
- **AND** 缺省為合法狀態（W2 編排層 fallback fare-v2）

### Requirement: CharterRule Firestore schema
系統 SHALL 在 `fare_rules/v1.charter` 路徑存包車規則。`CharterRule` 包含：

- `enabled: boolean`
- `rounding: number`（最終進位基數）
- `overtimeGraceMin: number`（OT 寬限分鐘）
- `roundTripFlatFee: number`（來回固定加收 NTD）
- `roundTripBufferKm: number`（D 到 X→A 走廊距離門檻）
- `roundTripOverShootMaxKm: number`（D 到 A 直線距離門檻）
- `overnightFlatFee: number`（每晚過夜固定加收 NTD）
- `mountain: CharterMountainRule`（enabled + tiers，獨立於 fare-v2 山區階梯）
- `applySurchargeWindows: boolean`（是否套 fare-v2 加價時段）
- `applyPromoWindows: boolean`（是否套 fare-v2 優惠時段）

#### Scenario: DEFAULT_FARE_RULES.charter 預設值
- **WHEN** 讀取 `DEFAULT_FARE_RULES.charter`
- **THEN** `rounding === 100`
- **AND** `overtimeGraceMin === 15`
- **AND** `roundTripFlatFee === 1500`
- **AND** `roundTripBufferKm === 5`
- **AND** `roundTripOverShootMaxKm === 15`
- **AND** `overnightFlatFee === 2000`
- **AND** `mountain.tiers === [{ minScore: 2, multiplier: 1.4 }, { minScore: 3, multiplier: 1.6 }]`
- **AND** `applySurchargeWindows === true`
- **AND** `applyPromoWindows === true`

### Requirement: 山區係數沿用 fare-v2 訊號偵測
系統 SHALL 在包車計費時沿用 fare-v2 的 `RouteMetrics` 山區三訊號偵測（海拔起伏 / 曲折度 / 無塞時速 + `apiSourcesOk` 降級），但 multiplier 階梯 MUST 獨立來自 `charter.mountain.tiers`（預設 2 分 1.4x、3 分 1.6x）。

#### Scenario: 三訊號達標分數沿用
- **WHEN** 計算包車山區係數
- **THEN** score 計算邏輯與 `computeMountainMul`（fare-v2）一致
- **AND** `apiSourcesOk.routes=false` 時 freeFlow 訊號歸 0
- **AND** `apiSourcesOk.elevation=false` 時 elevation 訊號歸 0

#### Scenario: 階梯獨立
- **WHEN** 包車 score === 2
- **THEN** mountainMul === 1.4（非 fare-v2 的 1.3）
- **AND** 包車 score === 3 時 mountainMul === 1.6（非 1.5）

### Requirement: 來回判定演算法
系統 SHALL 在 W2 提供來回判定（W1 僅鎖定介面 + 預設值）：

```
A = pickupLocation, X = 最後 stopover, D = dropoffLocation

條件 1：D 到 (X→A polyline) 最短距離 ≤ charter.roundTripBufferKm
條件 2：D 到 A 直線距離 ≤ charter.roundTripOverShootMaxKm

isRoundTrip = 條件 1 OR 條件 2
```

無 stopover 時 `isRoundTrip` MUST 為 `false`。

#### Scenario: W1 介面鎖定
- **WHEN** 讀取 `OrderCharter` interface
- **THEN** 含 `isRoundTrip: boolean` 欄位
- **AND** `CharterRule` 含 `roundTripBufferKm` + `roundTripOverShootMaxKm` + `roundTripFlatFee`

#### Scenario: 無 stopover → false
- **WHEN** 訂單無 stopover
- **THEN** `isRoundTrip === false`（W2 實作必須遵守）
- **AND** `roundTripFee === 0`

### Requirement: OT 計算（30 min 段價）
系統 SHALL 計算 OT 段數：

```
plannedEnd = pickupTime + Σ plans.durationHours
effectiveEnd = actualEndTime ?? plannedEnd
overshootMin = max(0, (effectiveEnd − plannedEnd 分鐘) − charter.overtimeGraceMin)
overtimeBlocks = overshootMin > 0 ? ⌈ overshootMin / 30 ⌉ : 0
overtimeCharge = overtimeBlocks × plan.overtimeRatePer30min（用第一天 plan 的費率）
```

收費方式：司機現場跟客人收（現金 / 刷卡），系統 MUST NOT 寄通知客人。

#### Scenario: 寬限內不收
- **WHEN** actualEnd − plannedEnd === 14 分鐘（≤ grace 15）
- **THEN** `overtimeBlocks === 0`

#### Scenario: 寬限邊界（15 min）
- **WHEN** actualEnd − plannedEnd === 15 分鐘
- **THEN** `overshootMin === 0`
- **AND** `overtimeBlocks === 0`

#### Scenario: 寬限後 1 分鐘 → 1 段
- **WHEN** actualEnd − plannedEnd === 16 分鐘
- **THEN** `overshootMin === 1`
- **AND** `overtimeBlocks === 1`

#### Scenario: 寬限後 46 分鐘 → 2 段
- **WHEN** actualEnd − plannedEnd === 46 分鐘
- **THEN** `overshootMin === 31`
- **AND** `overtimeBlocks === 2`

#### Scenario: 提早結束 → 不收 OT
- **WHEN** actualEnd < plannedEnd
- **THEN** `overshootMin === 0`
- **AND** `overtimeBlocks === 0`

### Requirement: 多日 / 過夜
系統 SHALL 支援 1-7 日包車。`days > 1` 時：

- 每天獨立指定 plan（同車型，可不同 plan key）
- `nights = days − 1`
- 過夜費 = `nights × charter.overnightFlatFee`（預設 NT$2000/晚）
- includedKm / extraKmRate / overtimeRatePer30min 取「第一天 plan」為基準

#### Scenario: 單日不過夜
- **WHEN** `days === 1`
- **THEN** `nights === 0`
- **AND** `overnightFee === 0`

#### Scenario: 兩日一夜
- **WHEN** `days === 2` + `overnightFlatFee === 2000`
- **THEN** `nights === 1`
- **AND** `overnightFee === 2000`

#### Scenario: planBasePriceSum 多日累加
- **WHEN** `plans === [plan8h(basePrice=7800), plan8h(basePrice=7800)]`
- **THEN** `planBasePriceSum === 15600`

### Requirement: 訂單 snapshot
系統 SHALL 在 charter 訂單建立時於 `orders/{orderId}.charter` 寫入完整 snapshot（W2 實作；W1 鎖定型別）：

`OrderCharter` 必含：
- `planKey: CharterPlanKey`
- `days: number`（≥ 1）
- `plans: CharterPlan[]`（length === days）
- `estimatedEndTime: string`（ISO）
- `actualEndTime?: string`（ISO，W5 driver app 寫入）
- `overtimeMinutes?: number`
- `overtimeBlocks?: number`
- `overtimeCharge?: number`
- `isRoundTrip: boolean`
- `isMountain: boolean`
- `mountainMul: number`
- `nights: number`
- `distanceKm: number`
- `stopovers: Array<{ name: string; lat: number; lng: number; order: number }>`

snapshot 寫入後 admin 改 `fleet_vehicles.charterPlans` MUST NOT 影響舊單（plans 整份 freeze）。

#### Scenario: OrderDetail 型別含 charter
- **WHEN** 讀取 `OrderDetail` interface（`app/protocol/fetch-api/api/order/type.d.ts`）
- **THEN** 含 `charter?: OrderCharter | null` 欄位
- **AND** 既有非 charter 訂單 `charter === null`（不影響）

### Requirement: vitest 測試骨架（W1）
系統 SHALL 在 `shared/pricing.spec.ts` 加 `describe('calculateCharterFareV2', ...)` block，包含 14 個 `it.todo` case，對應 W2 實作項目。

W1 階段 todo 不執行任何 expect，只標示「W2 待實作」。既有 fare-v2 / calculateFare / tagSurcharge 測試 MUST 繼續綠。

#### Scenario: 14 個 todo 齊全
- **WHEN** 跑 `pnpm test`
- **THEN** charter describe block 含 14 個 todo（顯示為 todo，不 fail 也不 pass）
- **AND** 既有測試全綠
