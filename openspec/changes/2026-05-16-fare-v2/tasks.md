# Fare V2 — Tasks

## 開工前 prerequisite（必須先完成）

- [x] **Brain AI 拍板：design.md 結尾 4 個決策**（拍板表見 design.md 結尾）
  - 資料 host 方式：C（精簡 < 5MB 進 repo）
  - OSM 索引更新頻率：A（一次性）
  - 17 個預設參數值：照單全收
  - OSM 過濾範圍：A（motorway + trunk）
- [x] 確認 Vercel 環境 `NUXT_GOOGLE_MAPS_API_KEY` 已啟用：Routes API、Maps Elevation API
      （Brain AI 已於 2026-05-16 確認啟用）
- [x] **不**需要：Roads API（公式不用速限）

## Phase 1：資料準備（1-2 hr）— ✅ 完工 2026-05-16

### 1.1 縣市 GeoJSON
- [x] 1.1.1 從 g0v/twgeojson 抓 Taiwan 22 縣市邊界
- [x] 1.1.2 簡化（內建 Douglas-Peucker，免 mapshaper 依賴；208046→30409 點，622KB < 1MB）
- [x] 1.1.3 加自定 `code` property（TPE / NTPE / TYN / ...）
- [x] 1.1.4 寫入 `shared/geo/taiwan-counties.json`（副檔名改 .json 以便 server 原生靜態 import）
- [x] 1.1.5 寫 `shared/geo/county-codes.ts` enum + 中英日名稱對照
      建置腳本：`scripts/build-county-geojson.mjs`

### 1.2 OSM 道路索引
- [x] 1.2.1 寫 `scripts/build-osm-roads-index.mjs`
- [x] 1.2.2~1.2.3 改用 Overpass API `out geom`（免下載 200MB pbf、免 osmium native tool、免解析 node ref）
- [x] 1.2.4 過濾 `highway in {motorway, trunk}`
- [x] 1.2.5 簡化線形（Douglas-Peucker ~6m tolerance；39429→18371 點）
- [x] 1.2.6 輸出 `shared/geo/osm-roads-index.json`（0.88MB ≪ 5MB）
- [x] 1.2.7 驗證：5359 way（motorway 3198 / trunk 2161）；ref 含國道 1/3/5、台 61/64/74/76/78/86/88

### 1.3 R-tree 索引載入器
- [x] 1.3.1 `pnpm add rbush`（4.0.1）+ `@types/rbush`（4.0.0）
- [x] 1.3.2 寫 `server/utils/osm-roads-index.ts`
  - 首次查詢時讀 JSON → 建 R-tree（lazy singleton，常駐重用）
  - export `nearestRoadClass(point, toleranceM)` + `getOsmIndexMeta()`
- [x] 1.3.3 寫單元測試 `server/utils/osm-roads-index.spec.ts`（5 tests，motorway/trunk/other + 容差）
      附帶：建立 `vitest.config.ts` + `pnpm test` / `test:watch` / `test:e2e` script

### 1.4 縣市判定 helper
- [x] 1.4.1 寫 `server/utils/county-detect.ts`
  - load 縣市 GeoJSON 一次（lazy singleton + 各縣市 bbox 預先計算）
  - export `detectCounties(points) → CountyCode[]`、`pointInCounty(point)`、`getCountyIndexMeta()`
  - 自寫 ray-casting point-in-polygon（免 turf 依賴；支援 MultiPolygon + holes）
  - 單元測試 `server/utils/county-detect.spec.ts`（6 tests）

## Phase 2：Server 層（2-3 hr）— ✅ 完工 2026-05-16

> 整體：純計算（4 computers + calculateFareV2）置於 `shared/pricing.ts` 以便單元測試；
> `fare-calculator-v2.ts` 僅做 server I/O 編排（與 tasks 原規劃略異，理由見各項）。
> 全部 fare-v2 檔案 `vue-tsc` 型別乾淨；44 單元測試通過；lint 乾淨。

