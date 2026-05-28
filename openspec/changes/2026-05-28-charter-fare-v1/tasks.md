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

## W2：計費引擎實作（本視窗）

- [x] **W2.1** 實作 `calculateCharterFareV2`（移除 stub throw，填入完整公式）
  - [x] planBasePriceSum / extraKmCharge / baseLayer
  - [x] mountainMul（抽 `computeMountainScoreFromMetrics` helper，`computeMountainMul`（fare-v2）與 `computeCharterMountainMul`（charter）共用三訊號偵測；tiers 各自獨立）
  - [x] roundTripFee / overnightFee / overtimeCharge（`computeOvertimeBlocks` helper exported）
  - [x] extrasTotal
  - [x] surcharge / promoDiscount（套 `applySurchargeWindows` / `applyPromoWindows` toggle + `orderType='charter'` 過濾）
  - [x] raw / final（rounding 套 `charter.rounding`，Math.max(0, ...) 保底）
- [x] **W2.2** 來回判定演算法（新檔 `shared/geo/round-trip.ts`）
  - [x] `shortestDistanceKmFromPointToPolyline(point, encodedPolyline)` 純函式（equirectangular 投影 + haversine）
  - [x] `detectRoundTrip(A, X, D, returnLegPolyline, charter)` — X / polyline 任一 null → false
- [x] **W2.3** Routes API 整合
  - [x] 抽 polyline 純函式到 `shared/geo/polyline.ts`（server 端 re-export 維持 import 路徑相容）
  - [x] `server/utils/route-metrics.ts` 加 `fetchReturnLeg?: boolean` input + 取 X→A polyline 後 attach `RouteMetrics.returnLegPolyline`
  - [x] `server/api/maps/route.get.ts` 純幾何模式 + orderType=charter + 有 stopover → 回傳 `isRoundTrip` + `returnLegPolyline`（其他模式皆 null）
