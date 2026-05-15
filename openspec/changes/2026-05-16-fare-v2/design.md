# Fare V2 — Design

## 公式骨架（hardcode in `shared/pricing.ts`）

```ts
function calculateFareV2(
  vehicle: { baseFare: number; perKmRate: number },
  metrics: RouteMetrics,
  pickupTime: Date,
  extras: ReadonlyArray<{ price: number }>,
  rules: FareRules
): FareBreakdownV2 {

  // -- 1. 基本里程費 + 塞車費 --
  const distanceFee = metrics.distanceKm * vehicle.perKmRate;
  const jamFee = computeJamFee(metrics.pureJamMinutes, pickupTime, rules.trafficJam);

  // -- 2. 山區係數 --
  const mountainMul = computeMountainMul(metrics, rules.mountain);

  // -- 3. 固定加費 --
  const crossCountyFee = computeCrossCountyFee(metrics.countiesVisited, rules.crossCounty);
  const freewayToll = computeFreewayToll(metrics.freewayKm, rules.freeway);

  // -- 4. 加值服務 --
  const extrasSum = extras.reduce((s, e) => s + e.price, 0);

  // -- 5. 公式骨架 --
  const variableSubtotal = distanceFee + jamFee;
  const variableScaled = variableSubtotal * mountainMul;
  const raw = vehicle.baseFare + variableScaled + crossCountyFee + freewayToll + extrasSum;

  // -- 6. 最後進位 --
  const final = Math.ceil(raw / rules.rounding) * rules.rounding;

  return {
    baseFare: vehicle.baseFare,
    distanceFee, jamFee, variableSubtotal,
    mountainMul, variableScaled,
    crossCountyFee, freewayToll,
    extrasSum,
    raw, final,
    rulesVersion: rules.version,
  };
}
```

## RouteMetrics 型別

```ts
interface RouteMetrics {
  // 從 Routes API v2
  distanceKm: number;          // r.distanceMeters / 1000
  staticDurationSec: number;   // parseFloat(r.staticDuration)
  durationSec: number;         // parseFloat(r.duration)
  pureJamMinutes: number;      // max(0, (duration − staticDuration) / 60)
  freeFlowKmh: number;         // distanceKm / (staticDurationSec / 3600)
  polylineEncoded: string;

  // 從 Elevation API
  elevationDiffM: number;      // max(samples) − min(samples)
  elevationSamples: number[];  // optional, debug only

  // 從 OSM 索引（自建）
  freewayKm: number;           // 國道總里程
  hasTrunk: boolean;           // 是否走快速道路（台 64/74 等）

  // 從縣市 GeoJSON point-in-polygon
  countiesVisited: string[];   // ['TPE','NTPE','TYN','HSZ']（依出現順序）

  // 直線距離
  straightLineKm: number;      // haversine(origin, destination)
  sinuosity: number;           // distanceKm / straightLineKm

  // meta
  computedAt: number;
  apiSourcesOk: { routes: boolean; elevation: boolean; osm: boolean; counties: boolean };
}
```

## 演算法明細

### `computeMountainMul`

```ts
function computeMountainMul(m: RouteMetrics, rule: MountainRule): number {
  if (!rule.enabled) return 1.0;
  // 任一訊號取不到 → 該訊號 0 分
  let score = 0;
  if (m.apiSourcesOk.elevation && m.elevationDiffM >= rule.thresholdElevationDiffM) score++;
  if (m.sinuosity >= rule.thresholdSinuosity) score++;
  if (m.apiSourcesOk.routes && m.freeFlowKmh <= rule.thresholdFreeFlowKmh) score++;
  // 階梯：取最高符合 minScore 的 multiplier；都不符合回 1.0
  const sortedTiers = [...rule.tiers].sort((a, b) => b.minScore - a.minScore);
  for (const tier of sortedTiers) {
    if (score >= tier.minScore) return tier.multiplier;
  }
  return 1.0;
}
```

### `computeJamFee`

