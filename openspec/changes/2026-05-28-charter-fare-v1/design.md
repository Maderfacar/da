# Charter Fare V1 — Design

> W1 範圍：型別 / Firestore schema / 公式骨架（stub）/ 14 個 vitest `it.todo`。
> W2 範圍：實作填滿 14 個 todo + 來回判定演算法 + Routes API 多段整合。
> W3 範圍：admin UI（設定 + 試算機）+ 車型 charterPlans CRUD。
> W4 範圍：booking UI（天數 selector + 每日 plan picker + 明細卡）。
> W5 範圍：driver app actualEndTime + OT 結算 + admin 對帳。

## 公式骨架（hardcode in `shared/pricing.ts`）

```ts
function calculateCharterFareV2(
  vehicle: Vehicle,                      // 帶 charterPlans 的車型
  planKeys: CharterPlanKey[],            // length = days
  routeMetrics: RouteMetrics,            // 含 distanceKm / mountainMul 訊號 / countiesVisited 等
  isRoundTripFlag: boolean,              // 來自呼叫端（W2 在編排層算）
  pickupTime: Date,
  estimatedEndTime: Date,
  actualEndTime: Date | null,            // null = 用 estimatedEndTime 估
  extras: Array<{ price: number }>,
  rules: FareRules,                      // 必含 charter block
): CharterFareBreakdownV2 {
  // -- 1. 多日 plan basePrice 加總（每日獨立 plan）+ 超公里加收 --
  const plans = planKeys.map(k => vehicle.charterPlans![k]);
  const planBasePriceSum = plans.reduce((s, p) => s + p.basePrice, 0);
  const dayOnePlan = plans[0]!;          // includedKm / extraKmRate 以「第一天 plan」為基準
  const extraKm = Math.max(0, routeMetrics.distanceKm - dayOnePlan.includedKm);
  const extraKmCharge = extraKm * dayOnePlan.extraKmRate;
  const baseLayer = planBasePriceSum + extraKmCharge;     // A + B

  // -- 2. 山區係數（沿用 fare-v2 三訊號偵測，但用 charter.mountain.tiers）--
  const mountainMul = computeCharterMountainMul(routeMetrics, rules.charter.mountain);
  const mountainScaled = baseLayer * mountainMul;

  // -- 3. 來回 / 過夜 / OT --
  const roundTripFee = isRoundTripFlag ? rules.charter.roundTripFlatFee : 0;        // C
  const nights = Math.max(0, planKeys.length - 1);
  const overnightFee = nights * rules.charter.overnightFlatFee;                     // D
  const overtimeBlocks = computeOvertimeBlocks(estimatedEndTime, actualEndTime, rules.charter);
  const overtimeCharge = overtimeBlocks * dayOnePlan.overtimeRatePer30min;          // E

  // -- 4. extras --
  const extrasTotal = extras.reduce((s, e) => s + e.price, 0);                       // F

  // -- 5. 時段加價 / 折扣（複用 fare-v2，charter 可 opt-out 用 applySurchargeWindows / applyPromoWindows）--
  const surcharge = rules.charter.applySurchargeWindows
    ? computeSurcharge(pickupTime, rules.surcharge, 'charter') : 0;                  // G
  const promoDiscount = rules.charter.applyPromoWindows
    ? computePromoDiscount(pickupTime, rules.promo, 'charter') : 0;                  // H

  // -- 6. 進位 --
  const raw = mountainScaled + roundTripFee + overnightFee + overtimeCharge + extrasTotal + surcharge - promoDiscount;
  const final = Math.max(0, Math.ceil(raw / rules.charter.rounding) * rules.charter.rounding);

  return {
    planBasePriceSum,
    extraKmCharge,
    baseLayer,
    mountainMul,
    mountainScaled,
    roundTripFee,
    overnightFee,
    overtimeCharge,
    extrasTotal,
    surcharge,
    promoDiscount,
    raw,
    final,
    daysBreakdown: planKeys.map((k, i) => ({ day: i + 1, planKey: k, basePrice: plans[i]!.basePrice })),
  };
}
```