### 2.1 升級 Routes API
- [x] 2.1.1 `route.get.ts` 車資模式 POST Routes API v2（純幾何模式保留 legacy Directions，零風險）
- [x] 2.1.2 FieldMask 精簡：`routes.distanceMeters,duration,staticDuration,polyline.encodedPolyline`
- [x] 2.1.3 in-memory LRU cache（`lru-cache` 11.3.6；key 含 15min 桶 + fareRulesEpoch；5min TTL）
- [x] 2.1.4 向後相容：`polyline / bounds / distance_km / duration_minutes` 仍存在
- [x] 2.1.5 新增 `static_duration_minutes` / `pure_jam_minutes`

### 2.2 RouteMetrics 計算
- [x] 2.2.1 寫 `server/utils/route-metrics.ts`
- [x] 2.2.2 整合 4 sub-計算：Elevation 1km 取樣 / 曲折度 / OSM 道路層級 / 縣市穿越
- [x] 2.2.3 Elevation 為唯一網路 sub-計算（與 Routes 並行）；OSM/縣市為 in-memory 同步，各自 try/catch
- [x] 2.2.4 失敗回報 `apiSourcesOk` flags（Routes 整個失敗則 throw → 編排層降 v1）
- [x] 2.2.5 timeout：Routes 8s / Elevation 5s（放寬 design 的 3s，避免非必要降級；已註記）
- [x] 附帶 `polyline.ts`（decodePolyline / haversine / 取樣 / boundsFromPolyline）+ `getSimpleRoute`（v1 降級）

### 2.3 Fare Calculator V2
- [x] 2.3.1 寫 `server/utils/fare-calculator-v2.ts`（`getRouteWithFare` 編排 + v1 降級 + 失敗寫 line_api_errors）
- [x] 2.3.2 4 sub-computers 實作於 `shared/pricing.ts`（純函式，便於測試）
- [x] 2.3.3 `calculateFareV2(...)` 組合 6 項 → `FareBreakdownV2`（亦於 pricing.ts）
- [x] 2.3.4 單元測試 `shared/pricing.spec.ts`（26 tests，含全部 5 代表情境）

### 2.4 Firestore `fare_rules`
- [x] 2.4.1 不手動建 doc：`getFareRules()` doc 不存在自動 fallback `DEFAULT_FARE_RULES`；admin 首次 PATCH 才建 doc
- [x] 2.4.2 firestore.rules：`fare_rules/{rulesId}` client 全禁（read/write false），僅 server SDK 透過
- [x] 2.4.3 寫 `server/utils/fare-rules-cache.ts`（5min TTL + `validateFareRules` 手寫驗證器 + `invalidateFareRulesCache`）

### 2.5 Admin API
- [x] 2.5.1 `server/routes/nuxt-api/admin/fare-rules/index.get.ts`（super only）
- [x] 2.5.2 `server/routes/nuxt-api/admin/fare-rules/index.patch.ts`
  - super admin only（`auth.level === 'super'`）
  - 手寫 `validateFareRules`（專案無 zod，與 fleet-config/legal-pages 慣例一致）
  - 寫 audit_logs（`fare_rules.update`，含 before/after）+ invalidate cache
- [x] 2.5.3 加到 `app/protocol/fetch-api/api/admin/index.ts`（`fare-rules` sub-module）

### 2.6 升級 /api/maps/route 回傳
- [x] 2.6.1 query 加 `vehicleType` + `pickupTime` + `extras`
- [x] 2.6.2 回傳含 `routeMetrics` + `fareBreakdown` + `fareVersion` + `fareTotal`
- [x] 2.6.3 失敗降級：v1 fallback + `fareVersion: 'v1' | 'v2'` flag

> ⚠ **留待 Brain AI 確認的 scope 缺口**：tasks/proposal 未涵蓋 `server/routes/nuxt-api/orders/index.post.ts`。
> 目前訂單建立仍用 v1 公式（`calc-route-distance.ts` + `calculateFare`），
> 與 booking step 3/4 顯示的 v2 明細**不一致**。需 Brain AI 拍板是否納入。

## Phase 3：Client 層 — ✅ 完工 2026-05-16

> `pnpm build` 整包編譯通過；新增 i18n 三語對齊；ESLint 乾淨；44 單元測試通過。
> 另：訂單建立 `orders/index.post.ts` 已改用 `getRouteWithFare`（Brain AI 拍板納入），
> 與 booking 顯示一致；舊 `calc-route-distance.ts` 已成死碼並刪除。