```ts
function computeJamFee(pureJamMin: number, pickupTime: Date, rule: TrafficJamRule): number {
  if (!rule.enabled || pureJamMin <= 0) return 0;
  const window = findActiveWindow(pickupTime, rule);
  if (!window) return 0;
  const rate = window.ntdPerMinute ?? rule.defaultNtdPerMinute;
  return pureJamMin * rate;
}

function findActiveWindow(t: Date, rule: TrafficJamRule): PeakWindow | null {
  // 台北時區
  const tpe = toTaipeiTime(t);
  const day = WEEKDAY_KEYS[tpe.getDay()]; // 'SUN','MON',...
  const hhmm = formatHHMM(tpe);

  // 週末特殊規則
  const isWeekend = day === 'SAT' || day === 'SUN';
  if (isWeekend) {
    if (rule.weekendMode === 'OFF') return null;
    if (rule.weekendMode === 'ALL_DAY') return { defaultMatch: true };
    if (rule.weekendMode === 'EVENING_ONLY' && (hhmm < '17:00' || hhmm > '21:00')) return null;
    if (rule.weekendMode === 'EVENING_ONLY') return { defaultMatch: true };
  }

  // 平日 peakWindows
  return rule.peakWindows.find(w =>
    w.days.includes(day) && hhmm >= w.start && hhmm <= w.end
  ) ?? null;
}
```

### `computeCrossCountyFee`

```ts
function computeCrossCountyFee(visited: string[], rule: CrossCountyRule): number {
  if (!rule.enabled || visited.length <= 1) return 0;
  // 北北桃排除：若所有訪問縣市都在 {TPE, NTPE, TYN} 集合內 → 不收
  if (rule.excludeTpeNtpeTyn) {
    const tpeSet = new Set(['TPE', 'NTPE', 'TYN']);
    if (visited.every(c => tpeSet.has(c))) return 0;
  }
  // crossingCount = 訪問縣市數 − 1（起始縣市不算跨）
  const crossings = visited.length - 1;
  // 階梯：第 1 跨用 tieredNtd[0]，第 2 跨用 tieredNtd[1]，第 3 跨以上用 tieredNtd[2]
  let total = 0;
  for (let i = 0; i < crossings; i++) {
    const tier = Math.min(i, rule.tieredNtd.length - 1);
    total += rule.tieredNtd[tier];
  }
  return total;
}
```

### `computeFreewayToll`

```ts
function computeFreewayToll(freewayKm: number, rule: FreewayRule): number {
  if (!rule.enabled || freewayKm <= 0) return 0;
  const chargeable = Math.max(0, freewayKm - rule.freeKm);
  if (chargeable === 0) return 0;
  // 日上限折扣：超過 dailyCapKm 後折扣
  // 預設 dailyCapKm = 200，單次接送通常不會超過。簡化處理：
  let toll: number;
  if (chargeable <= rule.dailyCapKm) {
    toll = chargeable * rule.ntdPerKm;
  } else {
    const fullRate = rule.dailyCapKm * rule.ntdPerKm;
    const discountedRate = (chargeable - rule.dailyCapKm) * rule.ntdPerKm * (1 - rule.dailyCapDiscountPct / 100);
    toll = fullRate + discountedRate;
  }
  return Math.round(toll); // 通行費四捨五入到整數元（最後進位再到 50）
}
```

## Firestore Schema：`fare_rules/v1`

```jsonc
{
  "version": 1,
  "currency": "TWD",
  "rounding": 50,

  "mountain": {
    "enabled": true,
    "thresholdElevationDiffM": 400,
    "thresholdSinuosity": 1.3,
    "thresholdFreeFlowKmh": 40,
    "tiers": [
      { "minScore": 2, "multiplier": 1.30 },
      { "minScore": 3, "multiplier": 1.50 }
    ]
  },

  "crossCounty": {
    "enabled": true,
    "tieredNtd": [200, 350, 500],
    "excludeTpeNtpeTyn": true
  },

  "trafficJam": {
    "enabled": true,
    "peakWindows": [
      { "days": ["MON","TUE","WED","THU","FRI"], "start": "07:00", "end": "09:30" },
      { "days": ["MON","TUE","WED","THU","FRI"], "start": "17:00", "end": "19:30" }
    ],
    "weekendMode": "OFF",
    "defaultNtdPerMinute": 15
  },

  "freeway": {
    "enabled": true,
    "freeKm": 20,
    "ntdPerKm": 1.20,
    "dailyCapKm": 200,
    "dailyCapDiscountPct": 25
  },

  "updatedBy": "<uid>",
  "updatedAt": <Timestamp>
}
```

