# Fare V2 — Tasks

## 開工前 prerequisite（必須先完成）

- [ ] **Brain AI 拍板：design.md 結尾 4 個決策**
  - 資料 host 方式（A/B/C）
  - OSM 索引更新頻率
  - 17 個預設參數值是否採用
  - OSM 過濾範圍（A/B）
- [ ] 確認 Vercel 環境 `NUXT_GOOGLE_MAPS_API_KEY` 已啟用：Routes API、Maps Elevation API
- [ ] **不**需要：Roads API（公式不用速限）

## Phase 1：資料準備（1-2 hr）

### 1.1 縣市 GeoJSON
- [ ] 1.1.1 從 g0v/twgeojson 抓 Taiwan 22 縣市邊界
- [ ] 1.1.2 用 mapshaper 簡化（保留 ~3000 個座標點 → 檔案 < 1MB）
- [ ] 1.1.3 加自定 `code` property（TPE / NTPE / TYN / ...）
- [ ] 1.1.4 寫入 `shared/geo/taiwan-counties.geojson`
- [ ] 1.1.5 寫 `shared/geo/county-codes.ts` enum + 中英日名稱對照

### 1.2 OSM 道路索引
- [ ] 1.2.1 寫 `scripts/build-osm-roads-index.mjs`
- [ ] 1.2.2 從 Geofabrik 抓 `taiwan-latest.osm.pbf`
- [ ] 1.2.3 用 `osm-pbf-parser` 純 JS 解析（避免裝 osmium native tool）
- [ ] 1.2.4 過濾 `highway in {motorway, trunk}`（依拍板決定）
- [ ] 1.2.5 簡化線形到 ~5m tolerance
- [ ] 1.2.6 輸出 `shared/geo/osm-roads-index.json`（壓縮版本 < 5MB 為目標）
- [ ] 1.2.7 跑一次驗證：輸出檔大小、include 國道 1/3/5、include 台 64/74 等快速道路

### 1.3 R-tree 索引載入器
- [ ] 1.3.1 `pnpm add rbush`
- [ ] 1.3.2 寫 `server/utils/osm-roads-index.ts`
  - boot 時讀 JSON → 建 R-tree
  - export `nearestRoadClass(point, toleranceM)` 函式
- [ ] 1.3.3 寫單元測試（給定 polyline 點 → 預期回 motorway / trunk / other）

### 1.4 縣市判定 helper
- [ ] 1.4.1 寫 `server/utils/county-detect.ts`
  - load 縣市 GeoJSON 一次
  - export `detectCounties(polyline) → string[]`
  - 用 `@turf/boolean-point-in-polygon` 或自寫 ray-casting

## Phase 2：Server 層（2-3 hr）

### 2.1 升級 Routes API
- [ ] 2.1.1 改 `server/api/maps/route.get.ts` POST 到 Routes API v2
- [ ] 2.1.2 FieldMask 精簡到必要欄位（節省成本）
- [ ] 2.1.3 加 in-memory LRU cache（`lru-cache` package）
- [ ] 2.1.4 向後相容：舊欄位 `polyline / distance_km / duration_minutes` 仍存在
- [ ] 2.1.5 新增 `static_duration_minutes` / `pure_jam_minutes`

### 2.2 RouteMetrics 計算
- [ ] 2.2.1 寫 `server/utils/route-metrics.ts`
- [ ] 2.2.2 整合 4 個 sub-計算：
  - Elevation API 1km 取樣
  - 曲折度 (`haversine(o, d)`)
  - 道路層級 (OSM)
  - 縣市穿越 (GeoJSON)
- [ ] 2.2.3 每個 sub-計算用 `Promise.allSettled` 平行跑
- [ ] 2.2.4 失敗回報到 `apiSourcesOk` flags
- [ ] 2.2.5 timeout 3s per sub-計算

### 2.3 Fare Calculator V2
- [ ] 2.3.1 寫 `server/utils/fare-calculator-v2.ts`
- [ ] 2.3.2 實作 4 個 sub-computers：
  - `computeMountainMul`
  - `computeJamFee`
  - `computeCrossCountyFee`
  - `computeFreewayToll`
- [ ] 2.3.3 主入口 `calculateFareV2(...)` 組合 6 項 → `FareBreakdownV2`
- [ ] 2.3.4 寫單元測試 `shared/pricing.spec.ts`：
  - 純市區短程：無山區、無國道、無跨縣市 → v1 等價
  - 跨縣市國道：v1 + 跨縣市 + 國道費
  - 山區路線：mountainMul 觸發
  - 顛峰時段：jamFee 觸發
  - 失敗降級：apiSourcesOk 任一 false → 對應訊號歸 0

