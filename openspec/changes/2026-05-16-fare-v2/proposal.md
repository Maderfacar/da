# Fare V2：偏遠山區係數 + 跨縣市補貼 + 顛峰塞車 + 國道通行費

## Why

現行車資公式（v1）：
```
車資 = ⌈(baseFare + dist × perKm + Σextras) / 50⌉ × 50
```

只反映距離，**忽略地形、跨縣市、即時塞車、國道費用**。實際業務上：
- 走北橫接機 vs 走國道接機，成本差異 50%+，但兩者距離相近 → v1 算出來相同車資
- 顛峰塞車 1 小時純等待時間，司機機會成本沒入帳
- 跨縣市車輛回程空車補貼沒進公式
- 國道實際通行費由公司吸收（一個訂單可能 50-200 元）

## What Changes

### 新公式（v2，本變更鎖定）

```
raw   = baseFare
      + (distanceKm × perKmRate + jamFee) × mountainMultiplier
      + crossCountyFee
      + freewayToll
      + Σ extras

final = ⌈ raw / rounding ⌉ × rounding
```

**關鍵骨架（hardcode 不可改）：**
- 起跳費（baseFare）**不被**山區係數乘
- 加值服務（extras）**不被**山區係數乘
- 跨縣市、國道**加在最後**，不參與係數放大
- 進位**只執行一次**（最後一步）

### 新增 5 個訊號

| 訊號 | 取得方式 |
|---|---|
| 海拔起伏 | Google Elevation API（沿 polyline 1km 取樣，最多 72 點 / 1 request）|
| 曲折度 | `routeDistanceKm ÷ haversine(origin, dest)` |
| 平均無塞車時速 | `distanceMeters ÷ staticDuration × 3.6` |
| 純塞車延誤 | Routes API: `max(0, duration − staticDuration)` |
| 道路層級 / 國道里程 | **自建 OSM 預處理索引**（Routes API v2 無此欄位，TOLLS 也不支援台灣）|

### 新增 4 個運算模組

| 模組 | 公式項目 |
|---|---|
| `computeMountainMul` | 三訊號達標分數 → 階梯係數（預設 1.0/1.3/1.5）|
| `computeJamFee` | 顛峰時段內，純塞車分鐘 × 每分鐘費率 |
| `computeCrossCountyFee` | polyline 取樣點 point-in-polygon 縣市 GeoJSON，階梯費率 |
| `computeFreewayToll` | polyline 取樣點 buffer ±20m 比對國道 GeoJSON，按高公局費率計算 |

### 新增 Firestore collection

`fare_rules/v1` — 單一 doc 存所有可調參數。admin 在 `/admin/settings` 編輯。

### Booking 頁面 UX 變動

Step 3 預估車資 + Step 4 確認頁，從「單一總額」改為**明細卡片**：
```
起跳費                  NT$ 300
里程 12.5 km            NT$ 313
顛峰塞車 8 min          NT$ 120
─────────────────────────
小計                    NT$ 733
山區加成 ×1.30          +NT$ 220
跨縣市 (1 個)           +NT$ 200
國道 6.2 km             +NT$ 7
─────────────────────────
總計（進位 50）         NT$ 1,200
```

### 失敗降級

任何訊號取不到（API 失敗 / 超時 / OSM 索引未載入）→ 自動 fallback v1 公式 +
寫 `line_api_errors` 警告 admin。

## Impact

### Affected specs
- 新建：`fare-calculation`（v2 算法）
- 修改：`booking-flow`（step 3/4 明細顯示）
- 修改：`admin-settings`（新增 fare-rules 編輯區）

### Affected code