## OSM 預處理 Pipeline

### Source
- `https://download.geofabrik.de/asia/taiwan-latest.osm.pbf`（~200MB）

### 工具
- 嘗試純 JS 方案 `osm-pbf-parser` 或 `osmium-tool`（後者需 native 工具）
- 推薦：在 GitHub Actions 跑（不污染本地環境），output JSON 進 repo 或 Firebase Storage

### 過濾規則
保留 `highway in {motorway, trunk, primary, secondary, tertiary}` 的 ways。
排除 `area=yes` 和 `access=private`。

### 輸出格式

```ts
// shared/geo/osm-roads-index.json
{
  "version": "2026-05-16",
  "bbox": [minLng, minLat, maxLng, maxLat],
  "roads": [
    {
      "id": 12345,
      "highway": "motorway",
      "ref": "國道1號",
      "name": "中山高速公路",
      "geometry": [[lng, lat], [lng, lat], ...]   // simplified to ~5m tolerance
    },
    ...
  ]
}
```

### Server 啟動載入
- `server/utils/osm-roads-index.ts`：app boot 時讀 JSON，建 R-tree（用 `rbush` npm package）
- in-memory 駐留，避免每次估價重讀
- 估算大小：過濾完 ~30MB JSON → R-tree 索引 ~50MB heap

### Query：判定 polyline 上哪些段在國道

```ts
function classifyRoute(polyline: string): { freewayKm: number; hasTrunk: boolean } {
  const points = decodePolyline(polyline);
  let freewayKm = 0, hasTrunk = false;
  let lastClass: 'motorway' | 'trunk' | 'other' = 'other';

  for (let i = 0; i < points.length - 1; i++) {
    const cls = nearestRoadClass(points[i], 20); // 20m 容差
    if (cls === 'motorway') {
      freewayKm += haversineKm(points[i], points[i+1]);
    }
    if (cls === 'trunk') hasTrunk = true;
  }
  return { freewayKm, hasTrunk };
}
```

## 縣市 GeoJSON

