# Charter Fare V1 — Tasks

## W1：型別 + Firestore schema + 測試骨架（本視窗）

- [x] **W1.1** 建立 OpenSpec change `2026-05-28-charter-fare-v1/`（proposal / design / tasks / spec.md）
- [x] **W1.2** `shared/pricing.ts` 加 types
  - [x] `CharterPlanKey = '4h' | '8h' | '10h'`
  - [x] `interface CharterPlan`（durationHours / basePrice / includedKm / extraKmRate / overtimeRatePer30min / enabled）
  - [x] `interface CharterMountainRule`（enabled + tiers，重用 `MountainTier`）
  - [x] `interface CharterRule`（rounding / overtimeGraceMin / roundTripFlatFee / roundTripBufferKm / roundTripOverShootMaxKm / overnightFlatFee / mountain / applySurchargeWindows / applyPromoWindows）
  - [x] `FareRules` 加 `charter: CharterRule`
  - [x] `DEFAULT_FARE_RULES.charter` 預設值（design.md schema）
- [x] **W1.3** `shared/pricing.ts` 加 `interface CharterFareBreakdownV2`
- [x] **W1.4** `shared/pricing.ts` 加 `calculateCharterFareV2` stub（throw `'charter fare engine not implemented yet — W2'`）
- [x] **W1.5** `app/protocol/fetch-api/api/config/type.d.ts` `FleetVehicleDto` 加 `charterPlans?: Record<CharterPlanKey, CharterPlanDto>`
- [x] **W1.6** `app/protocol/fetch-api/api/order/type.d.ts` 加
  - [x] `interface OrderCharter`（planKey / days / plans / estimatedEndTime / actualEndTime / overtimeMinutes / overtimeBlocks / overtimeCharge / isRoundTrip / isMountain / mountainMul / nights / distanceKm / stopovers）
  - [x] `OrderDetail.charter?: OrderCharter | null`
  - [x] `CreateOrderParams.charter?: { planKeys: CharterPlanKey[]; days: number }`（W2 server 端用）
- [x] **W1.7** `shared/pricing.spec.ts` 加 `describe('calculateCharterFareV2', ...)` block + 14 個 `it.todo`
- [x] **W1.8** 終局檢查：`pnpm lint:fix && pnpm build && pnpm test` 全綠
- [x] **W1.9** git commit + push origin main（直推 prod）
- [x] **W1.10** 寫 W2 handoff prompt（單塊 code block，無嵌套 fence）給 Brain AI

## W2：計費引擎實作（下視窗）

- [ ] W2.1 實作 `calculateCharterFareV2`（移除 stub throw，填入完整公式）
  - [ ] planBasePriceSum / extraKmCharge / baseLayer
  - [ ] mountainMul（重用 `computeMountainMul`，但帶 `charter.mountain` 而非 `rules.mountain` 的 tiers — 需擴充或新增 `computeCharterMountainMul`）
  - [ ] roundTripFee / overnightFee / overtimeCharge
  - [ ] extrasTotal
  - [ ] surcharge / promoDiscount（套 `applySurchargeWindows` / `applyPromoWindows` toggle + `orderType='charter'` 過濾）
  - [ ] raw / final（rounding 套 `charter.rounding`，Math.max(0, ...) 保底）
- [ ] W2.2 來回判定演算法
  - [ ] `shortestDistanceKmFromPointToPolyline(point, polyline)` 純函式（point-to-segment haversine 投影）
  - [ ] `detectRoundTrip(A, X, D, returnLegPolyline, charter)`
- [ ] W2.3 Routes API 整合
  - [ ] `server/utils/route-metrics.ts` charter 模式擴充：除整段 polyline 外，另取「X→A」polyline（最後 stopover 回上車點）
  - [ ] `server/api/maps/route.get.ts` 支援 `orderType=charter` query：回傳 `returnLegPolyline` + `isRoundTrip` flag
- [ ] W2.4 14 個 `it.todo` 全部實作（變成 `it(...)`）+ expect
- [ ] W2.5 charter 訂單建立編排層（`server/routes/nuxt-api/orders/index.post.ts`）
  - [ ] orderType=charter + vehicle.charterPlans 齊全 → calculateCharterFareV2
  - [ ] 缺 plans → fallback fare-v2 + line_api_errors warning
  - [ ] orders/{id}.charter snapshot 寫入（含 plans 完整 freeze 避免 fleet_vehicles 後續變動影響歷史單）
- [ ] W2.6 vitest 28+ 測試全綠 + lint + build + push main

## W3：Admin UI（後續）

- [ ] W3.1 `/admin/settings` 加「包車車資 v1」section（super only）
  - [ ] 基本（rounding / grace / 來回 / 過夜固定值）
  - [ ] 山區階梯（沿用 fare-v2 三訊號偵測；僅 multiplier tiers 獨立）
  - [ ] applySurchargeWindows / applyPromoWindows toggle
- [ ] W3.2 `SettingsFleetVehicles.vue` 加 `charterPlans` CRUD（每車型 3 個 plan card：4h / 8h / 10h）
- [ ] W3.3 `AdminCharterFareCalculatorPreview.vue` 試算機（distanceKm / days / plan / estimatedEnd / actualEnd / mountain 訊號 → 完整明細）
- [ ] W3.4 admin/fare-rules PATCH 既有 endpoint 擴 charter block 驗證

## W4：Booking UI（後續）

- [ ] W4.1 `BookingStepBasic`：orderType=charter 觸發「行程天數」selector（預設 1，1-7 天）
- [ ] W4.2 `BookingStepOptions`：days > 1 渲染「每天 plan picker」（同車型，可不同 plan）
- [ ] W4.3 charter 訂單 stopover 編輯增強（拖拉 / 刪除）
- [ ] W4.4 明細卡：charter 訂單顯示完整 `CharterFareBreakdownV2`（plan basePrice 加總 / 超公里 / 山區 / 來回 / 過夜 / OT 預估 / extras / surcharge / promo）

## W5：Driver App + Admin 對帳（後續）

- [ ] W5.1 driver 結束包車任務按鈕：寫 `orders/{id}.charter.actualEndTime`
- [ ] W5.2 server trigger：actualEndTime 寫入時重算 `overtimeMinutes` / `overtimeBlocks` / `overtimeCharge` 回寫 charter block
- [ ] W5.3 admin `/admin/orders/[id]` 顯示 OT 對帳區（estimated / actual / blocks / charge）+ 司機應跟客人收的金額提示
- [ ] W5.4 不寄通知客人（W5 hardcode 不發 LINE flex）

## 待 archive 條件

⏳ **未 archive**：等 W5 完工 + Brain AI 在 prod 估價 5 條包車路線（1 日 / 多日 / 山區 / 來回 / OT）都報合理後跑 `openspec archive 2026-05-28-charter-fare-v1`。