**關鍵骨架（hardcode 不可改）：**
- 套餐底價（A）+ 超公里（B）→ **被**山區係數連乘
- 來回（C）/ 過夜（D）/ OT（E）/ extras（F）/ 時段加減（G/H）**不被**山區係數連乘，加在最後
- 進位**只執行一次**（最後一步）
- 包車**不套**：crossCountyFee / freewayToll / distanceTier（與 fare-v2 公式關鍵差異）

## 為什麼用 dayOnePlan 計 includedKm / extraKmRate？

多日包車真實情境：

- Day 1 客人接機 + 接駁旅館（短距離）；Day 2 全日景點（長距離跨縣市）；Day 3 送機
- 每天的 plan 反映該天「時長 + 包含里程」，但**整段行程的 distanceKm 是合一的**（routeMetrics 從 booking 拿一次 polyline）
- 拍板：用「第一天 plan」的 includedKm / extraKmRate 作為超公里計費基準 — 簡化心智 + 大部分情境第一天決定主要範圍
- W2 / W3 若 Brain AI 想改成「跨天平均 includedKm」或「逐日 RouteMetrics」可在 design.md 補章節，目前先以「第一天主導」實作。

## OT 計算

```ts
function computeOvertimeBlocks(
  estimatedEndTime: Date,
  actualEndTime: Date | null,
  charter: CharterRule,
): number {
  const effectiveEnd = actualEndTime ?? estimatedEndTime;
  const overshootMin = Math.max(0, (effectiveEnd.getTime() - estimatedEndTime.getTime()) / 60000 - charter.overtimeGraceMin);
  return overshootMin > 0 ? Math.ceil(overshootMin / 30) : 0;
}
```

| 情境 | overshootMin | overtimeBlocks |
|---|---|---|
| actualEndTime == null（下訂預估）| 0 | 0 |
| 提早結束（actual < estimated）| 0 | 0 |
| 寬限內（actual − estimated ≤ 15）| 0 | 0 |
| 寬限後 1 分（grace 16 min）| 1 | 1 |
| 寬限後 30 分（grace 45 min）| 30 | 1 |
| 寬限後 31 分（grace 46 min）| 31 | 2 |
| 寬限後 60 分（grace 75 min）| 60 | 2 |
| 寬限後 61 分（grace 76 min）| 61 | 3 |

**收費邊界**：W1 不寫驅動，W5 driver app 結束時記 actualEndTime → 算 overtimeBlocks → 顯示給司機「請跟客人收 NT$X 段費」。系統**不**寄通知客人。

## 來回判定演算法（W2 實作）

```ts
function detectRoundTrip(
  A: { lat: number; lng: number },        // pickupLocation
  X: { lat: number; lng: number },        // 最後 stopover（無 stopover 時 fallback false）
  D: { lat: number; lng: number },        // dropoffLocation
  returnLegPolyline: string,              // X → A 的編碼 polyline（W2 透過 Routes API 取）
  charter: CharterRule,
): boolean {
  if (!hasStopover) return false;                   // 沒有 stopover 視為直線去回 — 不算來回
  const cond1Km = shortestDistanceKmFromPointToPolyline(D, returnLegPolyline);
  const cond1 = cond1Km <= charter.roundTripBufferKm;            // 預設 5 km
  const cond2 = haversineKm(D, A) <= charter.roundTripOverShootMaxKm;  // 預設 15 km
  return cond1 || cond2;
}
```

**為什麼兩條件 OR**：
- 條件 1（D 在 X→A 走廊內）：客人「順路下車」— 主流情境
- 條件 2（D 直線距離 A 內）：客人「過頭下車」— X→A 已到家附近，D 落在 A 周邊 15 km 內仍視為來回