- [x] **W2.4** 14 個 `it.todo` 全部實作（變成 `it(...)`）+ expect；額外 7 個 `computeOvertimeBlocks` unit 測試（grace 邊界完整）
- [x] **W2.5** charter 訂單建立編排層（`server/routes/nuxt-api/orders/index.post.ts`）
  - [x] orderType=charter body 校驗（days 1-7 / planKeys 長度對齊 / key 合法）
  - [x] vehicle.charterPlans 齊全 → `getCharterRouteWithFare` → `orders/{id}.charter` 完整 snapshot（plans freeze）
  - [x] 缺 plans / engine throw → fallback fare-v2 + `line_api_errors` warning（charter-fare/* api 標記）
- [x] **W2.6** vitest 428 全綠（既有 407 + charter 14 + OT helper 7）+ lint + build + push main

## W3：Admin UI（本視窗）

- [x] **W3.1** `/admin/settings` 加「包車車資 v1」section（super only）
  - [x] 基本（rounding / grace / 來回 / 過夜固定值）
  - [x] 來回判定（buffer / overshoot）
  - [x] 山區階梯（沿用 fare-v2 三訊號偵測；僅 multiplier tiers 獨立，minScore 限 0-3 整數）
  - [x] applySurchargeWindows / applyPromoWindows toggle
  - [x] 沿用既有 ClickSaveFareRules（PATCH /admin/fare-rules）+ writeAuditLog 'fare_rules.update' 涵蓋 charter 變動
- [x] **W3.2** `SettingsFleetVehicles.vue` 加 `charterPlans` CRUD（每車型 3 個 plan card：4h / 8h / 10h + 「從其他車型複製套餐」快捷）
  - [x] fleet-config.ts FleetVehicle 加 charterPlans optional + validateVehiclePayload 接收並校驗（全 disabled → null 清除）
  - [x] ClickToggleEnabled 快速切啟用同步保留 charterPlans（避免 PUT 全量覆寫清掉）
  - [x] 既有 PUT /admin/config/vehicles/{id} audit log action 'fleet.update' 自動涵蓋 charterPlans 變動
- [x] **W3.3** `AdminCharterFareCalculatorPreview.vue` 試算機（純前端 calculateCharterFareV2，不打 Routes API）
  - [x] 車型 select（過濾 charterPlans 齊全 + at least 1 enabled）+ 1-7 天 + 每日 plan picker
  - [x] distanceKm / pickupTime / actualEndTime（空 = 不算 OT）/ 三山區訊號 toggle / 來回 override / extras
  - [x] estimatedEnd 自動推算（plans 時長累加）
  - [x] 完整 CharterFareBreakdownV2 明細 + daysBreakdown + OT 段數顯示
- [x] **W3.4** admin/fare-rules PATCH 既有 endpoint 擴 charter block 完整驗證
  - [x] charter.rounding 必須正整數
  - [x] charter.overtimeGraceMin 0-60 區間
  - [x] charter.mountain.tier.minScore 0-3 整數（新增 validateCharterMountainTiers helper，與 fare-v2 tiers 分離）
  - [x] 向後相容：raw.charter undefined → fallback DEFAULT_FARE_RULES.charter；存在但欄位錯 → 回 error

## W4：Booking UI（本視窗）

- [x] **W4.1** `BookingStepType`：orderType=charter 觸發「行程天數」selector（預設 1，1-7 天，7 顆 button grid + active 視覺）
- [x] **W4.2** `BookingStepOptions`：包車訂單顯示「每天 plan picker」（4h/8h/10h；days >= 1 都顯示，可日日不同）
  - [x] charter 車型過濾：vehicle.charterPlans 缺 / 全 disabled → 該車型 disabled + 「此車型尚未開放包車」hint
  - [x] charter 估價：client 用純幾何 `/api/maps/route` + orderType=charter 拿 isRoundTrip + distanceKm → `calculateCharterFareV2`（合成 RouteMetrics，山區 3 訊號取不到一律 1.0；server 編排會用真實 Routes API 重算）
  - [x] PassengerFareBreakdownCard charter 模式顯示 charterResult.final
- [x] **W4.3** charter 訂單 stopover 編輯（拖拉 / 刪除）— `BookingStepRoute` 既有 HTML5 drag + 刪除按鈕，charter / 其他訂單共用，W4 audit 確認完整無需新增
- [x] **W4.4** 明細卡：charter 訂單在 `BookingStepConfirm` 顯示完整 `CharterFareBreakdownV2`
  - [x] daysBreakdown 表格（Day N · {hours}h / NT$X）
  - [x] 各層級 line：planBasePriceSum / extraKmCharge / mountain×mul / roundTripFee / overnightFee / extras / surcharge / promoDiscount / raw
  - [x] OT 預估行：W4 估價階段 actualEndTime=null → 顯示 NT$0 + 「行程結束後實收」hint
  - [x] 估價說明 note：實際以行程結束系統重算為準
  - [x] 摘要區加 charterDays / charterPlan rows（i18n 三語齊）
- [x] **W4.5** `/nuxt-api/orders` POST body：booking `ClickSubmit` charter 訂單帶 `charter: { planKeys: planKeys.slice(0, days), days }`；W2 server 編排已校驗
- [x] **W4.6** i18n 三語齊（zh / en / ja）：booking.type.charterDays* + booking.options.charter* + booking.confirm.charter*

## W5：Driver App + Admin 對帳（本視窗）

- [x] **W5.1** driver 結束包車任務按鈕：charter 訂單 in_transit→completed 時 button label 改「結束包車任務」+ `PatchOrder` body 帶 `actualEndTime: nowIso`（非 charter 訂單沿用「乘客已下車（完成）」label）
- [x] **W5.2** server PATCH `/nuxt-api/orders/[orderId]` 對帳分支：
  - [x] `PatchOrderBody` 加 `actualEndTime?: string`；passenger 帶此欄位 forbidden（admin / driver 可帶）
  - [x] charter 訂單 + 有 charter.estimatedEndTime → 用 `computeCharterReconciliation` 重算 OT 三欄回寫 `charter.{actualEndTime,overtimeMinutes,overtimeBlocks,overtimeCharge}`（dayOnePlan = `charter.plans[0]` snapshot freeze；rules 從 `getFareRules()` 取）
  - [x] 不動 `estimatedFare`；admin 對帳區自行呈現「乘客現付 = estimatedFare + overtimeCharge」
  - [x] 寫 `audit_logs` action `'order.charter.actual_end'`（actor 不限 admin，driver 自結也記錄；fire-and-forget silent）
  - [x] 不寄通知客人（W5 hardcode）
- [x] **W5.3** admin `/admin/orders` modal 加包車 OT 對帳區（`selectedOrder.charter` 存在才顯示）：預估結束 / 實際結束（未填時黃 hint「司機尚未結束行程」）/ 超時分鐘 / OT 段數 / OT 加收 / 「司機應現場收取」高亮金額（`CharterDriverCollectAmount = estimatedFare + overtimeCharge`）
- [x] **W5.4** 純函式抽出 + 單元測試：
  - [x] `shared/pricing.ts` 加 `computeCharterReconciliation` helper（純函式對帳，PATCH endpoint 共用）
  - [x] `shared/pricing.spec.ts` 加 3 unit tests（提早結束 / 剛超 grace +16 min / +75 min 多段 OT）
  - [x] `AdminOrder` 加 `charter?: OrderCharter | null`；`server/routes/nuxt-api/admin/orders/index.get.ts` echo charter 欄位（plain object 無 Timestamp）

## 待 archive 條件

⏳ **未 archive**：W5 已上 prod，等 Brain AI 在 prod 估價 5 條包車路線（1 日 / 多日 / 山區 / 來回 / OT）都報合理後跑 `openspec archive 2026-05-28-charter-fare-v1`。
