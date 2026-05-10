# Hand-off：航班系統重構 — Firestore flight_registry + 4 層 fallback + Silent Tracker

## 目前進度（2026-05-10 收工）

### 本 session 已完成 commits（按時序，往前）

```
a8167f8 fix(flight): 沒選用車時間就不發 API 查詢，避免誤導
19d2cde fix(flight): timetable + flightsFuture 雙 endpoint 分流（日期 < 7 天用 timetable）
2db74d9 fix(flight): timetable 改 flightsFuture — 支援查詢未來日期航班排程
4fc7115 fix(flight): 送機時間變更後 tooSoon 錯誤無法清除
151f97e fix(flight): Aviation Edge filter 改用 airline_iata + server-side 過濾
a5d6940 feat(flight): 整合 Aviation Edge 航班 API（取代 mock；保留 dev fallback）
f5d042d chore(p21+driver): driver pages padding 收尾 + admin/driver 多欄 grid 響應式
79363b8 fix(p22): admin/orders 編輯車型下拉白底白字 + 乘客通知模板補司機聯絡資料
3079ba4 feat(p22-fe): admin/orders 整合指派 + 取消 + 雙向通知至 modal
d678e5e feat(p22-fe): admin/orders 列表點擊開 modal + 完整訂單檢視 / 編輯
44bf72f feat(p22-be): admin/orders 後端擴充 — 完整訂單欄位 + admin 編輯權限 + 點對點通知
0aacc95 feat(driver): footer 改 admin 同款 sidebar drawer + 新增 /driver/traffic
```

### 完成主軸（已上 prod）

- **P22 admin/orders 完整改造**：列表點擊開 modal，含完整檢視 / 編輯 12 個欄位 / 取消（原因下拉）/ 通知乘客 / 通知司機 / 指派司機，全部整合在 modal 內
- **driver layout footer → admin 同款 sidebar drawer**，logo 連到 dashboard
- **新增 /driver/traffic**（與 admin/traffic 完全一致）
- **driver pages padding 收尾**（拔 footer 後留大空白問題）
- **P21 Phase 2 響應式**（admin/drivers, admin/settings, driver/dashboard, driver/profile 多欄 grid 斷點）
- **Aviation Edge API 整合**（迭代 6 個 commit 後發現 plan 涵蓋率本質限制，需重構）

### Aviation Edge API 重要發現（**避免下個 session 重複踩坑**）

API key：`a209b5-5215dc`，已設在 Vercel env `NUXT_AVIATION_EDGE_KEY`，已 redeploy 生效。

**已驗證的限制**：
- `/timetable` endpoint 只涵蓋 ~12h window：「過去 1-2 小時 + 未來 12 小時」，過時就消失
- `/flightsFuture` endpoint 拒絕 7 天內日期（API 回 `'date must be above {today+7}'`）
- `flight_iata` / `flight_num` filter 對所有航班都回 `No Record Found`，**只有 `airline_iata` 過濾可用**
- LCC / 區域航空涵蓋率極差（real-time 實測）：

| 航空 | timetable arrival 筆數 |
|---|---|
| CI 中華 | 40 |
| BR 長榮 | 48 |
| TG 泰航 | 19 |
| JL 日航 | 12 |
| JX STARLUX | 10 |
| CX 國泰 | 8 |
| NH 全日空 | 7 |
| KE 大韓 | 4 |
| OZ 韓亞 | 3 |
| SQ 新加坡 | 3 |
| LJ 真航空 | 0 |

**結論**：純 Aviation Edge 方案 UX 不可接受，需走 4 層 fallback + 自學 registry 架構（本次 spec）。

### 既有 server endpoint（要被取代 / 強化）

- `server/api/flight.get.ts`：目前實作 timetable + flightsFuture 雙路徑 + airline_iata filter + in-memory cache（5 min TTL）+ mock fallback。將被「Local Cache → Local Registry → TDX → Aviation Edge」4 層取代。

---

## 下個 Session 開場做這些

### 第一件事：讀文件

按順序（總計 ~10 分鐘）：

1. `CLAUDE.md`（根目錄，強制規範）
2. **本 HANDOFF**（架構核心 + 上一 session Aviation Edge 踩坑記錄）
3. `app/components/passenger/BookingStepType.vue` 跟 `server/api/flight.get.ts`（現有 client / server flow）
4. memory 中的 P20 / P21 / Aviation Edge backlog（auto load）

### 第二件事：跟使用者對齊未確認的設計細節

使用者已 paste 完整架構 spec（見下方「架構 Spec」段），但有以下細節要先 clarify：