實作細節（W2）：
- `shortestDistanceKmFromPointToPolyline`：解碼 polyline 後對每段線段做 point-to-segment distance（haversine 投影），取最小值
- Routes API 多段路線整合：booking 端 polyline 已含 stopover；W2 需另取 X→A 一段 polyline（或從整段 polyline 反推 last-stop-to-pickup 線段）

## RouteMetrics 重用（W1 不擴充）

`RouteMetrics`（fare-v2 已定義）對 charter 提供：
- `distanceKm` — 整段含 stopover 總里程
- `elevationDiffM` / `sinuosity` / `freeFlowKmh` + `apiSourcesOk` — 山區三訊號（charter 沿用偵測）
- `countiesVisited` / `freewayKm` — charter **不用**（公式不套 cross-county / freeway-toll）

W2 視來回判定需求，可能在 `RouteMetrics` 加 `returnLegPolyline?: string`（X→A polyline），於 W2 的 design 補章節。

## CharterPlan 預設（W3 admin 填，W1 不強制）

W1 暫不給每車型預設值（避免提前鎖定數字）。W3 admin UI 上線後 Brain AI 填入。**參考數字**（design discussion only）：

| 車型 / Plan | basePrice | includedKm | extraKmRate | overtimeRatePer30min |
|---|--:|--:|--:|--:|
| sedan-suv / 4h | 4500 | 80 | 20 | 400 |
| sedan-suv / 8h | 7800 | 160 | 18 | 400 |
| sedan-suv / 10h | 9500 | 200 | 18 | 400 |
| mpv-family / 4h | 5500 | 80 | 25 | 500 |
| mpv-family / 8h | 9500 | 160 | 22 | 500 |
| mpv-family / 10h | 11500 | 200 | 22 | 500 |
| van-9 / 4h | 7000 | 80 | 30 | 700 |
| van-9 / 8h | 12000 | 160 | 28 | 700 |
| van-9 / 10h | 14500 | 200 | 28 | 700 |

> 上表純為 design discussion；不寫進 code / Firestore 預設。

## Firestore Schema

### `fare_rules/v1` 擴充

```jsonc
{
  // ... 既有 fare-v2 fields（version / currency / rounding / mountain / crossCounty / trafficJam / freeway / promo / surcharge / distanceTier）...

  "charter": {
    "enabled": true,
    "rounding": 100,
    "overtimeGraceMin": 15,
    "roundTripFlatFee": 1500,
    "roundTripBufferKm": 5,
    "roundTripOverShootMaxKm": 15,
    "overnightFlatFee": 2000,
    "mountain": {
      "enabled": true,
      "tiers": [
        { "minScore": 2, "multiplier": 1.4 },
        { "minScore": 3, "multiplier": 1.6 }
      ]
    },
    "applySurchargeWindows": true,
    "applyPromoWindows": true
  }
}
```

### `fleet_vehicles/{vehicleId}` 加 `charterPlans`

```jsonc
{
  // ... 既有 fields（label / capacity / luggageSU / baseFare / perKmRate / icon / sortOrder / enabled / tagline）...

  "charterPlans": {
    "4h":  { "key": "4h",  "durationHours": 4,  "basePrice": 4500, "includedKm": 80,  "extraKmRate": 20, "overtimeRatePer30min": 400, "enabled": true },
    "8h":  { "key": "8h",  "durationHours": 8,  "basePrice": 7800, "includedKm": 160, "extraKmRate": 18, "overtimeRatePer30min": 400, "enabled": true },
    "10h": { "key": "10h", "durationHours": 10, "basePrice": 9500, "includedKm": 200, "extraKmRate": 18, "overtimeRatePer30min": 400, "enabled": true }
  }
}
```

W1 schema 為**選填**：缺省時 W2 編排層 fallback fare-v2 公式（與 transfer / airport-* 等同）。

### `orders/{orderId}` 加 `charter` block（charter 訂單才有）