### 2.4 Firestore `fare_rules`
- [ ] 2.4.1 建 `fare_rules/v1` doc（預設值見 design.md schema）
- [ ] 2.4.2 firestore.rules：admin only read/write
- [ ] 2.4.3 寫 `server/utils/fare-rules-cache.ts`
  - boot 載入 + 5min refresh
  - admin 改完手動 invalidate

### 2.5 Admin API
- [ ] 2.5.1 `server/routes/nuxt-api/admin/fare-rules/index.get.ts`
- [ ] 2.5.2 `server/routes/nuxt-api/admin/fare-rules/index.patch.ts`
  - require super admin
  - validate schema with Zod
  - 寫 audit_logs
  - invalidate cache
- [ ] 2.5.3 加到 `app/protocol/fetch-api/api/admin/` 索引

### 2.6 升級 /api/maps/route 回傳
- [ ] 2.6.1 query 加 `vehicleType` + `pickupTime` + `extras` params
- [ ] 2.6.2 回傳含 `routeMetrics` + `fareBreakdown`
- [ ] 2.6.3 失敗降級：v1 fallback + `version: 'v1' | 'v2'` flag

## Phase 3：Client 層（1-2 hr）

### 3.1 BookingStepOptions 明細卡
- [ ] 3.1.1 改 `app/components/passenger/BookingStepOptions.vue`
  - 預估車資區塊重做：頂部標題 + [▾ 看明細] 切換
  - 接 server 回傳的 `fareBreakdown` 物件
  - 變動隱藏（mountainMul=1 / jamFee=0 / ... 那行隱藏）
- [ ] 3.1.2 寫 i18n 鍵 `booking.fareBreakdown.*` 三語
- [ ] 3.1.3 v1 fallback 時顯示「（簡化計費）」標籤

### 3.2 BookingStepConfirm 明細
- [ ] 3.2.1 改 `app/components/passenger/BookingStepConfirm.vue`
  - 明細**預設展開**
  - 同 step3 的隱藏邏輯
  - server `fareBreakdown` 為 source of truth

### 3.3 Admin Settings — 車資進階規則
- [ ] 3.3.1 改 `app/pages/admin/settings/index.vue`
  - 新增 section（super only）
  - 4 大區塊：基本 / 山區 / 跨縣市 / 顛峰 / 國道
  - 每區塊 enabled toggle + 各欄位 input
- [ ] 3.3.2 寫 「試算機」子組件 `AdminFareCalculatorPreview.vue`
  - 7 個 input + 顯示完整 breakdown
- [ ] 3.3.3 儲存：show toast、刷新 StoreConfig

## Phase 4：驗證 + 部署（30 min）

### 4.1 手動驗算 3 條代表路線
- [ ] 4.1.1 短程市區：松山機場 → 台北 101
  - 預期：無山區、無跨縣市、可能少量國道、無顛峰塞車（依測試時間）
- [ ] 4.1.2 跨縣市國道：桃園機場 → 信義 101
  - 預期：跨縣市 +200、國道 ~10km、顛峰時段加 jamFee
- [ ] 4.1.3 山區路線：台北 → 福壽山農場
  - 預期：mountainMul ≥ 1.30、跨 2 縣市
- [ ] 4.1.4 對照試算機結果 vs 實際 booking 預估，確認一致

### 4.2 失敗降級驗證
- [ ] 4.2.1 暫時把 Elevation API key 弄壞 → 確認 fallback v1 順利
- [ ] 4.2.2 OSM 索引未載入時 → freewayToll = 0、不 crash

### 4.3 Firestore rules 部署
- [ ] 4.3.1 `firebase deploy --only firestore:rules`
- [ ] 4.3.2 驗證 admin only 規則生效

### 4.4 Push main 觸發 Vercel deploy
- [ ] 4.4.1 commit 全部改動
- [ ] 4.4.2 `git push origin <branch>:main`（fast-forward）
- [ ] 4.4.3 Vercel build 跑完
- [ ] 4.4.4 真機 / web 估價 3 條路線各 1 次，肉眼驗證明細顯示正確

## 待 archive 條件

全勾 + Brain AI 在 prod 估價 5 條不同特徵路線都報告合理 → 跑 `openspec archive 2026-05-16-fare-v2`。