### 3.1 BookingStepOptions 明細卡
- [x] 3.1.1 改 `app/components/passenger/BookingStepOptions.vue`
  - 改呼叫 `/api/maps/route` 車資模式取 server 計算的 `fareBreakdown`（不再 client 端 calculateFare）
  - 新增共用元件 `FareBreakdownCard.vue`（step 3 收合 + [▾] 展開）；變動隱藏邏輯內建
- [x] 3.1.2 i18n 鍵 `booking.fareBreakdown.*` 三語（zh/en/ja 對齊）
- [x] 3.1.3 v1 fallback 顯示「（簡化計費）」標籤

### 3.2 BookingStepConfirm 明細
- [x] 3.2.1 改 `app/components/passenger/BookingStepConfirm.vue`
  - 重用 `FareBreakdownCard.vue`，`default-expanded` 預設展開
  - server `fareResult` 為 source of truth（由 step 3 估出、經 booking 頁傳入）

### 3.3 Admin Settings — 車資進階規則
- [x] 3.3.1 改 `app/pages/admin/settings/index.vue`：新增「車資進階規則 v1」section（super only）
  - 基本 / 山區 / 跨縣市 / 顛峰 / 國道 五區塊，enabled toggle + 各欄位 input；階梯/時段可增刪
- [x] 3.3.2 寫試算機子組件 `app/components/admin/AdminFareCalculatorPreview.vue`
  - 7 input + 車型/extras 選擇 → 合成 RouteMetrics → `calculateFareV2` → 完整明細
- [x] 3.3.3 儲存：`ElMessage` toast；super 權限守衛

### 3.0 訂單建立改 v2（Brain AI 拍板新增）
- [x] `server/routes/nuxt-api/orders/index.post.ts` 改用 `getRouteWithFare`
  - 訂單 doc 新增 `fareVersion` + `fareBreakdown` 快照
  - 連 v1 Directions 也失敗 → 最終 fallback 25km
  - 刪除已成死碼的 `server/utils/calc-route-distance.ts`

## Phase 4：驗證 + 部署 — 部署完成 2026-05-16，prod 驗算待 Brain AI

### 4.1 手動驗算 3 條代表路線
- [ ] 4.1.1~4.1.4 ⏳ **留待 Brain AI 在 prod 驗算**（此環境無 `.env.dev` / 無法跑 live API；
      且 spec archive 條件本就要求 Brain AI 親自 prod 估價 5 條路線）

### 4.2 失敗降級驗證
- [x] 4.2.1 程式碼層確認：Routes API throw → catch → 寫 line_api_errors → v1 降級（getRouteWithFare）
- [x] 4.2.2 程式碼層確認：OSM classify try/catch → osmOk=false、freewayKm 0；縣市同理；不 crash
      （live 注入式驗證留待 Brain AI prod 抽測）

### 4.3 Firestore rules 部署
- [x] 4.3.1 firebase MCP 部署 `firestore:rules` 成功（project destination-anywhere-cfd50）
- [x] 4.3.2 rules validate OK；`fare_rules` collection client read/write 全禁

### 4.4 Push main 觸發 Vercel deploy
- [x] 4.4.1 commit 全部改動（3 commits：Phase 1 / 2 / 3）
- [x] 4.4.2 `git push origin claude/laughing-snyder-b5ba64:main`（fast-forward `017d2f0..5ea61b6`）
- [x] 4.4.3 Vercel 自動部署已觸發（本地 `pnpm build` 同等編譯通過）
- [ ] 4.4.4 ⏳ 真機估價肉眼驗證 — 留待 Brain AI

## 待 archive 條件

⏳ **未 archive**：等 Brain AI 在 prod 估價 5 條不同特徵路線都報告合理後，
跑 `openspec archive 2026-05-16-fare-v2`。

> ⚠ 開工前 prerequisite 中「GCP `NUXT_GOOGLE_MAPS_API_KEY` 啟用 Routes API + Elevation API」
> 已由 Brain AI 確認啟用（2026-05-16）。