```jsonc
{
  // ... 既有 fields ...
  "orderType": "charter",

  "charter": {
    "planKey": "8h",                       // 第一天 plan，summary 用
    "days": 1,                             // ≥ 1
    "plans": [                             // length = days，多日可逐日不同
      { "key": "8h", "durationHours": 8, "basePrice": 7800, "includedKm": 160, "extraKmRate": 18, "overtimeRatePer30min": 400, "enabled": true }
    ],
    "estimatedEndTime": "2026-06-01T10:00:00+08:00",  // ISO，下訂時填（pickupTime + Σ plan.durationHours）
    "actualEndTime": null,                            // ISO，driver app 結束時填（W5）
    "overtimeMinutes": null,
    "overtimeBlocks": null,
    "overtimeCharge": null,
    "isRoundTrip": false,
    "isMountain": false,
    "mountainMul": 1,
    "nights": 0,
    "distanceKm": 92.5,
    "stopovers": [
      { "name": "九份老街", "lat": 25.108, "lng": 121.844, "order": 1 }
    ]
  }
}
```

> snapshot 寫入時機（W2）：`server/routes/nuxt-api/orders/index.post.ts` 在 charter 訂單建立時，用 `calculateCharterFareV2` 算完即寫入 `orders/{orderId}.charter` 整份 snapshot（含 plans 完整資料，避免 admin 後續調 fleet_vehicles 影響歷史單）。

## 失敗降級

charter 訂單建立時：

```
1. 車型有 charterPlans + plan 設定齊全 → 走 calculateCharterFareV2
2. 缺 charterPlans / planKey 無效 → fallback calculateFareV2（與 transfer 等同）+ 寫 line_api_errors 警告
3. fare-v2 也失敗 → 最終 fallback 25km × perKmRate（與既有 booking 一致）
```

W2 在 `server/routes/nuxt-api/orders/index.post.ts` 編排層實作此降級樹。

## Vitest 設計（W1 14 個 `it.todo`）

W1 寫 stub + 14 個 todo case，W2 填實作 + 對應 expect。todo 列表（design only）：

1. `4hr plan 基本計費：無超公里 / 無山區 / 無 OT`
2. `8hr plan 超公里加收：80 km includedKm，實跑 120 km 收 40 km 超公里`
3. `10hr plan + 來回加乘 NT$1500`
4. `多日包 2 天（8hr + 8hr）+ 1 晚過夜費 NT$2000`
5. `多日包 3 天（10hr + 10hr + 4hr）+ 2 晚過夜費`
6. `山區 2 分 → 1.4x（重用 fare-v2 三訊號偵測）`
7. `山區 3 分 → 1.6x`
8. `apiSourcesOk.routes=false → freeFlow 訊號歸 0 → 山區降級`
9. `OT 超寬限 15 min 第 1 min → 收 1 段（30 min）`
10. `OT 超 46 min → 收 2 段`
11. `rules.charter.enabled=false → throw 或回 0`（W1 確認：throw `'charter fare engine not implemented yet — W2'`；W2 改為 enabled=false → fallback fare-v2 由編排層處理）
12. `進位 rounding=100：5237 → 5300`
13. `extras 不被山區係數放大，加在最後`
14. `surcharge / promo windows 套 orderType=charter 過濾`

## W1 對齊既有 fare-v2 的設計決策

| 決策 | fare-v2 | charter-v1 | 理由 |
|---|---|---|---|
| 山區三訊號偵測 | RouteMetrics.apiSourcesOk + thresholds | 完全沿用 | 訊號來源相同（pol→ele/sin/freeFlow），無重做價值 |
| 山區階梯 multiplier | 1.3 / 1.5 | 1.4 / 1.6 | charter 客單高 + 山區更耗時間，係數略升 |
| 進位 rounding | 50 | 100 | charter 客單 4-15k 區間，100 元進位視覺更乾淨 |
| 時段加價 / 折扣 | 套 orderType 過濾 | 套 orderType='charter' | 共用 fare-v2 既有 windows，admin 不需多維護 |
| 起跳費 floor | max(baseFare, distanceFee) | N/A | charter 已用 plan basePrice 取代起跳概念 |
| 距離分段折扣 distanceTier | 套用 | **不套** | charter 已有 includedKm 內含里程 + extraKm 線性加收，雙折扣會壓利潤 |
| 跨縣市 crossCountyFee | 套用 | **不套** | charter 客單已含整日服務，跨縣市為旅遊常態，不額外加 |
| 國道 freewayToll | 套用 | **不套** | 同上，包車已含車輛時段租用全成本 |