### Source
- 政府開放資料：行政院內政部 [鄉鎮市區界線(TWD97經緯度)](https://data.gov.tw/dataset/7441)
- 或：[Github - g0v/twgeojson](https://github.com/g0v/twgeojson) Taiwan 縣市 GeoJSON
- 簡化到鄉鎮級不需要，22 縣市級即可

### 輸出
- `shared/geo/taiwan-counties.geojson`（< 1MB）
- Feature property 含 `code`：`TPE / NTPE / TYN / HSZ / HSC / ...`（自定 ISO 風格代碼）

### Query
```ts
function detectCounties(polyline: string): string[] {
  const points = decodePolyline(polyline);
  const sampled = sampleEvery(points, 0.5); // 每 500m 取一點
  const visited = new Set<string>();
  for (const p of sampled) {
    const code = pointInWhichCounty(p, countiesGeoJSON);
    if (code) visited.add(code);
  }
  return Array.from(visited);
}
```

## 國道 GeoJSON（如果 OSM 過濾覆蓋 motorway 已足夠，這個檔可省）

如果想跟 OSM 索引解耦（國道資料源更權威），可額外用：
- 交通部高速公路局 [國道路網 GeoJSON](https://freeway.gov.tw)
- 或從 OSM 過濾 `highway=motorway AND ref LIKE '國道%'`

優先：先用 OSM motorway，後續需要再單獨建 freeway GeoJSON。

## /api/maps/route 升級

### 從 Directions v1 → Routes v2

```ts
// 改 endpoint
- 'https://maps.googleapis.com/maps/api/directions/json'
+ 'https://routes.googleapis.com/directions/v2:computeRoutes'

// 改 method
- GET with query string
+ POST with JSON body + X-Goog-FieldMask header

// FieldMask 只要必要欄位（控制成本 + 回應大小）
'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.navigationInstruction.maneuver'
```

### 回傳結構升級

```ts
// 舊
{ data: { polyline, bounds, distance_km, duration_minutes }, status }

// 新（保留向後相容，加新欄位）
{
  data: {
    polyline, bounds, distance_km, duration_minutes,
    static_duration_minutes,  // 🆕
    pure_jam_minutes,         // 🆕
    routeMetrics: {           // 🆕 完整 RouteMetrics
      elevationDiffM, sinuosity, freeFlowKmh,
      freewayKm, countiesVisited, ...
    },
    fareBreakdown: {          // 🆕 直接計算好給前端
      baseFare, distanceFee, jamFee, mountainMul,
      crossCountyFee, freewayToll, extrasSum,
      raw, final, rulesVersion,
    }
  },
  status
}
```

### 緩存（in-memory LRU）

- Key: `route:v2:${origin}|${dest}|${waypoints}|${vehicleType}|${minute_bucket_15}|${rulesVersion}`
- Value: 完整 route response
- TTL: 5 min
- 用 `lru-cache` npm package

## Admin Settings UI

`/admin/settings` 新增「車資進階規則」section（layout 在現有 settings 頁尾）。

### 結構
```
[車資進階規則 v1]                                          [💾 儲存]
├─ [基本]
│   └─ 進位至 [____50____] 元
│
├─ [山區加成]                                              啟用 ☑
│   ├─ 海拔起伏門檻 (m)        [____400____]
│   ├─ 曲折度門檻              [____1.3____]
│   ├─ 無塞車時速門檻 (km/h)   [____40_____]
│   ├─ 加成階梯：
│   │   • 達 [_2_] 分 → 係數 [_1.30_]
│   │   • 達 [_3_] 分 → 係數 [_1.50_]
│   │   [+ 新增階梯]  [刪除]
│   └─ 預覽：起伏≥400m + 曲折≥1.3 + 時速≤40km/h → 任二中 ×1.30、三項中 ×1.50
│
├─ [跨縣市補貼]                                            啟用 ☑
│   ├─ 第 1 跨    [_200_] 元
│   ├─ 第 2 跨    [_350_] 元
│   ├─ 第 3+ 跨   [_500_] 元
│   └─ 北北桃跨界不收  ☑
│
├─ [顛峰塞車費]                                            啟用 ☑
│   ├─ 顛峰時段：
│   │   • [週一~週五]  [_07:00_] ~ [_09:30_]  [_15_]元/min  [刪除]
│   │   • [週一~週五]  [_17:00_] ~ [_19:30_]  [_15_]元/min  [刪除]
│   │   [+ 新增時段]
│   ├─ 週末模式：( ◉ OFF / ○ 全天 / ○ 僅 17-21 )
│   └─ default 費率 (NTD/min)  [____15____]
│
└─ [國道通行費]                                            啟用 ☑
    ├─ 首段免費里程 (km)       [_____20____]
    ├─ 每公里費率 (NTD/km)     [____1.20___]
    ├─ 日上限里程 (km)         [____200____]
    └─ 上限後折扣 (%)          [_____25____]

╔══════════════════════════════════════════════════════════╗
║  [試算機]                                                ║
║                                                          ║
║  路線距離       [____15____] km                          ║
║  staticDuration [____30____] min                         ║
║  海拔起伏       [___500____] m                           ║
║  曲折度         [___1.4____]                             ║
║  跨縣市數       [____1_____]                             ║
║  國道里程       [____10____] km                          ║
║  pickupTime     [2026-05-17 08:30]                       ║
║  vehicle        [▾ 轎車    ] extras [▾ 嬰兒座椅]         ║
║                                                          ║
║  → 計算結果：                                            ║
║    起跳費         NT$ 300                                ║
║    里程費         NT$ 375                                ║
║    顛峰塞車       NT$ 180   (12 min × 15)                ║
║    小計           NT$ 555                                ║
║    山區係數       ×1.30                                  ║
║    山區小計       NT$ 722                                ║
║    跨縣市         +NT$ 200                               ║
║    國道           +NT$ 0 (10 ≤ 20 免費)                  ║
║    extras         +NT$ 200                               ║
║    raw            NT$ 1,222                              ║
║    最終 (進位 50) NT$ 1,250                              ║
╚══════════════════════════════════════════════════════════╝
```

### 權限
- 只 `super` level admin 可看 / 編輯（普通 admin 看不到此區塊）
- 編輯後寫入 `audit_logs`：`who, what changed, when, before/after diff`

## Booking 頁面明細 UI

### Step 3（BookingStepOptions）
- 預估車資區塊從「單一大數字」改為**可展開明細卡**
- 預設收合，標題顯示「預估車資 NT$ 1,200 [▾ 看明細]」
- 展開顯示完整 9 行明細

### Step 4（BookingStepConfirm）
- 明細**預設展開**，作為確認依據

### 變動隱藏邏輯
- 山區係數 = 1.0 → 隱藏該行
- jamFee = 0 → 隱藏該行
- crossCounty = 0 → 隱藏該行
- freewayToll = 0 → 隱藏該行
- extrasSum = 0 → 隱藏該行

## i18n 鍵（新增）

```js
// i18n/locales/zh.js, en.js, ja.js — booking 區塊下
fareBreakdown: {
  title: '車資明細 / Fare Breakdown',
  baseFare: '起跳費',
  distanceFee: '里程費',
  jamFee: '顛峰塞車',
  subtotal: '小計',
  mountainMul: '山區加成 ×{mul}',
  crossCounty: '跨縣市 ({n} 個)',
  freewayToll: '國道 {km} km',
  extras: '加值服務',
  rawBeforeRounding: '進位前',
  rounded: '總計（進位 {round} 元）',
}
```

## 失敗降級流程

```ts
async function getRouteWithFare(...): Promise<FareResult> {
  try {
    const metrics = await getRouteMetricsV2(...);
    if (!metrics.apiSourcesOk.routes) throw new Error('Routes API failed');
    const fareRules = await getFareRules();
    const breakdown = calculateFareV2(vehicle, metrics, pickupTime, extras, fareRules);
    return { version: 'v2', breakdown };
  } catch (err) {
    // 寫 line_api_errors 警告 admin
    logFareV2FailureToFirestore(err);
    // fallback v1
    const distanceKm = await getSimpleDistance(...);
    const fare = calculateFare(vehicle, distanceKm, extras);
    return { version: 'v1', breakdown: { final: fare, fallback: true } };
  }
}
```

UI 處理：v1 fallback 時，明細卡顯示「（簡化計費中）」標籤，告知 user 當前不是完整計算。

## 對 Brain AI 的最終決策請求

1. **資料 host 方式**（OSM 索引 + 縣市 GeoJSON）：
   - [A] 進 git repo `shared/geo/`（簡單但 repo 變大 30MB）
   - [B] Firebase Storage 啟動載入（repo 乾淨，cold start +2s）
   - [C] 預處理後壓到 5MB 以下進 repo（最佳，但需精簡）
   - 推薦：**C**

2. **OSM 索引更新頻率**：
   - [A] 一次性產出，永不更新（國道線形變化極少）
   - [B] 每月 GitHub Actions cron 重產
   - 推薦：**A**，國道有新建/廢線再手動 rebuild

3. **預設參數值**：上面 17 個建議值 OK 嗎？哪個要改？

4. **OSM 過濾範圍**：除 `motorway/trunk` 外，是否也保留 `primary/secondary` 用於未來細分？
   - [A] 只留 `motorway` + `trunk`（檔案最小，~5MB）
   - [B] 加 `primary/secondary`（~15MB，未來能分省道 / 縣道）
   - 推薦：**A 起步**，第二期再擴

下個 session 開工前，這 4 個問題拍板就 ready。