| 檔案 | 動作 |
|---|---|
| `shared/pricing.ts` | 擴 `calculateFareV2(...)`；舊 `calculateFare` 保留為 fallback |
| `server/utils/route-metrics.ts` | 🆕 取 5 個訊號 |
| `server/utils/fare-calculator-v2.ts` | 🆕 6 項加總公式 |
| `server/utils/osm-roads-index.ts` | 🆕 OSM 道路層級 + 國道 / 縣市 GeoJSON in-memory R-tree |
| `server/utils/freeway-toll.ts` | 🆕 高公局費率 engine |
| `server/api/maps/route.get.ts` | 升級 Directions v1 → Routes v2；同時回 routeMetrics + fareBreakdown |
| `server/routes/nuxt-api/admin/fare-rules/*` | 🆕 GET/PATCH endpoint |
| `app/components/passenger/BookingStepOptions.vue` | UI 改明細卡 |
| `app/components/passenger/BookingStepConfirm.vue` | UI 改明細卡 |
| `app/pages/admin/settings/index.vue` | 新增 fare-rules 編輯區 + 試算機 |
| `shared/geo/taiwan-counties.geojson` | 🆕 縣市邊界（< 1MB） |
| `shared/geo/taiwan-freeways.geojson` | 🆕 國道線形（< 1MB） |
| `shared/geo/osm-roads-index.json` | 🆕 預處理 OSM 道路索引（~10-30MB）|
| `scripts/build-osm-roads-index.mjs` | 🆕 一次性預處理 script，從 `taiwan-latest.osm.pbf` 過濾 |

### 不影響
- 現行 v1 公式保留為 fallback，不刪除
- `fleet_vehicles` / `fleet_extras` schema 不動
- 既有訂單記錄的 `estimatedFare` 不重算（往前相容）

## Phase 0 技術驗證結果

**已驗證（2026-05-16，本 session 完成）**

| 驗證項 | 結果 |
|---|---|
| Routes API v2 對台灣 | ✅ 正常運作，回 distanceMeters / duration / staticDuration / polyline / steps |
| Routes API v2 `roadFeatures` / `interventions` 欄位 | ❌ **不存在**，深度 scan 整份回應無道路層級 enum |
| Routes API v2 TOLLS extraComputation 對台灣 | ❌ `travelAdvisory.tollInfo: {}`（空物件）— **不支援台灣** |
| Routes API v2 `speedReadingIntervals` 道路層級用途 | ❌ 整路回單一 `NORMAL`，無辨識力 |
| Elevation API path sampling | ✅ 72 點完整回傳，resolution 平均 150m，1 個 request 搞定整路線 |
| 曲折度計算 | ✅ 路線距離 70.64 km vs 直線 54.97 km → 1.285 |
| 平均無塞車時速 | ✅ 70.64 km ÷ 64.9 min × 3600 = 65.3 km/h |
| 純塞車延誤 | ✅ `max(0, duration − staticDuration)` 可算 |

**結論：必走 OSM 自建路線（道路層級 + 國道里程 + 跨縣市）。Google 三 API 拿 4 個訊號，OSM 拿 1 個訊號 + GeoJSON 拿 2 個訊號。**

## 待 Brain AI 拍板的參數

**業務邏輯已 hardcode（不需拍板）：**
- 公式骨架（baseFare + (dist×perKm + jam)×mountainMul + cross + toll + extras → 最後進位）
- 山區判定：三訊號各 1 分、階梯取係數
- 跨縣市：階梯費率、北北桃排除可 toggle
- 顛峰塞車：依 pickupTime 是否落入 peak window 計算
- 國道費率：首段免費 + 每 km 費率 + 日上限折扣
- 進位：最後一次 ⌈ raw / rounding ⌉ × rounding

**數字必須你定（13 個）：**

| 區塊 | 參數 | 預設建議 |
|---|---|--:|
| 山區 | 海拔起伏門檻（m） | 400 |
| 山區 | 曲折度門檻 | 1.3 |
| 山區 | 無塞車時速門檻（km/h） | 40 |
| 山區 | 階梯 1（達 2 分）係數 | 1.30 |
| 山區 | 階梯 2（達 3 分）係數 | 1.50 |
| 跨縣市 | 第 1 跨費率（NTD） | 200 |
| 跨縣市 | 第 2 跨費率（NTD） | 350 |
| 跨縣市 | 第 3+ 跨費率（NTD） | 500 |
| 跨縣市 | 北北桃排除 | ☑ |
| 塞車 | 顛峰時段表 | 平日 07:00-09:30 + 17:00-19:30 |
| 塞車 | 每分鐘費率（NTD/min） | 15 |
| 塞車 | 週末模式 | OFF |
| 國道 | 首段免費里程（km） | 20 |
| 國道 | 每 km 費率（NTD/km） | 1.20 |
| 國道 | 日上限里程（km） | 200 |
| 國道 | 上限後折扣（%） | 25 |
| 進位 | rounding | 50 |

> 預設值已寫進 `design.md` 的 schema。下個 session 開工後，用上述預設啟動，admin 進後台可即時調整。