## W1-W5 視窗對應

| 視窗 | 範圍 | 主要產出 |
|---|---|---|
| **W1**（本 change）| 型別 + schema + 文件 + stub | proposal/design/tasks/spec.md + pricing.ts types + 14 個 it.todo |
| **W2** | 計費引擎實作 + 來回判定 + Routes 整合 | `calculateCharterFareV2` 完整實作 + 14 個 it 完成 + route-metrics 多段擴充 |
| **W3** | Admin UI（settings + 試算機）+ 車型 plans | `/admin/settings` charter 區塊 + `SettingsFleetVehicles` charterPlans CRUD + 試算機 |
| **W4** | Booking UI | orderType=charter 觸發 days selector + 每日 plan picker + stopover 編輯 + 明細卡 |
| **W5** | Driver app + admin 對帳 | actualEndTime 寫回 + OT block 計算回寫 + admin 後台 OT 對帳視圖 |

## 邊角案例對照表（W2 跑測試時參照）

| 情境 | 期望 |
|---|---|
| `days=1`，`actualEndTime=null` | `nights=0` / `overtimeBlocks=0` / `overtimeCharge=0` |
| `days=2`，第一天 8h + 第二天 4h | `planBasePriceSum = plan8h.basePrice + plan4h.basePrice`；`nights=1`；includedKm/extraKmRate 用 plan8h |
| 提早結束（actual < estimated）| `overtimeMinutes=0` / `overtimeBlocks=0` |
| 寬限 14 min（actual − estimated = 14）| `overtimeMinutes=0` / `overtimeBlocks=0`（≤ grace）|
| 寬限 15 min（actual − estimated = 15）| `overtimeMinutes=0` / `overtimeBlocks=0`（grace 邊界閉區間）|
| 寬限 16 min（actual − estimated = 16）| `overtimeMinutes=1` / `overtimeBlocks=1` |
| 寬限 45 min（actual − estimated = 45）| `overtimeMinutes=30` / `overtimeBlocks=1` |
| 寬限 46 min（actual − estimated = 46）| `overtimeMinutes=31` / `overtimeBlocks=2` |
| `mountain.tiers` 空陣列 | `mountainMul=1`（即使 score≥1，無 tier 命中）|
| `extras=[]` | `extrasTotal=0` |
| `promo` / `surcharge` 對 charter `orderType` 命中 | 平面加減，不被山區係數連乘 |
| `applyPromoWindows=false` | `promoDiscount=0` |
| `applySurchargeWindows=false` | `surcharge=0` |
| `vehicle.charterPlans` 缺 planKey | W1 throw（stub 行為）；W2 編排層 fallback fare-v2 |

## 對 Brain AI 的 W1 收尾確認

1. **CharterRule 預設值**（design.md 9 個欄位）— 採用 design 預設？已照 Brain AI W1 prompt 鎖定，OK。
2. **山區 multiplier 1.4 / 1.6**（與 fare-v2 1.3 / 1.5 分離）— 照 Brain AI prompt 預設，OK。
3. **fleet_vehicles.charterPlans schema** — Map（CharterPlanKey → CharterPlan）vs Array — 採 Record（map）便於 W3 admin UI 三檔對齊；W4 booking 客端也好取 `vehicle.charterPlans?.[planKey]`。
4. **stub throw 訊息** — `'charter fare engine not implemented yet — W2'`，W2 移除。

W1 結束 → W2 接手實作。