**Q1：TDX API key 是否已申請？**
- 新 spec 提到 TDX（運輸部 PTX/TDX 平台）為第 3 順位 fallback
- 目前 `.env` 沒有 TDX key
- 需 user 提供，或先 skip 第 3 層只做 1/2/4

**Q2：flight_registry 的 TTL 預設值（30-90 天）**
- spec 寫「建議 30-90 天」，需 user 拍板（30? 60? 90?）
- 我建議 60 天（季度航班調整週期合理範圍）

**Q3：Silent Tracker 動態頻率輪詢的執行方式**
- 純 server-side cron（每分鐘掃 active orders 推進 tracker）→ 簡單但 cron 額外設定
- 或 client-side 推進（cliente polling）→ 不耗 server 但會打爆 API
- 建議 server-side cron，但需 user 確認

**Q4：「廣播推播」實作方式**
- spec 寫「統一推送至所有關聯的乘客 LIFF / 司機 LIFF」
- 現有 LIFF 沒有即時通道（websocket / polling）
- 走 LINE message push（既有 line-push.ts util）
- 或加 client polling（每分鐘拉訂單最新 flight info）
- 需 user 拍板通知通道

**Q5：「自動註冊」失敗處理**
- 第一次 API 拿到資料後寫 Firestore
- 寫入失敗（網路 / 權限）要不要重試？要不要回 user error？
- 建議：寫入失敗 silent log，不影響當次查詢回應

### 第三件事：分階段實作

依 user 提供的 spec 拆 4 個 stage（每 stage 獨立 commit + push 給 user 驗收）：

**Stage 1：Firestore registry collection + 1/2 層 fallback（Local Cache + Local Registry）**
- 新增 `server/utils/flight-registry.ts`：Firestore CRUD
- 新增 `server/utils/airport-registry.json`：航空公司 / 機場靜態辭典
- `server/api/flight.get.ts` 改：
  - 先查 Firestore `flight_registry/{flightNo}` → 命中且未過 TTL 直接回
  - 過 TTL 或 miss → 走第 4 層 Aviation Edge → 寫回 registry
  - 寫入時帶 `lastUpdated` / `status` / `airlineName` / `airlineCode` / `departureAirport` / `arrivalAirport` / `terminal`

**Stage 2：請求鎖定機制 (Request Collapsing)**
- in-memory promise map：同一 flightNo 同時來多 request → 共享 1 個 API call
- 結構：`Map<string, Promise<FlightInfo|null>>`，key = flightNo

**Stage 3：TDX 第 3 層 fallback**（需 user 提供 key）
- 新增 `server/utils/tdx-flight.ts`
- 4 層 fallback 邏輯：Local Cache → Local Registry → TDX → Aviation Edge
- 環境變數 `NUXT_TDX_CLIENT_ID` / `NUXT_TDX_CLIENT_SECRET`

**Stage 4：Silent Tracker + 數據分享 + 預熱**
- `server/api/cron/flight-tracker.ts`：cron job 每分鐘掃 active orders
- `ActiveFlightInstance` 物件管理（多訂單共用同 flightNo）
- 動態頻率：T-24h ~ T-4h(60min) → T-4h ~ T-1h(15min) → T-1h ~ landed(5min) → landed+1h 銷毀
- 狀態變更 → 廣播 LINE push 給該 flight 所有關聯訂單的乘客 + 司機
- 凌晨預熱：每天 03:00 batch 查當天所有訂單航班

---

## 完整架構 Spec（user 原文）

> 本系統遵循「降級優先、數據共享、成本最小化」原則。

### Firestore `flight_registry` collection

- 集合 (Collection): `flight_registry`
- 文件 ID (Document ID): `[FlightNumber]` (例如 `JX801`)
- 欄位 (Fields):
  - `airlineName`: "星宇航空"（來自本地辭典）
  - `airlineCode`: "JX"
  - `departureAirport`: "NRT"
  - `arrivalAirport`: "TPE"
  - `terminal`: "T2"
  - `lastUpdated`: timestamp（用於判定 TTL）
  - `status`: "Scheduled"（最後一次紀錄的狀態）

### TTL（30-90 天，待 user 拍板）

航班特徵（起降時間、航廈）並非永久不變（航空公司每季調整時刻表）。建議 30-90 天 TTL，過期自動透過 API 更新一次。

### 數據流優先順序（Fallback Strategy）

1. **Local Cache**：查 Firestore `flight_registry`
2. **Local Registry**：查專案內航空公司 / 機場靜態 JSON 辭典
3. **TDX API**：台灣機場（TPE / TSA / KHH）即時數據
4. **Aviation Edge API**：國際航段或 TDX 無資料時

### 「無痕追蹤器（Silent Tracker）」

- **監控視窗**：僅在訂單 STA 前 24 小時啟動
- **動態頻率**：
  - T-24h ~ T-4h: 每 1 小時輪詢
  - T-4h ~ T-1h: 每 15 分鐘輪詢
  - T-1h ~ 落地: 每 5 分鐘輪詢
- **自動銷毀**：狀態 = `Landed` 或 `Arrived` 1 小時後停止輪詢

### 數據分享機制

- **多對一對應**：當天 10 組乘客搭 `JX801` → 系統只維護一個 `ActiveFlightInstance`
- **廣播推播**：API 取得最新狀態後，統一推送至所有關聯的乘客 / 司機 LIFF
- **請求合併**：高併發時防止重複 API 請求

### 自動註冊（Self-Learning Registry）

- 系統通過 API 成功取得資料 → 立即寫入 `flight_registry`
- 下次查詢同航班 → UI 從快取秒渲染，僅「即時動態內容」（延誤、預計抵達）背景更新

### 預熱機制

- 凌晨低峰時段批次查當天所有訂單航班，減少尖峰 API 負擔

---

## 後續 backlog（HOLD 中）

依使用者偏好排序：

1. **P19 後續**（HOLD，等 user 回 Q1/Q2/Q3）
   - 訂單推送通知（LINE 訊息）
   - 乘客端追蹤司機位置
   - driver/dashboard online hours 統計

2. **P20 booking 表單擴充**（user 明確說「乘客端收尾查驗時做」）
   - contactPhone / flightNumber / terminal / notes 四欄位
   - spec 在 `openspec/changes/2026-05-XX-p20-booking-extras/`
   - 注意：本次 flight_registry 完成後，flightNumber / terminal 可從 registry 自動填，P20 範圍可能縮小

---

## 關鍵已知資訊

### 部署 / 環境

- production: https://da-line-liff-app.vercel.app
- branch 模式：`git push origin <local-branch>:main` fast-forward
- 對話用繁中、commit message 用 Conventional Commits 繁中、attribution 已禁用
- node 版本支援 `--env-file` 載 `.env.dev`

### Vercel env 已設

- `NUXT_AVIATION_EDGE_KEY=a209b5-5215dc`（Aviation Edge Developer plan）
- `NUXT_FIREBASE_SERVICE_ACCOUNT_JSON`
- `NUXT_FIREBASE_STORAGE_BUCKET`
- `NUXT_GOOGLE_MAPS_API_KEY`
- `NUXT_LINE_CHANNEL_SECRET`
- `NUXT_LINE_CHANNEL_ACCESS_TOKEN`
- `NUXT_INTERNAL_API_KEY`
- `NUXT_CWA_API_KEY`

待新增（依本 spec）：
- `NUXT_TDX_CLIENT_ID` / `NUXT_TDX_CLIENT_SECRET`（TDX 平台 → user 需申請）

### 既有 Firestore collections

- `users` / `drivers` / `admins`
- `orders`（含 statusHistory.{state}At）
- `airport_flow/{date}`（機場人流預報 cache，schemaVersion=2，7 天清理）
- **新增**：`flight_registry/{flightNo}`（本次 spec）

### 既有 LINE push utility

- `server/utils/line-push.ts` `sendLinePush(token, to, [{type:'text', text}])`
- 既有用法：admin broadcast、admin/orders 點對點 notify

### 既有 cron / 排程機制

- 目前**無** server-side cron（airport_flow 是 lazy on-demand cache）
- Vercel cron 需要新增 `vercel.json` 或用 Vercel Cron Jobs（每 10 分鐘 / 每小時 / 每天）
- 或用外部 scheduler 打 `/api/cron/*` endpoint
- Silent Tracker 實作前需 user 確認方案

---

## 給下個 session 的提醒

- **第一件事讀本檔**，特別是「Aviation Edge 重要發現」段，避免重複測試已驗證的限制
- 動 server flight 邏輯前先確認 4 層 fallback 順序（Local → Registry JSON → TDX → Aviation Edge）
- 寫 Firestore flight_registry 前先建 composite index（`lastUpdated` 用於 TTL 排序）— 現有 firestore.indexes.json（如有）需更新
- TDX 需要先取得 API key — 沒拿到就先做 Stage 1 + 2，跳過 Stage 3
- Silent Tracker 需要 cron — 先跟 user 對齊執行方式（Vercel Cron / 外部 / on-demand）
- 完成後請 user 用 LIFF 實測：
  - 訂車 → 輸入有資料的航班（CI / BR / JX）→ 應該秒渲染（命中 cache）
  - 訂車 → 輸入新航班 → API call 後寫入 registry，下次秒渲染
  - 訂車 → 輸入小航空（LJ）→ Local Registry 補基礎資料（airline name），即時資訊缺失 graceful fallback
