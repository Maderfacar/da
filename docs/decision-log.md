# 決策紀錄 (Decision Log)

每次重大決策或新增套件時，必須立即更新此檔案（時間由新到舊）。

格式：**日期** / **類型** / **標題** / **背景** / **決定** / **影響** / **替代方案**

---

### 2026/05/14 — P36：訂單詳情頁 + 司機真實電話撥號

**類型**：Feature / 乘客端體驗

**標題**：/orders/[orderId] 詳情頁完整化（含 stopovers / 距離 / ETA / 司機資訊）

**背景**：
- 乘客在 /orders 列表僅見「狀態 / 起訖 / 車種 / 時間」，看不到中途停靠點、預估距離 / 車程、司機資訊、備註與航班 / 航廈
- P17 體驗細節最後一塊空白；P35 profile 統計落地後乘客端剩此一缺口
- 業務未拍板司機聯絡方式：A 真實電話 / B LINE OA 中繼 / C placeholder

**決定**：
- **endpoint：** [server/routes/nuxt-api/orders/[orderId].get.ts](../server/routes/nuxt-api/orders/[orderId].get.ts) — owner / admin / assigned driver 三角色分流；`_normalizeDriverId` + `_stripLinePrefix` 兼容雙格式比對；Timestamp 序列化為 ISO string
- **司機資訊揭露：** 僅在 orderStatus ∈ {confirmed, en_route, arrived_pickup, in_transit, completed} 才回 driver 物件；pending / cancelled 為 null
- **司機聯絡方式：Brain AI 拍板採 A — 真實電話**（`drivers.application.phone`），前端 `tel:` 直接撥號
  - 理由：接送中真的找不到車比隱私風險更剛性；遲到 / 找不到車是 P0 痛點
  - 風險揭露：司機真實號碼會被乘客拿到；後續可考慮升級為 number masking 服務（Twilio / Vonage proxy）
- **30s polling + visibility refresh** 沿用 orders/index 模式
- **403 / 404 自動 router.replace('/orders')** 避免長停留損壞 URL
- **三語 i18n 強制對齊**：zh/en/ja 各 236 keys 完全相同（**Why:** 乘客端必須三語；driver/admin 內部頁不適用此規則）

**影響**：
- 新檔：1 server endpoint、1 頁面、1 type 區塊
- 修改：app/protocol/fetch-api/api/order/index.ts 加 `GetOrder`、orders/index.vue 卡片改 NuxtLink、3 個 locale 補 `status.en_route` / `status.arrived_pickup` / `orderDetail.*`
- 不影響既有 orders/index.vue 列表 schema 與 orders/[orderId].patch 邏輯
- driver phone 自此暴露給乘客；若日後改用 masking 服務，server endpoint 內 `driver.phone` 出口改寫即可，前端不需改

**替代方案**：
- ❌ B（LINE OA 中繼）：客服值班壓力 + 體驗繞圈圈，遲到場景無法即時通
- ❌ C（placeholder `(TBD)`）：當下接送找不到車就尷尬；雖最低成本但業務不接受
- ❌ 在 orders/index.vue 直接展開全部欄位：列表 UI 會爆，且每張卡都要拉司機資料（N+1）

**待手動驗證（部署後）**：
- 拿 driver A 帳號 idToken 打 `/nuxt-api/orders/{driver_B 的訂單 ID}` → 預期 403 `無權檢視此訂單`
- 拿 passenger 帳號 idToken 打他人訂單 → 預期 403
- 司機卡在 `pending` 訂單應**不顯示**（即使有人為設定 assignedDriverId）

---

### 2026/05/13 — P25-1：driver today 歸零 + online hours 合併實作

**類型**：Feature / Schema 擴充 + 狀態流整合

**標題**：lazy reset + 共用 todayResetAt 欄位避免雙寫；online hours 共用 currentOnlineSessionStartAt

**背景**：
- `drivers/{lineUid}` 內 `todayTrips` / `todayEarnings` 跨日不歸零 → driver/dashboard 顯示假數據
- ONLINE HRS 永遠 0 → 已暫隱藏
- 不想引入 Vercel Cron（增加維護面 + 沒有原子保證）

**決定**：
- **方案 B（lazy reset）**：所有 today 系列寫入入口先過 `maybeResetTodayPatch` helper
- **共用 `todayResetAt` 欄位**：歸零與 online hours 用同一個時間戳判斷台北今日，避免兩個 cron 寫同一欄
- **時區嚴格**：`dayjs.tz('Asia/Taipei').format('YYYY-MM-DD')` 比對；UTC 直接比會在台北 0:00~8:00 之間算錯日
- **busy 期間不計入 online hours**：busy → online 時重啟 `currentOnlineSessionStartAt`，busy 段那部分時數直接拋棄
- **fallback 5min stale**：drivers/available.get 讀取時若 online 但 lastActiveAt > 5min → 強制結算 + 標 offline（涵蓋 driver 關 app 不下線情境；用 lastActiveAt 結算，不算「離線後」假時數）
- **新 helper `composeStatusTransitionPatch`**：整合「歸零 + 結算 + session 重啟」單一函式，避免呼叫端各自寫 race-prone 流程

**影響**：
- drivers schema +4 欄：`todayResetAt` / `currentOnlineSessionStartAt` / `todayOnlineSeconds` / `totalOnlineSeconds`
- orders/[orderId].patch：en_route 結算 online 段；completed 累加前 maybeResetToday + 切回 online 重啟 session
- drivers/[id]/status.patch 新 endpoint（busy 中拒絕；只接受 online / offline）
- drivers/[id]/location.put heartbeat：30s 一次順便檢查跨日歸零（最遲過 00:00 後 30s）
- drivers/[id]/stats.get：回傳 `todayOnlineSeconds`（含當前 session live delta）+ `status`
- driver/dashboard：ONLINE HRS 復活、上下線開關 UI、60s polling

**替代方案**：
- ❌ Vercel Cron 每日 00:00 批次歸零：增加單點維護面、無原子保證、Vercel 免費額度限制 → 採 lazy reset
- ❌ 雙欄位（lastTripDate + lastOnlineDate）：兩個時間戳會 race（同一段操作分兩次寫）→ 採共用 `todayResetAt`
- ❌ realtime listen heartbeat（每秒推）：成本爆 → 採 60s polling，UI 自然平滑

---

### 2026/05/13 — P32：加好友橫幅 vs Home Hero 排版重疊修正

**類型**：Bug fix / Layout

**標題**：layout main 偵測 banner 顯示加 40px padding-top，避免遮擋

**背景**：
- 加好友橫幅 [front-desk.vue:100-102](../app/layouts/front-desk.vue) `position: fixed; top: 56px` 高約 40px
- Hero 區塊 [home/index.vue:238](../app/pages/home/index.vue) `padding-top: 56px` 只預留 nav 高度，沒給橫幅讓位
- 結果：橫幅顯示時遮 Hero 內容約 40px

**決定**：
- layout main 加 reactive class：`:class="{ 'has-banner': showFriendBanner }"`
- `.has-banner` CSS 補 `padding-top: 40px`
- 影響所有 front-desk 頁（home / booking / orders / upcoming / fleet / profile）— 一致下移，無例外處理

**影響**：1 個檔案修改（[front-desk.vue](../app/layouts/front-desk.vue)）

**替代方案**：
- ❌ 每個頁面自己偵測：DRY 破壞 + 容易漏；改 layout 級處理一次
- ❌ banner 改成 sticky 在 flow 內：會影響滾動行為，與既有設計衝突

---

### 2026/05/13 — P19 backlog：driver 地圖中心追蹤決議移除

**類型**：Scope cut

**標題**：passenger 看自己訂單司機位置不在 roadmap 內

**背景**：P19 完成後留下「passenger 看自己訂單司機位置」backlog，原為「待業務優先級確認」

**決定**：Brain AI 2026/05/13 確認**完全移除**，不會做。理由：
- driver 隱私顧慮（即時位置給乘客 = 業務面新增 opt-out 機制）
- passenger 端已有訂單詳情 + status push 通知足夠
- LINE messaging 推送（接單 / 抵達 / 完成）能覆蓋同等需求，工程量低很多

**影響**：tasks.md P19 後續工作章節該項標 ❌；不影響 schema / 既有 driver 定位邏輯（war-room 仍需要 driver 即時位置）

---

### 2026/05/12 — P28：機場人流 fetcher 補抓轉機+過境欄位 + UI 加 4 個方向選項

**類型**：Bug fix / 資料層補齊

**標題**：airport-xls-fetcher 從只讀 2 欄擴到 5 欄，UI direction options 從 3 個擴到 7 個

**背景**：
- user 比對桃機 XLS 與 admin/driver `/traffic` 頁，發現「全端 + 進出境合計」數字對不上檔案總計
- 單看 T1/T2 各自的出/入境數字仍跟網頁相符 → 排除航廈級的解析錯誤
- 根因：fetcher 只讀「出發/抵達」2 欄/航廈，**漏抓轉機離站 / 到站轉機 / 過境離站** 共 9 個 column（每航廈 3 個 × 3 航廈），造成 ~23767 人流被忽略

**決定**：
- fetcher COL 從 7 個擴到 17 個；HourRecord 每小時從 9 筆擴到 21 筆（3 terminal × 7 direction）
- `SCHEMA_VERSION` 2 → 3 → 既有 Firestore cache 自動失效重抓
- Direction 新增 4 值：`transit-arrival` / `transit-departure` / `overnight-departure` / `total`
- 兩個 traffic 頁 UI（admin + driver）加對應 4 個 radio 選項，`.PageTraffic__seg` 加 `flex-wrap` 避免窄螢幕爆框
- `all` 維持「進出境合計（出+入，不含轉機/過境）」語義不變；想看全量人流選 `total`

**影響**：commit `6b8c98b`；user 比對檔案應該對齊；admin/driver 司機調度可看到準確的轉機/過境流量

**替代方案（未採用）**：
- 把 `all` 改成全 5 欄總和 → 語義不精確且破壞既有 API 約定
- 純改 label 不擴資料 → 司機/admin 無法看到實際轉機人數

---

### 2026/05/12 — P27：driverApplication 從 users 搬到 drivers/{uid}.application（P26 前置整理）

**類型**：Schema 重構 / Collection Split 延伸

**標題**：driverApplication 整包搬遷 users → drivers 子欄位，以 dual-read + 一次性 migration 完成 Stage A

**背景**：
- P18 collection split 當時只搬了 driverCategory + 加 todayTrips/todayEarnings/vehicleType。`driverApplication` 整包仍留在 users，導致 driver 資料分散在 users / drivers 兩處
- P26 driver profile editor 規劃讀寫 driver 完整資料（含 application），若不先整理 schema，P26 就被迫處理「兩處兼容讀寫」
- 22 檔受影響：5 server / 5 frontend / 6 docs / 1 新 migration script

**決定（Stage A + B 兩階段 deploy）**：
- **Stage A**（commit `b761ac4` + `57a42b2`）：程式碼支援 dual-read（drivers 優先，users fallback），寫入只進 drivers.application
  - 新 helper `server/utils/driver-application.ts`（readDriverApplication + batchReadDriverApplications）封裝雙讀邏輯
  - driver/apply.post.ts 寫 target 改 drivers.application；冷卻檢查走 helper
  - admin/users/[uid].patch.ts dot-path 改寫 drivers.application.*；driverCategory 合併同一次 drivers.set(merge)
  - admin/users/index.get.ts list 批次 dual-read（drivers batch 先，users batch fallback）
  - app/stores/5.store-auth.ts client SDK 也走 dual-read（讀 drivers/{uid}.application，fallback users.driverApplication）
  - 新 `scripts/migrate-driver-application-to-drivers.mjs`：支援 --dry-run / --apply，idempotent（已搬過 skip 並清殘留）
  - AuditAction 加 `migration.driver_application_move`
- **Stage B**（2026-05-12 同日完成）：跑 prod migration + 移除 fallback 兼容碼
  - prod migration 結果：scanned 2 / migrated 2 / skipped 0 / failed 0 / duration 0.63s
  - audit log `migration.driver_application_move` 已寫入 prod audit_logs
  - Firebase Console 抽查 + prod admin/drivers 列表驗證資料完整顯示後執行清理
  - 移除 `server/utils/driver-application.ts` 內 users fallback；整個刪除 `batchReadDriverApplications`（admin/users 直接 batch read drivers 不再需要兩段式 fallback）
  - 移除 `app/stores/5.store-auth.ts` client SDK 內 `data.driverApplication` fallback
  - 移除 `server/routes/nuxt-api/admin/users/index.get.ts` 內 driversMissingApp fallback block
  - 跳過 24h soak：兩個 driver 都已 approved 不會主動觸發新寫入；admin/drivers 列表已實際走過讀取路徑

**實際部署順序**：
1. Stage A code 上 prod（`db51901` deployment）
2. `pnpm migrate:driver-app --dry-run` 驗證影響筆數（2 筆 / 0.37s）
3. `pnpm migrate:driver-app --apply` 執行搬遷（0.63s 完成）
4. Firebase Console 抽查 + admin/drivers 列表驗證
5. Stage B code 移除 fallback（本次 commit）
6. P26 開工

**影響**：
- prod data：每位 driver 的 driverApplication 從 users doc 移到 drivers doc，原欄位刪除
- API contract：admin/users.get 回傳 shape 不變（仍有 driverApplication 欄位），client 無感
- 解鎖 P26 driver profile editor

**替代方案（未採用）**：
- 一次性 deploy + 即時 migration：簡單但有 race window，prod 流量不可控時段不安全
- 改用 nested 平鋪（drivers.driverApplication）：和 P18 風格（drivers.application 簡潔命名）不一致

---

### 2026/05/12 — TDX 航班 GeneralSchedule 整合：Booking 階段排程驗證主資料源（取代 Aviation Edge）

**類型**：架構重構 / 第三方 API 切換

**標題**：booking 頁航班輸入欄位的 schedule 驗證從 Aviation Edge 切換到運輸部 TDX；Aviation Edge 暫時 hold 等之後接「即時狀態查詢」階段

**背景**：
- Aviation Edge Developer plan 實測 LCC / 區域航空涵蓋率極差（LJ 0、SQ 3、KE 4 筆，CI/BR/JX 等大航空 OK），純靠它 booking 頁查詢 UX 不可接受
- TDX 為運輸部開放資料平台，免費，提供台灣航空時刻表（含國內 + 國際），符合 booking 階段「驗證 schedule 是否存在 + 用車日期是否符合排程」需求
- 之後 Aviation Edge 仍會接回，但只用於「查單筆訂單當天的實際執飛狀態」（status / estimatedTime / actualTime / 延誤），跟 booking 階段的 schedule 完全分離

**決定（分 4 Stage 上線，每 stage 獨立 commit）**：
- **Stage 1**（commit `60b0c73`）：[server/utils/tdx-flight.ts](server/utils/tdx-flight.ts) helper（~280 行）
  * OAuth2 client_credentials grant，token in-memory cache（24h TTL，提早 60s refresh）
  * 並發拿 token 共用 promise，避免 race condition 重複 OAuth
  * Domestic + International 雙 endpoint 並行打，union 結果，flightNo 二次過濾
  * Codeshare 雙向比對：第一輪精確 `AirlineID + FlightNumber`，miss 則 fallback `OperatingAirlineID + OperatingFlightNumber`
  * 4 條 validation：找得到 + 至少一端在台灣（TPE/TSA/KHH/RMQ）+ 用車日期在 EffectiveDate~ExpireDate 內 + weekday 在 WeekDays 內（[1,3,5] 格式）
  * 任一不過 → 回 null，呼叫端自行 fallback
  * 相容讀取 TDX 兩種 weekday 欄位（WeekDays[] 或 WeekPattern 七元素 [Mon..Sun] flag）
  * `nuxt.config.ts` 新增 `tdxClientId` / `tdxClientSecret` runtimeConfig
- **Stage 2**（commit `e667a28`）：[server/utils/flight-registry.ts](server/utils/flight-registry.ts) 擴 `tdx` 子物件
  * 新 `FlightRegistryTdxBlock` interface + `IsTdxBlockFresh()` (24h) + `SaveTdxBlockToRegistry()`
  * 不動既有 Aviation Edge 寫入的 `schedules` / `departureAirport` 等欄位，TDX 寫入透過 dot path 精準寫 `tdx.*` 子欄位避免覆蓋
- **Stage 3**（commit `bc66738`）：[server/api/flight.get.ts](server/api/flight.get.ts) `_lookupFlight` 整合
  * 新 Layer 順序：in-memory → registry.tdx (24h+適用驗證) → registry.schedules (向下相容) → TDX API → Aviation Edge (HOLD 不調用) → stale fallback → mock
  * `_tdxResultToFlightInfo()` 把 TDX schedule 轉 FlightInfo，`estimatedTime = scheduledTime`（user 拍板方案 a），`status='scheduled'`
  * `_isTdxBlockApplicable()` 每次取 registry.tdx 都驗證該 date 仍在 effective 區間 + weekday 適用
  * Aviation Edge helper（_callAviationEdge / _queryAeTimetable / _queryAeFuture / 兩個 mapper）**全部保留在檔案內**，僅 `_lookupFlight` 不調用，等之後接「即時狀態」階段啟用
  * BookingStepType.vue **完全不動**：API contract 沒變、estimatedTime fallback 讓送機 3h 檢查仍成立、所有 validation 失敗統一回 404 沿用 `notFound` 文案

**驗證 4 條（任一不過 → 視為查無此航班）**：
1. flightNo 找得到（含 codeshare 雙向比對）
2. 至少一端機場在台灣（TPE / TSA / KHH / RMQ）
3. 用車日期在 schedule 的 EffectiveStart~ExpireDate 區間內
4. 用車日期當天的 ISO weekday 在該班的 WeekDays 內

**影響**：
- 新增 [server/utils/tdx-flight.ts](server/utils/tdx-flight.ts) (~280 行) + [openspec/changes/2026-05-12-tdx-flight-integration/HANDOFF.md](openspec/changes/2026-05-12-tdx-flight-integration/HANDOFF.md) (~213 行)
- 修改 [server/utils/flight-registry.ts](server/utils/flight-registry.ts) (+67 行) + [server/api/flight.get.ts](server/api/flight.get.ts) (+148 / -39 行) + [nuxt.config.ts](nuxt.config.ts) (+2 行 runtimeConfig)
- 新增 Vercel env：`NUXT_TDX_CLIENT_ID` + `NUXT_TDX_CLIENT_SECRET`（user 自行設定，**絕不可外洩到 client**）
- Firestore `flight_registry` doc 結構擴充（向下相容）：新增 `tdx` 子物件，與既有 Aviation Edge 寫入的 `schedules` 並存
- API contract 完全沒變（client BookingStepType.vue 不需動），所有失敗情境統一回 404 → UI 顯示既有 `notFound` 文案

**已知限制與後續**：
- Aviation Edge **booking 階段不打**，但 helper 全保留（成本 = 0，等之後 unhold 直接接「即時狀態」endpoint 啟用）
- TDX rate limit：標準會員 50 req/sec、50k req/day，雙 endpoint 並行 = 2 req/查詢，遠低於上限
- Codeshare 雙向比對 best-effort（TDX 文件未必每筆都帶 OperatingAirline），漏網航班可未來加 manual fallback UI

**替代方案（已評估後否決）**：
- 純 Aviation Edge：LCC 涵蓋差，UX 不可接受
- 預熱 100 條常見 TPE 航線 import Firestore：工作量大，TDX self-learning 會慢慢補上，Open
- Layer 3 改 client-side 直接打 TDX：違反「TDX key 不可外洩」原則
- token cache 走 Firestore 跨 instance 共用：每次多 1 次 Firestore read，比 in-memory 重拿 token 還貴

**verify**：lint pass + nuxt build pass（4 commits 階段獨立，皆可獨立回滾）

**相關 spec**：[openspec/changes/2026-05-12-tdx-flight-integration/HANDOFF.md](openspec/changes/2026-05-12-tdx-flight-integration/HANDOFF.md)（含 stage 拆解 + 接手注意事項 + TDX response 範例）

---

### 2026/05/11 — orders POST 距離計算：Distance Matrix 改 Directions API + waypoints

**類型**：bug 修復

**標題**：訂單確認頁顯示金額與下單後實際金額不一致

**背景**：
- 前端 BookingStepRoute 用 `/api/maps/route`（Google Directions API + via: waypoints）算距離，含中途停靠站繞行
- server `orders/index.post.ts` 卻用 Distance Matrix（origin → destination 直線），完全沒帶 `body.stopovers`
- 同一車型 + 同一份 fleet config，但距離不同 → `calculateFare` 結果不同 → 乘客在 confirm 頁看到 NT$ X，下單成立後變成 NT$ Y

**決定**：
- 抽 [server/utils/calc-route-distance.ts](server/utils/calc-route-distance.ts) helper（Directions API + via: waypoints + 全 legs 加總）
- `orders/index.post.ts` 換用 helper，並把 `body.stopovers`（過濾 lat===0）傳進去
- 前後端皆走 Directions API，結果一致

**verify**：lint pass + build pass（commit `8115ae8`）

---

### 2026/05/11 — P23 Fleet 設定動態化：hardcode 計價搬到 Firestore + admin/settings CRUD UI + 行李 SU 制

**類型**：功能 / 資料模型變更

**標題**：`shared/pricing.ts` 退役，4 種車型 + 4 項加值服務 + 4 種行李類型全面 Firestore 化；admin 可在 `/admin/settings` 即時編輯；booking 表單行李改 SU（Standard Unit）容量制

**背景**：
- P22 收尾後盤點，業務需求改變時 fleet 計價參數仍需改 code + redeploy（`VEHICLE_CONFIGS` / `EXTRA_SERVICES` / `EXTRA_SERVICE_PRICE` 全寫死於 `shared/pricing.ts`），admin 無法即時調整
- booking `luggageCount: number` 無法區分行李尺寸（20" 登機箱 vs 32" 大型 vs 高爾夫袋容量差數倍），導致車型選擇邏輯失準
- 加值服務一律共用 NT$ 200 單價、固定 4 項，admin 無法新增「接機舉牌」「兒童安全座椅」等選項

**決定（分 5 Stage 上線）**：
- **Stage 1**（commit `3183f3c`）：3 個 Firestore collection（`fleet_vehicles` / `fleet_luggage_types` / `fleet_extras`）+ `server/utils/fleet-config.ts`（type / validator / seed defaults / auto-seed if empty）+ 公開 GET `/nuxt-api/config/fleet` + admin CRUD `/nuxt-api/admin/config/:resource[/:id]`（需 `canManageFleet` 權限，super + admin 預設有、assistant 無）
- **Stage 2-3**（commit `4668e06`）：`app/stores/8.store-config.ts` Pinia store（Init / Reload / GetVehicle / EnabledVehicles / LabelOf）+ `plugins/init-config.client.ts` 啟動時撈一次 cache 進 store；8 個既有 caller（fleet/booking/driver trip/admin orders/upcoming/store-order 等）全切換到 store；booking 行李 UI 改為 4 個 SU stepper + 即時 SU 容量校驗（≤capacity ok / ≤1.5x warn 可選 / >1.5x disabled 紅字）；`CreateOrderParams.luggageCount` 移除，新增 `luggageItems: { typeId, count }[]`
- **Stage 5**（本 commit）：admin/settings 新增「Fleet 設定」section 含 3 個 sub-tab，3 個獨立組件（`SettingsFleetVehicles.vue` / `SettingsFleetLuggageTypes.vue` / `SettingsFleetExtras.vue`），每個含列表 + 新增 / 編輯彈窗 + 啟用切換 + 刪除確認，操作後 `await StoreConfig().Reload()` 即時刷新乘客 fleet/booking 頁
- SU 換算 seed：small=1 / medium=2 / large=3 / special=4；車型 luggageSU 容量：sedan=4 / suv=7 / van=14 / premium=4
- 既有測試訂單不兼容（user 確認上線前清庫）

**影響**：
- 新增 3 個 component（admin/SettingsFleet{Vehicles,LuggageTypes,Extras}.vue）+ 1 個 store（`app/stores/8.store-config.ts`）+ 1 個 server util（`server/utils/fleet-config.ts`）+ 4 個 server endpoint + 1 個 client API protocol（`app/protocol/fetch-api/api/config/`）
- `shared/pricing.ts` 內 `VEHICLE_CONFIGS` / `EXTRA_SERVICES` / `EXTRA_SERVICE_PRICE` 全部移除，僅保留型別定義 + `calculateFare` 算法（簽名改為接 `vehicle` 物件 + `extras` 物件陣列）
- order schema：`luggageCount` 移除，新增 `luggageItems`；driver/admin trip modal 顯示「20" 登機箱 × 2、24-26" 中型 × 1」明細
- admin 編輯後乘客 reload page 才生效（未做 real-time listener，記入 backlog）

**已知陷阱（給未來 admin/設計）**：
- Pug template `#{...}` 與 Vue `{{ }}` 衝突，row id 顯示用 `{{ '#' + v.id }}` 而非 `#{{ v.id }}`
- doc id slug 限制 `^[a-z0-9][a-z0-9-]{0,49}$`，UI 在 ID 欄位加說明
- 刪車型不影響舊訂單（Firestore 內 vehicleType 是 string 快照），admin/orders 編輯模式車型 select 已加「（已停用或刪除）」option fallback

**替代方案（已評估後否決）**：
- 用 GitHub Gist 存 config：寫入需 PAT、admin UI 體驗差、Firestore 已有相同成本結構
- 把 hardcode 從 `shared/pricing.ts` 改為環境變數：仍需 redeploy、無法多語 label、admin 無法操作
- admin 編輯後 real-time listener 推播：本 spec 範圍刪減（reload page 已可接受，未來有需求再做）

**verify**：lint pass + build pass（Nuxt 4.4.2 + Nitro 2.13.3，server bundle 36.5MB）

**相關 spec**：`openspec/changes/2026-05-11-p23-fleet-admin-config/proposal.md`

---

### 2026/05/09 — 機場人流預報：棄用 n8n + Gist，改 server cheerio + xlsx + Firestore cache

**類型**：架構重構

**標題**：admin/traffic 後端從「n8n 抓 → Gist 寫入 → server 讀 Gist」改為「server 內建抓取 + Firestore cache」

**背景**：
- 2026/05/01 設計：n8n 每小時抓桃園機場 XLS → 解析 → PATCH 寫 GitHub Gist；admin/traffic 透過 `airportForecastGistUrl` env 直接讀 Gist raw URL
- 2026/05/09 健檢發現 Gist 從 5/1 之後完全沒新檔（最後一筆 `airport-2026-05-02.json`），admin/traffic 連續 8 天顯示 mock
- 根因不可考（n8n 服務狀態 / cron 是否觸發 / PAT 是否過期等都需登入 n8n 介面排查），維運面對外部依賴失控

**決定**：
- 移除 n8n + Gist 中介層，server 端直接整合「抓 → 解析 → 快取」
- `server/utils/airport-xls-fetcher.ts`：直拼 `https://www.taoyuan-airport.com/uploads/fos/{YYYY_MM_DD}.xls` 為主路徑，cheerio 抓 `taoyuanairport.com.tw/flightforecast` 為 fallback；xlsx (SheetJS) 解析動態欄位
- `server/api/airport/flow.get.ts`：lazy fetch 模式 — 讀 Firestore `airport_flow/{date}` cache → miss 才呼叫 fetcher → 寫回 Firestore → 順手刪除 7 天前舊 doc（一日只保留 2-3 筆）
- 機場下載 URL 有反爬蟲，必帶 User-Agent + Referer headers（n8n workflow 已驗證的設計）

**影響**：
- 移除：`n8n-workflow-taoyuan-xls.json`、`data/airport-forecast/`、`server/api/airport/flow.post.ts`、`server/routes/nuxt-api/airport-forecast/{get,post}.ts`
- 移除 env：`NUXT_AIRPORT_FORECAST_GIST_URL`（Vercel 端可手動刪除）
- 新增依賴：`cheerio` ^1.2.0、`xlsx` 0.20.3（從 SheetJS 官方 CDN `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` 安裝）
- 新增 nuxt.config nitro.externals.inline `['xlsx', 'cheerio']`，強制 server bundle inline 化
- Firestore 寫入成本：每日 2-4 筆（今+明各一次寫入，Free tier 每日 20,000 筆，用量 0.02%）
- 儲存量：每筆 ~1.3KB，配合 7 天清理永遠只有 2-3 筆 doc
- `app/components/admin/AirportForecastWidget.client.vue`（driver/dashboard 用）改透過 facade 走新 endpoint，widget 不變
- `firestore.rules`：移除 `airport_flow_forecast` 規則，改為 `airport_flow` 全 deny（純 server admin SDK）

**hotfix（同日）**：
- 首次部署時遇 `ERR_MODULE_NOT_FOUND: xlsx/dist/cpexcel.js`，整個 server bundle 連坐 crash（所有 endpoint 500）
- 根因：npm 上 `xlsx@0.18.5` 為 SheetJS 已停止維護的舊版，內部用動態 require 載 cpexcel codepage 檔，Vercel ESM bundling 後路徑失效
- 修法：（1）改裝官方 CDN 版 0.20.3（SheetJS 官方推薦做法）（2）nuxt.config nitro.externals.inline 強制 inline xlsx + cheerio
- 教訓：新增 server-side 依賴（特別是有 dynamic require 的）需要先發單獨測試 commit 上 Vercel 驗證，不可跟其他 feature 改動綁同 commit

**替代方案（已評估後否決）**：
- 在 server 內建 in-memory cache（每 instance 各自 cache）：Vercel cold start 多 → cache 命中率低 → 形同每次都重抓 → 慢
- 沿用 Gist：需新增 Vercel `NUXT_GITHUB_GIST_PAT` env，PAT 安全顧慮、寫入較慢、timeout 風險高
- 重新修好 n8n：不可控因素過多（n8n 服務、cron、PAT、機場網站變動）
- 改用 `exceljs` / `read-excel-file`：兩者皆**不支援 .xls** 格式（僅 .xlsx），桃園機場是 .xls
- npm 上的 `node-xlsx`：底層仍是 SheetJS，同 cpexcel 問題

---

### 2026/05/09 — P19 Driver Trip Mission：五階段狀態流 + driver 自動定位 + war-room status filter

**決策類型**：新功能 / 資料模型變更
**標題**：driver/trip 重寫為任務列表 + 五階段操作（出發/到點/上車/下車）；driver 端 layout 自動定位（無上下線按鈕）；war-room 加 status filter + offline 由 lastActiveAt 推導

**背景**：P18 收尾後盤點 driver 端缺口：
1. 沒有「我被指派的訂單」頁面 — 搶單在 `/driver/pending`，但接單後無處看任務 + 行程進度
2. 訂單狀態粒度太粗 — `confirmed → in_transit → completed` 中間缺「出發 / 到點」兩節點，admin 在 war-room 看不到司機目前在哪段
3. 司機定位機制錯位 — 依賴司機在 `/driver/trip` 手動按「上線」啟動 GPS；P18 暴露問題後使用者要求改為「**登入 driver 端就自動授權 + 持續上傳**」，不再有手動上下線按鈕
4. war-room 邏輯瑕疵 — markerMap 沒清理會 leak、stale 資料不過濾、靜止司機 heading=null 被當成指北
5. 從乘客 LIFF URL 進入卻被導到司機端 — 真因為 `index.vue` 對 multi-role 使用者優先導 driver；使用者選擇純 LINE Console 端設定 LIFF endpoint URL（不需 code 改）

**決定**：

1. **訂單狀態擴充為 7 值**：`pending → confirmed → en_route → arrived_pickup → in_transit → completed`（+ cancelled）。新增 `en_route`（出發前往上車點）+ `arrived_pickup`（已到達上車點）對應司機操作節點。

2. **driver 嚴格狀態機**：driver 改 status 必須照 `confirmed → en_route → arrived_pickup → in_transit → completed` 推進；server 端拒絕跳階段。owner（passenger）只能改 `cancelled`；admin 任意。driver 不可改 assignedDriverId（只能改自己被指派的訂單，例外是 driver/pending 搶單時把自己指派為司機）。

3. **drivers.status 語意調整 — Firestore 只存 online/busy；offline 由 lastActiveAt 推導**：
   - driver 端不再寫 `offline`（`location.put.ts` 拒絕 client 帶 'offline'）
   - drivers.status 只能是 `online` 或 `busy`
   - war-room client-side 比對 `lastActiveAt`，差距超過 **600 秒（10 分鐘）** 推導為 `offline`
   - **busy 觸發點是 confirmed → en_route**（司機按「出發」），不是接單時。confirmed 階段 driver 仍 online + 有 active assigned order 顯示在 war-room 側邊面板

4. **driver 自動定位 — layout 層級啟動 + 統一 composable**：
   - 新建 `app/composables/use-driver-geolocation.ts`：模組級 singleton state，layout 啟動後整 driver 端期間 share；提供 `RequestPermission / StartWatch / StopWatch / UploadNow`
   - 上傳節流：5m 距離 + 60s 強制 force refresh + 50m accuracy filter + status 變化必傳
   - 拒絕授權 → blocking modal「司機端需要位置權限以執行任務追蹤」+「重試授權」按鈕；連續拒絕 2 次或 5 秒沒回應 → `navigateTo('/home')`
   - layout `onUnmounted` 時 `clearWatch` 防 leak

5. **driver/trip 重寫**：移除上下線按鈕（GPS 上移 layout）+ 顯示「我的任務列表」+ 30s polling + visibility 切回 refresh + 每張卡片依 status 顯示 ACTION_BY_STATUS 的主按鈕；按下時 `await driverGeo.UploadNow()` 強制上傳當前座標再 PatchOrder。

6. **drivers/available.get 改撈所有有 location 的 drivers**：不再 `where status in [online, busy]`，讓 war-room 能切 4 狀態 filter。busy driver 額外回傳 `activeOrder: { orderId, orderStatus }`（並行 query 取執行中訂單摘要）。回傳新增 `lastActiveAt` `accuracy` 欄位。

7. **war-room polish**：markerMap unmount 清理（防 leak）+ heading=null 改畫圓點（靜止司機不固定指北）+ 4 狀態 filter UI（全部/上線/任務中/離線）+ busy driver 側邊顯示 activeOrder（訂單號後 6 碼 + 中文 status）+ offline 司機 marker 灰色 opacity 0.4。

8. **passenger 端歸併 status**：upcoming 頁 `_normalizeForPassenger` 把 `en_route` 與 `arrived_pickup` 都顯示為 `in_transit`（行程中），避免乘客看到太細節的進度。

9. **driver/admin 端 i18n 多語化暫不做**：driver/trip 與 war-room hard-coded 中文，與 upcoming 多語機制不一致；列入 backlog。

**強制規範（未來開發）**：

- **訂單狀態 enum 修改 client/server/i18n 三處對齊**：新增狀態值前 grep `'pending'\|'confirmed'\|'in_transit'\|'completed'\|'cancelled'\|'en_route'\|'arrived_pickup'` 所有出現處，server `[orderId].patch.ts` VALID_STATUSES + DRIVER_NEXT_STATUS + STATUS_HISTORY_FIELD 三表同步、client TripStatus type、i18n `status.*` key 全部跟上
- **driver/passenger 端訂單 status 顯示策略不同**：driver 端看細粒度（5 狀態各自顯示），passenger 端歸併為粗粒度（pending/confirmed/in_transit/completed/cancelled）；新增中間 status 必須在 passenger 端 `_normalizeForPassenger` 對應
- **driver.status 不寫 offline**：driver 端 location.put.ts 拒絕 client 帶 'offline'；offline 由 war-room client-side 依 `lastActiveAt > 600s` 推導；新增 driver status 邏輯時，凡是「離線」概念都應走推導路線而非寫入
- **busy 觸發點**：訂單由 confirmed → en_route 時 server 自動把 driver doc status 切 busy（**不是接單時**）；completed 時 query 是否仍有「執行中」訂單（en_route/arrived_pickup/in_transit，**不含 confirmed**）→ 無則切回 online
- **client-side route middleware 對 async 狀態的等待已由 P18 hotfix v2 統一解決**：使用 `authStore.WaitForAuthResolved()` plain Promise + import.meta.server guard；新增需要等 auth 的場景沿用此 pattern，不要用 watch
- **navigator.geolocation 第一次彈框不可繞過**：W3C 強制隱私機制；本 spec 改為 layout 層級觸發（一進 driver 端就彈一次），授權後整端期間不再彈
- **watchPosition 啟動位置一致性**：driver 端只在 `app/layouts/driver.vue` onMounted 啟動 + onUnmounted clearWatch；新增 driver page **不要**自己再呼叫 `useDriverGeolocation().StartWatch()`（會 idempotent return，但語意混亂）
- **war-room marker 必須在 unmount 清理**：`for (const [, m] of markerMap) m.setMap(null); markerMap.clear()`；任何 Google Maps Marker / Polyline 等資源在 component unmount 時務必釋放，否則 SPA 切頁累積會 leak

**影響**：

- 新增：
  - `server/routes/nuxt-api/orders/assigned.get.ts`（driver 取執行中訂單）
  - `app/composables/use-driver-geolocation.ts`（統一定位 composable）
  - `openspec/changes/2026-05-09-p19-driver-trip-mission/{proposal,design,tasks}.md`
- 修改 server（3）：`orders/[orderId].patch.ts`（狀態擴充 + driver 狀態機 + busy/online 自動切 + statusHistory）、`drivers/available.get.ts`（撈全部 + activeOrder + lastActiveAt + accuracy）、`drivers/[id]/location.put.ts`（accuracy 欄位 + 拒寫 offline）
- 修改 client（4）：`app/layouts/driver.vue`（授權 flow + blocking modal）、`app/pages/driver/trip/index.vue`（重寫任務列表）、`app/pages/admin/war-room/index.vue`（polish + filter）、`app/pages/upcoming/index.vue`（_normalizeForPassenger）
- 修改 type/api（3）：`api/order/index.ts`（GetAssignedOrders）、`api/order/type.d.ts`（AssignedOrder + PatchOrderParams.orderStatus 擴充）、`api/driver/type.d.ts`（accuracy + lastActiveAt + activeOrder + UpdateLocationParams 移除 'offline'）
- firestore.rules **不變**（server 走 admin SDK bypass）
- 既有資料**不需 migration**：drivers doc 既有 `status='offline'` 在 driver 下次登入 location.put 時會自動被 server 推導為 'online'；既有訂單仍是 5 狀態（pending/confirmed/in_transit/completed/cancelled），新狀態值僅新訂單會用到

**過渡期風險**：
- driver 端首次部署後，**正在執行中的訂單**（status=in_transit）司機操作「乘客已下車」會跳 completed → 通；但若有歷史訂單卡在 confirmed 階段，driver 進 trip 頁會看到並能按「前往上車點」→ 正常推進
- war-room offline 推導 600 秒 threshold：剛部署時所有 driver lastActiveAt 都很舊 → 全部歸 offline；driver 端開啟 LIFF 後 60 秒內第一次 location.put 即會更新

**替代方案**：
- 接單即切 busy（confirmed → busy）：違反使用者「busy 從『出發』開始」需求，已捨棄
- offline 由 server cron job 寫入：增加運維成本 + Firestore 寫入頻繁，已捨棄
- watchPosition 在 page 層啟動：每次切 tab 重啟 watch + 重彈授權，已踩過坑，已捨棄
- 在既有 `orders/index.get.ts` 加 `query.assignedDriverId` 取代新增 `orders/assigned.get.ts`：endpoint 職責變混雜（owner 訂單 vs driver 任務），語意分開更清楚，已採新 endpoint
- driver/admin 端 i18n 一併補齊：本 spec 範圍已大，留待 P20 polish
- LINE LIFF 分流改 code 邏輯（讀 liff.id 對應 clientType）：使用者選擇純 LINE Console 端設定 endpoint URL（A 方案），不需 code 改

---

### 2026/05/09 — P18 stage gate hotfix v2：middleware/auth 用 store Promise 真正 await（取代 watch）

**決策類型**：Bug 修復（hotfix v1 失敗後重做）
**標題**：`store-auth.ts` 暴露 `WaitForAuthResolved()` plain Promise；`middleware/auth.ts` 改 await 該 Promise + `import.meta.server` guard

**背景**：P18 stage gate G4 重整 `/admin/orders` 後 401「未授權」收斂為 `middleware/auth.ts` 的 `if (!authResolved) return` 實際是放行而非等待。第一版 hotfix（commit 8817920）用 `watch(authResolved)` + `immediate: true` 等，但**SSR 上 `auth.client.ts` plugin 不跑 → `authResolved` 永遠 false → watch 永遠不 fire → 整站 hang 在 SSR**（front-desk 乘客頁面預設 SSR）。已 revert（commit b9938da）。

**決定**：改 `app/stores/5.store-auth.ts` 暴露：
- 私有 closure `_authResolvedPromise` + `_resolveAuthPromise`：第一次 caller 呼叫 `WaitForAuthResolved()` 時建立 Promise；`InitAuthFlow` 內所有 `authResolved.value = true` 都改用 helper `_markAuthResolved()`，同步 resolve Promise
- 公開 action `WaitForAuthResolved(): Promise<void>` 給 caller `await`

`app/middleware/auth.ts`：
- `import.meta.server` 直接 return（SSR 沿用既有「v-if loading」behavior）
- client 端 `await Promise.race([WaitForAuthResolved, 12s timeout])` — 12 秒對齊 InitAuthFlow safetyTimer，逾時也會被 safetyTimer 強制 mark resolved（雙保險）

**強制規範**：
- **任何需要等 async store state 的 client middleware / onMounted，使用 plain Promise 不用 watch**：watch 在無 active component / SSR context 行為不可靠；plain Promise 顯式且 deterministic
- **新加的 store async state 若有 caller 需要 await，沿用此 pattern**：`_xxxPromise + _markXxx()` 暴露 `WaitForXxx()` action

**影響**：修改 `app/middleware/auth.ts` + `app/stores/5.store-auth.ts`（5 處 `authResolved.value = true` → `_markAuthResolved()`）。commit `ea6d4b7`。

**替代方案**：
- 改 page onMounted 內各自 await：違反 DRY 且新加頁面易漏
- 改 `methods.ts` onRequest 內 await：line-exchange 公開 endpoint + LIFF flow 內死鎖風險
- 改 `GetFreshIdToken` 內 await：同樣死鎖風險

---

### 2026/05/09 — P18 Collection Split：drivers / admins 獨立 collection + admin 三層分權

**決策類型**：資料模型重構 / 業務邏輯擴展
**標題**：把司機營運資料與管理員權限從 `users` 拆出，新建 `drivers/{lineUid}` 與 `admins/{lineUid}` 獨立 collection；admin 細分 `super | admin | assistant` 三層權限

**背景**：
1. 所有 user 資料原本擠在 `users/{lineUid}`，driver 累程 / 訂單 / 金額、admin 分權都塞在 same doc，optional 欄位過多；
2. 司機位置寫入頻率極高（每分鐘）與 passenger 訂車、admin 改名混在同 doc 易產生寫入競爭與成本浪費；
3. P12 才剛踩過 `users` query 加 `orderBy` 觸發 composite index 的問題 — 統計欄位放 users 未來只會更慘；
4. admin 分權需求（super 撤銷其他 admin、assistant 不可全員 broadcast 等）靠 `roles[]` 一個欄位無法表達；
5. 業務即將上線，先把資料模型整治到位、避免上線後 migration 風險。

**決定**：
1. **新增 `drivers/{lineUid}`**：合併原 `drivers/{driverId}`（即時位置）+ 新增累積統計與業務設定。doc key 統一改用 lineUid（不帶 `line:` prefix），與 `users` 同 key（lookup 一次即可）。
2. **新增 `admins/{lineUid}`**：含 `level: 'super' | 'admin' | 'assistant'`、預留 `permissions` 細粒度 override、`createdBy`、稽核時戳；doc key 同樣與 users 同 key。
3. **`users.roles[]` 仍是身分認證唯一來源**：middleware/role 與 require-auth 只看 roles 判斷三端入口；level / permissions 只作 admin 端內部細粒度判斷。
4. **新增 `server/utils/require-permission.ts`**：`Permission` 列舉（`canManageAdmins / canManageDrivers / canManageOrders / canBroadcast / canViewFinance`）+ 寫死的 `LEVEL_TABLE` + `hasPermission(auth, perm)` 查表。第一版只看 level；保留 `admins.permissions` overrides 欄位給未來自訂 admin。
5. **`require-auth` 增強**：`AuthOk` 加 `level?` 與 `permissions?`；roles 含 admin 時加讀 `admins/{lineUid}` 帶回。讀失敗 / doc 不存在 → level=undefined，hasPermission 一律 false（migration 漏建會被擋）。
6. **driver/apply 同步建 `drivers/{lineUid}`**：申請時建立預設 doc（status='offline'、totalTrips=0 等），admin 核准後 driver 一登入即可開工，無 race condition。重複申請（被拒後再申請）只 merge 身分與車型欄位，保留 admin 既設 driverCategory + 歷史統計。
7. **訂單 `completed` 觸發 `drivers/{lineUid}` 統計累加**：在 `orders/[orderId].patch.ts` 內判斷「狀態剛切換為 completed」（前一狀態非 completed），對 drivers doc `FieldValue.increment` totalTrips/totalEarnings/totalDistanceKm/todayTrips/todayEarnings + lastTripAt。`assignedDriverId` 在 orders 內格式為 `line:Uxxx`，去 prefix 對應 drivers doc key。
8. **admin/users.patch 同步管理 admins doc**：`addRole='admin'` 時建 `admins/{uid}` doc 預設 level='admin'（重複 addRole 不覆寫 level）；`removeRole='admin'` 時刪 admins doc。**保護機制**：super 不可被 removeRole='admin'（前置 guard 擋住），避免最高管理員被自降後沒人能管理。
9. **新增 `admin/admins/*` endpoints**：`GET /admin/admins` 列管理員（含 level）、`PATCH /admin/admins/[uid]` 改 level（僅接受 'admin'/'assistant'，不接受 super；target=super 拒絕）。需 `canManageAdmins`。
10. **broadcast / admin/orders 套 require-permission**：broadcast 改用 `canBroadcast`、admin/orders 改用 `canManageOrders`。
11. **client store-auth 載 level**：roles 含 admin 時 client SDK 多讀 `admins/{lineUid}` 取 level（讀失敗 / rules 未部署 → null，不影響入口）；export `level` + `isSuper`。
12. **admin/settings UI 加 level 編輯**：管理員 tab + 內容區 + 撤銷按鈕全用 `v-if="authStore.isSuper"`；列表多顯示 level 徽章；非 super 行顯示「設為管理員 / 設為助理」按鈕。
13. **firestore.rules**：`drivers/{driverId}` 改名為 `drivers/{lineUid}` 並對應 `request.auth.uid == 'line:' + lineUid`；新增 `admins/{lineUid}` rules（admin 自己讀自己 / admin 讀全部，寫禁止）。
14. **driverCategory 從 users 搬到 drivers**：driver/apply 不再寫 users.driverCategory；admin/users.patch.ts 遇到 driverCategory 改寫 `drivers/{uid}.driverCategory` (merge:true)；admin/users.get 補 batch read drivers doc 取回 driverCategory（避免列表頁顯示空白）。
15. **migration 由使用者手動 Firebase Console 操作**（測試階段資料量小於 10 筆，無自動 script 必要）。所有既有 admin 預設設為 `level='super'`（避免管理員失能）；既有 driver 預設建 drivers doc 含 `driverCategory='0'` 與 0 統計欄位；users 內 driverCategory 欄位手動刪除。

**強制規範（未來開發）**：
- **新增 user-specific resource 必須先評估該角色的 collection**：例如未來新增「passenger 累積里程 / 偏好設定」應走 `passengers/{lineUid}` 或 `users.preferences` 子物件，禁止再往 `users` doc top-level 塞角色相關欄位。
- **統計類欄位必須與業務寫入端同步 increment**：訂單完成 → drivers totalTrips/totalEarnings 同步 increment；未來新增「司機評分 / 取消率」等統計欄位，必須在對應業務動作（訂單完成 / 取消）就地 increment，不要事後 batch query 重算。
- **任何 admin 端內部細粒度操作必須走 require-permission**：禁止單純檢查 `auth.roles.includes('admin')` 就放行；必須對應一個 `Permission` 列舉值並透過 `hasPermission(auth, perm)` 判斷。新加敏感操作時優先評估是否要新加 Permission（如未來「金流操作」可加 `canManageFinance`）。
- **doc key 統一不帶 `line:` prefix**：users / drivers / admins 三集合 doc key 全部用 lineUid（與 P17 userId 規範一致）；唯一例外是 Firebase Auth UID（系統強制 `line:` prefix）。orders 內 assignedDriverId 仍以 `line:Uxxx` 形式儲存（既有資料），對應 drivers doc 時去 prefix。
- **保護 super admin 的兩個面向**：(a) admin/users.patch removeRole='admin' 對 target=super 拒絕；(b) admin/admins.patch 不接受 level='super' 也不允許改 target=super 的 level。super 撤銷需手動 Firestore Console 操作（高風險動作不開 UI）。

**影響**：
- 新增：`server/utils/require-permission.ts`、`server/routes/nuxt-api/admin/admins/{index.get.ts,[uid].patch.ts}`
- 修改 server（7 個）：`require-auth.ts`、`driver/apply.post.ts`、`drivers/[id]/location.put.ts`、`drivers/[uid]/stats.get.ts`、`drivers/available.get.ts`、`orders/[orderId].patch.ts`、`admin/users/[uid].patch.ts`、`admin/users/index.get.ts`、`admin/broadcast.post.ts`、`admin/orders/index.get.ts`
- 修改 client（3 個）：`app/protocol/fetch-api/api/admin/index.ts`、`app/stores/5.store-auth.ts`、`app/pages/admin/settings/index.vue`
- 修改 rules：`firestore.rules`（drivers rules 對齊 lineUid + 新增 admins rules）
- 修改 docs：`docs/decision-log.md`（本條目）+ `docs/tasks.md`（v3.9）
- **使用者操作（Stage 10）**：依 `openspec/changes/2026-05-09-collection-split/migration.md` 在 Firebase Console 手動 migration + 部署 rules
- **過渡期風險**：production 部署 P18 改動後、migration 完成前，admin 端內部操作會 403（hasPermission 因 admins doc 不存在一律 false）— 這是 spec 設計的故意行為，迫使使用者完成 migration；admin 入口本身（roles 判斷）仍正常

**替代方案**：
- 把 admin level 寫進 `users.roles[]`（如 `roles: ['passenger', 'admin:super']`）→ 違反 single-source 原則，混雜身分與權限；已捨棄
- 自動產生 driverId / adminId（UUID）+ users 內存 driverId 欄位 → 多一層 lookup，無實際好處；已捨棄
- 保留 `drivers/{driverId}` 即時位置 + 另開 `driver_stats/{lineUid}` 統計 → 一個司機要查兩個 doc，沒實質好處；已捨棄
- 改 admin/users.patch 等多個 endpoint 各自重複 hasPermission 邏輯 → 違反 DRY 且未來新增權限要改多處；已採 `require-permission.ts` 統一 helper
- 自動 migration script → 測試階段資料量極小（< 10 筆），手動 Firebase Console 反而清楚；已捨棄
- super 撤銷由 UI 操作（按鈕）→ 高風險動作（最後一個 super 被撤銷則管理員失能），第一版禁止 UI；只能 Firebase Console；已採用

---

### 2026/05/09 — P17 乘客端完善：userId 格式統一 + 訂單取消 + polling

**決策類型**：Bug 修復 / 功能補齊
**標題**：修復 P14 引入的 `orders.userId` 格式回歸 bug；補上訂單取消功能、booking 成功後導向、列表 30s polling

**背景**：
1. **P14 後 `/orders` `/upcoming` 永遠 0 筆**：Firestore `orders.userId` 寫入時帶 `line:` prefix（來自 client `authStore.user?.uid`），但 P14 改的 `orders/index.get.ts` 改用 `auth.lineUid`（去 prefix）查 → mismatch
2. **`orders/index.post.ts` 是 P14 漏改的 IDOR**：任何登入者可代他人下單（client body 帶 lineUserId）
3. **upcoming `'in-progress'` 與 server 寫入的 `'in_transit'` 不一致**：司機接單後乘客「行程中」分頁永遠空
4. **訂單取消功能未實作**：P14 server 已支援 owner 改 status='cancelled'，但 client 沒對應 UI
5. **booking 成功後無導向行程頁**：使用者送出後不知道去哪確認狀態
6. **列表頁無 polling**：司機接單後乘客端看不到變化

**決定**：
1. **userId 格式統一為「不帶 prefix 的 LINE userId」**（與 Firestore `users/{lineUid}` document key 對齊）：
   - `server/routes/nuxt-api/orders/index.post.ts` 加 `require-auth`，強制 `userId = lineUserId = auth.lineUid`，忽略 client body 帶來的值
   - `app/protocol/fetch-api/api/order/type.d.ts` `CreateOrderParams.userId/lineUserId` 與 `GetOrderListParams.userId` 改為 optional
   - `app/pages/booking/index.vue` `CreateOrder` 不再傳 userId/lineUserId
   - `app/pages/orders/index.vue` 與 `app/pages/upcoming/index.vue` `GetOrderList` 不再傳 query.userId
2. **既有測試訂單清空**（測試階段資料無價值）：使用者手動刪除 Firestore `orders` collection 內帶 prefix 的舊資料；上線前無 production 資料 migration 必要
3. **`'in-progress'` → `'in_transit'`**：upcoming TripStatus、STATUS_TAB_KEYS、STATUS_CLS、3 個 i18n 檔（zh/en/ja）的 `status.*` 與 `upcoming.tab.*` 全部對齊
4. **訂單取消功能**：`/orders` 與 `/upcoming` 的 pending / confirmed 訂單顯示「取消訂單」按鈕；UseAsk 確認 → `PatchOrder({orderStatus:'cancelled'})` → 重 load
5. **booking 成功畫面**：原本只有「再訂一張」，補上「查看行程」主按鈕跳 `/upcoming`
6. **列表 polling**：`/orders` `/upcoming` 加 30s setInterval（與 admin / driver 端一致）+ visibility 切回時立即重 load；onUnmounted 清理 timer

**強制規範**：
- **任何寫入 user-specific 資料的 server endpoint，userId / lineUserId / ownerId 等身分欄位禁止信任 client body**：必須從 `auth.lineUid` / `auth.uid` 強制覆寫
- **格式統一**：Firestore 中所有「使用者識別欄位」（document key、order.userId、order.lineUserId、driverApplication.lineUserId）一律使用**不帶 `line:` prefix 的純 LINE userId**；唯一例外是 Firebase Auth UID（系統強制 `line:` prefix），與 Firestore 文件比對時去掉 prefix
- **狀態值常數對齊**：訂單 / 司機 / 任何 enum 在 client（TS type）+ server（Firestore 寫入）+ i18n key 三處必須完全一致；新增狀態值前先全文檢查 grep 三處
- **列表頁建議 polling**：admin / driver / passenger 對任何 Firestore 「即時變化但不易做 webhook」的資料（訂單、司機位置、應徵狀態），統一 30s setInterval + visibility 切回 refresh 模式

**影響**：
- 修改：`server/routes/nuxt-api/orders/index.post.ts`、`app/protocol/fetch-api/api/order/type.d.ts`、`app/pages/booking/index.vue`、`app/pages/orders/index.vue`、`app/pages/upcoming/index.vue`、`i18n/locales/{zh,en,ja}.js`
- **使用者操作**：手動清空 Firestore `orders` collection 內舊有測試訂單（含 `line:` prefix 的 userId）

**替代方案**：
- 改 `orders/index.get.ts` 用 `where('userId', 'in', [auth.uid, auth.lineUid])` 兼容兩種格式 → 暫時可用但永久 tech debt；已捨棄
- migration script 把既有 `orders.userId` 改成不帶 prefix → 測試資料無 migration 價值，直接清空更乾淨；已捨棄
- 訂單取消改 server-side 軟刪除（status='deleted'）→ 業務需求是讓 admin 仍能看到取消訂單統計，soft cancel + status='cancelled' 已足夠；已捨棄

---

### 2026/05/09 — P15 路由整理 + silent failure 修復（上線阻擋級）

**決策類型**：上線前清理 / 體驗修復
**標題**：`app/pages/index.vue` 重寫分流邏輯；刪除 demo 路由；6 處 silent failure 改回 error response

**背景**：P14 安全修復後，code-explorer / silent-failure-hunter 兩個 agent 全面審查，發現除安全外仍有：
1. `app/pages/index.vue` if/else 都導 `/home`，登入分流形同虛設
2. `app/pages/admin/index.vue` 導 `/admin/traffic`，但 login / driver/auth 後 admin 落點是 `/admin/orders`，不一致
3. `/demo/components` `/demo/tinymce-editor` 對外可開（無 middleware）
4. `orders/available.get.ts` + `drivers/available.get.ts` 在 Firebase env 缺失時 silent 回 200 + `[]`，UI 顯示假成功（司機看「沒訂單」、戰情室「沒司機」）
5. 多個 client 頁面 API 失敗無 status guard（`orders/index.vue`、`home/index.vue`、`admin/orders/index.vue`、`admin/settings/index.vue`），失敗時直接 `res.data ?? []` 顯示空畫面

**決定**：
1. **路由整理**：
   - `app/pages/index.vue` 改 watch authResolved + roles 分流：未登入 → `/login`，approved driver → `/driver/dashboard`，admin → `/admin/orders`，其他 → `/home`
   - `app/pages/admin/index.vue` 統一改導 `/admin/orders`
   - 刪除 `app/pages/demo/components.vue` + `tinymce-editor.vue`（openspec / docs/tasks.md 內歷史紀錄保留）
2. **使用者操作**：刪除 Vercel `NUXT_PUBLIC_TEST_MODE` env var，prod 不再顯示 MockSignIn 鈕
3. **server silent failure 修復**：
   - `orders/available.get.ts`：Firebase 未設改回 serverError（不再 silent 200）
   - `drivers/available.get.ts`：同上
   - `auth/line-exchange.post.ts:111`：既有使用者 displayName/pictureUrl 同步失敗加 `console.warn`（保持 non-fatal 但留追蹤線索）
4. **client silent failure 修復**：
   - 統一模式：`res.status.code !== 200 → console.error + ElMessage + 清空 + return`；try-finally 確保 loading reset；`Array.isArray` guard 防型別錯位
   - `admin/settings` 原 `if (res.data)` 對 `{}` 也通過會把 `{}` 賦值給 array ref，特別需要 array guard

**強制規範**：
- **任何 server endpoint 在 env 缺失時禁止 silent 200 + 預設值回傳**：必須回 serverError，避免 production 漏設 env 時 UI 看起來正常但功能癱瘓
- **任何 client `await $api.*` 後賦值 array ref，必須先 `res.status.code !== 200` 檢查 + `Array.isArray(res.data)` guard**：因 `methods.ts` `FilterRes` 在失敗時把 `data` 預設為 `{}`，直接 `as Type[]` 無法擋型別錯位
- **任何 Nuxt 路由分流頁面（`/`、`/admin`、`/login` 等）**：登入狀態判斷必須等 `authStore.authResolved`，且依 roles 分多端落點，禁止 if/else 都跳同個路徑

**影響**：
- 修改：`app/pages/index.vue`、`app/pages/admin/index.vue`（重寫）；`orders/available.get.ts`、`drivers/available.get.ts`、`auth/line-exchange.post.ts`（server）；`orders/index.vue`、`home/index.vue`、`admin/orders/index.vue`、`admin/settings/index.vue`（client）
- 刪除：`app/pages/demo/components.vue`、`app/pages/demo/tinymce-editor.vue`
- commits：`cde9af7`（路由）+ `4b19700`（silent failure）

**替代方案**：
- silent 200 在 dev 方便本地開發 → 已捨棄；若需要本地 mock 應走另一個 fallback flag，而非用「Firebase 未設」當 implicit fallback signal
- demo 頁面加 middleware 擋住 → 上線後仍是死碼，乾脆刪除；歷史紀錄保留在 openspec changelog

---

### 2026/05/09 — P14 上線安全修復：所有受保護 server endpoint 加上 require-auth guard

**決策類型**：安全性 / 上線阻擋級修復
**標題**：新建 `server/utils/require-auth.ts`，10 個 server endpoint 從「完全無身分驗證」改為「verifyIdToken + roles 檢查」；client 端改帶 Firebase ID token

**背景**：security-reviewer agent 全面審查發現 6 個 CRITICAL 漏洞，全部歸因於 server endpoint 沒做身分驗證：
1. 4 個 admin endpoint（broadcast / orders / users GET / users PATCH）無 auth，任何人可列使用者銀行帳號、把自己升 admin、broadcast 全員 LINE
2. driver/upload 與 driver/apply 接受 client 自帶 lineUserId，可偽造他人身分上傳偽證件、覆寫他人申請資料
3. orders/index.get IDOR：query.userId 從 client 帶，可讀任何人訂單
4. orders/[orderId].patch 無 auth：可改任意訂單 status 與 assignedDriverId
5. drivers/[id]/location.put 無 auth：可污染戰情室地圖
6. drivers/[uid]/stats.get IDOR：可讀他人今日收益

Firestore Rules 擋不住這些攻擊，因為 server-side 走 Admin SDK bypass rules。

**決定**：
1. **新建 `server/utils/require-auth.ts`**：
   - `getAuthFromEvent(event)`：讀 `Authorization: Bearer` → `auth.verifyIdToken()` → 回傳 `{ ok, uid, lineUid, roles, approved }`
   - 失敗時 return `{ ok: false, code: 401|500, message }`
   - `authFailResponse(fail)` 把 AuthFail 轉成標準 UnifiedResponse（呼叫方一行 `return authFailResponse(auth)`）
   - **roles 取值**：先看 custom token claims（line-exchange 已寫入），claims 缺則 fallback Firestore `users/{lineUid}.roles`
   - **approved 取值**：永遠從 Firestore 即時讀，不寫 claims，**接受每個 protected request 多一次 Firestore round trip 的成本，換取 admin 撤銷立即生效**（不等 1 小時 token TTL）
2. **每個 endpoint 套用 guard 模式**：
   - admin only：`!auth.roles.includes('admin') → forbiddenError`
   - self or admin：`!isAdmin && auth.lineUid !== body.lineUserId → forbiddenError`
   - orders/index.get：純 passenger 強制忽略 query.userId，只能讀自己；admin/driver 才能帶 query 查指定人
   - orders/[orderId].patch：owner 只能 cancel（不能改 assignedDriverId / 不能改 status 為非 cancelled）；admin/driver 任意更新
   - drivers/[id]/location.put + stats.get：caller.uid === id 或 caller.lineUid === id（兩種格式都比對）或 admin
3. **client 端帶 Firebase ID token**：
   - `app/stores/5.store-auth.ts` 新增 `GetFreshIdToken()` action：呼叫 `firebaseUser.getIdToken()`（內部自動 refresh，TTL 1 小時前重新簽）
   - `app/protocol/fetch-api/methods.ts` `onRequest` 改 async：先取 fresh idToken 帶進 Authorization header；fallback 樣板舊有 `storeSelf.apiToken`（避免破壞既有測試流程）
   - `app/protocol/fetch-api/api/driver/index.ts` `UploadDriverDocument` 直接 $fetch 不走 methods.ts，手動加 Authorization header
4. **公開 endpoint 不檢查 token**：line-exchange（用 LINE token 換 Firebase token）、weather、airport/flow、line-webhook 等維持原狀

**強制規範（未來新增 server endpoint）**：
- **任何寫入操作**（POST / PATCH / PUT / DELETE）一律先 `const auth = await getAuthFromEvent(event); if (!auth.ok) return authFailResponse(auth);`
- **任何讀取操作**只要回傳的是 user-specific 資料（訂單 / 個人資訊 / 司機資料），同上必須驗 token
- **公開 endpoint** 註記在檔案開頭（如 `// 公開端點：line-exchange 用 LINE token 換 Firebase token，故不可要求 ID token`）
- **權限判斷三條原則**：
  1. admin/* 路徑 → `roles.includes('admin')` 才放行
  2. 操作他人資料 → 必須 admin
  3. 操作自己資料 → `auth.lineUid === body.targetId` 或 `auth.uid === routeParam.id`（兩種格式 both 比對）
- **絕對禁止 client 帶 userId/lineUserId 然後 server 信任不驗證**；身分一律從 `auth.lineUid` / `auth.uid` 取得

**影響**：
- 新增：`server/utils/require-auth.ts`
- 修改 server（10 個）：admin 4 個 + driver 2 個 + orders 2 個 + drivers 2 個
- 修改 client（3 個）：methods.ts、store-auth.ts、driver/index.ts
- **MockSignIn 影響**：mock 使用者沒有真實 Firebase ID token，呼叫受保護 endpoint 會 401。`testMode` 在 prod env 必須設非 'T' 才能完全擋住 mock UI；即便對外曝光，server 也擋住關鍵操作

**替代方案**：
- 用 server middleware 在 `server/middleware/` 全域擋 → 公開 endpoint 例外清單會變動，維護成本高；改 endpoint-by-endpoint 直接 guard 反而清楚，已捨棄
- approved 寫進 custom token claims 避免 Firestore round trip → admin 撤銷後 1 小時內仍可用，可能讓被撤銷 driver 在 token TTL 內污染地圖；現方案多 1 次 read 換即時撤銷，已採用
- testMode 下 server 跳過 auth 檢查 → 形同 backdoor，正式環境風險過高；改要求 prod env 嚴格設 testMode != 'T'，已採用

---

### 2026/05/08 — P13 司機證件上傳失敗修復（storageBucket 預設 + 錯誤訊息暴露）

**決策類型**：Bug 修復 / 環境配置規範
**標題**：`useFirebaseAdmin` 預設 storageBucket 從 `.appspot.com` 改為 `.firebasestorage.app`，且支援從 public runtime config fallback 讀取；`upload.post.ts` catch 暴露 `err.message`

**背景**：實機驗證 P12 修復後測試司機申請流程，點選證件上傳時 client 顯示「上傳失敗，請稍後重試」（即 `serverError` 預設訊息）。檢查使用者實際 Firebase Storage bucket name 是 `destination-anywhere-cfd50.firebasestorage.app`（**新版 URL**），但 `server/utils/firebase-admin.ts` 預設組合 `${project_id}.appspot.com` 會去找不存在的 bucket，`blob.save()` 在 production 拋 `The specified bucket does not exist`。

Vercel 環境變數中沒有設 server-only 的 `NUXT_FIREBASE_STORAGE_BUCKET`，public 端的 `NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET` 也沒設（client Firebase init 帶的 storageBucket 是空字串）。

**Root cause**：
1. Firebase 在 2024/04 後新建專案的 default Storage bucket URL 從 `${project_id}.appspot.com` 改為 `${project_id}.firebasestorage.app`，本專案是新版
2. `firebase-admin.ts` 寫死 fallback 為舊版 URL，且只讀 server-only env var，client / server 必須設兩份 env var 才能對齊

**決定**：
1. **`server/utils/firebase-admin.ts`** 取值順序改為：
   - server-only `NUXT_FIREBASE_STORAGE_BUCKET`
   - public `NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET`（client SDK 同樣讀此值，一份共用）
   - fallback `${project_id}.firebasestorage.app`（新版預設）
   - fallback `${project_id}.appspot.com`（舊版兜底）
2. **`server/routes/nuxt-api/driver/upload.post.ts`** catch block 把 `err.message` 帶入回傳訊息（如「上傳失敗：The specified bucket does not exist」），協助定位環境配置問題；不洩漏 secret，只暴露 SDK 訊息。
3. **使用者操作**：在 Vercel 設 `NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET` = `destination-anywhere-cfd50.firebasestorage.app`（Production / Preview / Development 三個環境都勾），client / server 共用此值。

**強制規範**：
- 任何 server route 需要存取 Firebase Storage 時，**禁止寫死 fallback bucket 名稱為舊版格式**；必須同時支援新舊兩種 default bucket，且能從 `config.public.firebaseStorageBucket` fallback 讀取。
- 任何 server-side throw 的 catch block，**錯誤訊息必須包含 `err.message`**；只回 `serverError(...)` 預設「伺服器錯誤」會讓使用者面對黑盒，浪費往返定位時間。但要避免暴露 secret（檔案路徑、token、connection string），這類訊息要先 sanitize。
- 任何同時需要 client / server 取值的 Firebase 設定（如 storageBucket、projectId），**設計 env var 時優先用 `NUXT_PUBLIC_*` 一份共用**，避免使用者重複設定造成 mismatch。

**影響**：
- 修改：`server/utils/firebase-admin.ts`、`server/routes/nuxt-api/driver/upload.post.ts`
- Vercel env var：新增 `NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET`（使用者操作）
- 未來新建 Firebase 專案不必再特別設此 env var，預設 fallback 已涵蓋新版格式
- 同樣的 storageBucket 邏輯影響其他 storage 操作（如未來可能加上的訂單發票上傳、廣播圖片附件）

**替代方案**：
- 改 `firebase-admin.ts` 寫死新版 bucket name → 對舊版 Firebase 專案（2024/04 前建立）會 fail，可移植性差；已捨棄
- 在 `firebase-admin.ts` 內 try `.firebasestorage.app` 失敗再 fallback `.appspot.com` → `bucket()` 不會立刻 verify，要到實際操作才 throw，retry 邏輯複雜且耗時；已捨棄
- 直接讓 client 端用 Firebase JS SDK 上傳（繞過 server）→ 雖然使用者 storage.rules 已允許 < 5MB 直接 client write，但失去 server-side 驗證 docType / mime / 路徑的能力，且 admin 審核所需的 signed URL 仍需 server 產生；已捨棄

---

### 2026/05/08 — P12 司機端循環登入 + Admin 司機管理無限轉圈雙修

**決策類型**：Bug 修復 / 回歸防護
**標題**：還原 P6「Firebase session 優先於 LIFF」邏輯；admin/users 列表查詢避開 Firestore composite index 並補 client array guard

**背景**：實機驗證 P8 司機申請流程時回報兩個問題：
1. 司機端：點 LINE 登入後跑回乘客端首頁，且重整時又陷入 LINE 登入畫面
2. Admin 端：`/admin/drivers` 進入後 spinner 永遠不消失

逐一定位後確認兩個問題各有獨立 root cause，但都是回歸：

**問題 1 root cause（重要）**：
- `f35e01f`（2026/05/02）原本加在 `_InitLiffFlow` 的 P6 修復「Firebase session 有效時跳過 `liff.login()`」**在 P10/P11 多次重構中被誤刪**（由 commit 鏈 `35e9355` → `2100449` → `79ab914` 漸進式改寫，過程中 currentUser 檢查的早期 return 沒有保留）
- 結果：LIFF token 比 Firebase custom token 短，LIFF 過期時不論 Firebase session 是否仍有效，都會強制 `liff.login()` 跳轉 LINE 認證頁
- LIFF redirect 完成後把使用者送回 LIFF App 設定的 endpoint URL（乘客端首頁 `/`），現象與「司機端登入後被導回乘客端」一致

**問題 2 root cause**：
- `server/routes/nuxt-api/admin/users/index.get.ts` 用 `where('roles', 'array-contains', role).orderBy('createdAt', 'desc')` 是複合查詢，Firestore 需要建 composite index 才能執行，沒建會 throw `FAILED_PRECONDITION`
- server 雖 catch 後回 500，但 `app/protocol/fetch-api/methods.ts` `FilterRes` 預設 `data: {}`（非 array），`admin/drivers/index.vue` 直接 `drivers.value = res.data ?? []` 讓 `drivers.value` 變成 `{}`
- 接著 `filteredDrivers` computed 對 `{}` 跑 `.filter()` throw TypeError，render 失敗 → spinner 卡住、loading 永遠不會被 reset

**決定**：
1. **還原 P6 邏輯**：在 `app/stores/5.store-auth.ts` `_InitLiffFlow` 的 `if (!liff.isLoggedIn())` 之前加回 Firebase `currentUser` 檢查；若 currentUser 存在則 `liffReady=true` + return，跳過 `liff.login()`。同時把後段 `signInWithCustomToken` 重複的 `getAuth` import 拿掉避免 lint 重複宣告。
2. **避開 composite index**：`admin/users/index.get.ts` 移除 `.orderBy('createdAt', 'desc')`，改在 server 端 map 完後 in-memory sort（`users` 集合資料量上限約 100 筆，記憶體排序成本可忽略）。避免使用者額外去 Firebase Console 建 index。
3. **Client 防禦**：`admin/drivers/index.vue` `ApiLoadDrivers` 加 try-finally + `Array.isArray(res.data)` guard。`finally` 保證 `loading` 一定 reset；guard 確保 `drivers.value` 永遠是 array，避免 `.filter()` throw。

**強制規範（避免再次回歸）**：
- 任何 `_InitLiffFlow` 的重構，**都必須保留 Firebase currentUser 檢查的早期 return**。重構前先 grep `currentUser` 確認此邏輯仍在；commit 前手動驗收「LIFF token 過期但 Firebase 仍有 session」情境（可在 DevTools Application 把 LIFF cookies 清掉但保留 Firebase IndexedDB 模擬）。
- 任何 Firestore 集合查詢加 `orderBy` 之前，先確認是否與 `where`/`array-contains` 形成複合查詢。複合查詢需要 composite index；除非已部署 `firestore.indexes.json`，否則優先 in-memory sort。
- 任何 `await $api.*` 的呼叫端，都應該對 `res.data` 做 `Array.isArray` 或型別 guard，因為 `methods.ts` `FilterRes` 在 server 失敗時把 `data` 預設為 `{}`，呼叫端直接 `as Type[]` 無法擋住型別錯位。

**影響**：
- 修改：`app/stores/5.store-auth.ts`、`server/routes/nuxt-api/admin/users/index.get.ts`、`app/pages/admin/drivers/index.vue`
- 不影響：firestore.rules、storage.rules、其他 server route

**替代方案**：
- 問題 2 改建 composite index → 需使用者額外到 Firebase Console 部署，且未來新增其他 role 篩選都要重複這個成本；in-memory sort 在資料量小時更務實，已採用
- 問題 2 改 client 端做 `where + sort` → admin 端要負擔過多邏輯且仍需處理 array guard，同時保留 server-side guard 才完整；已採用
- 問題 1 改成所有頁面都先檢查 isSignIn 才 mount → 修改面太大且不能解決根本（LIFF flow 內部仍會 `liff.login()`）；已捨棄

---

### 2026/05/07~08 — P10 production debug：Firebase Admin 初始化三大踩雷點（必讀）

**決策類型**：基礎架構 / 重大踩雷紀錄
**標題**：line-exchange 在 Vercel production 上連續出現三層失敗，最終定位為 Nuxt runtimeConfig 與 firebase-admin 互動的三個未知行為
**背景**：P10 roles[] 多角色遷移合併後，實機驗證發現乘客端 ADMIN 鈕永遠不顯示、司機端登入循環、訂單 silent failure（API 回 200 但 Firestore 沒寫入）。經 11 個 commits 漸進加 debug log 才完整鎖定，期間使用者實機跑了 8 次以上才修通。**未來新增任何用 firebase-admin 的 server route 都必須遵守這份紀錄**。

**踩雷點 1：Nuxt runtimeConfig 用 destr 自動把合法 JSON 字串 parse 成 object**

- 現象：`config.firebaseServiceAccountJson` 在 server 端**已是 object 不是 string**
- 原因：Nuxt 4 內部用 [destr](https://github.com/unjs/destr) 處理 env vars，偵測到 `{` 開頭會自動 `JSON.parse`
- 錯誤訊息：`SyntaxError: "[object Object]" is not valid JSON`（因為對 object 再 `JSON.parse()` 會先 toString 變 `"[object Object]"`）
- 修復：`useFirebaseAdmin` 改成接受 `string | object`，是 object 就跳過 `JSON.parse`

**踩雷點 2：Nuxt defu deep merge 把 object frozen，firebase-admin SDK 試圖 mutate 失敗**

- 現象：cert(sa) + initializeApp 表面成功，但實際 fetch OAuth2 token 時失敗
- 原因：runtimeConfig 經過 `defu` deep merge 後物件變成 read-only。Firebase Admin SDK 內部會試圖規範化 service account 欄位（mutate `project_id` 等），對 frozen object 寫入 throw
- 錯誤訊息：`Cannot assign to read only property 'project_id' of object '#<Object>'`，errorInfo.code: `app/invalid-credential`
- 修復：在 `cert()` 之前先 `JSON.parse(JSON.stringify(serviceAccount))` 深拷貝一份普通可寫 object

**踩雷點 3：line-exchange isNewUser 路徑 `.set()` 直接覆寫，把手動設的 roles 清掉**

- 現象：使用者手動在 Firestore 設定的 `roles: ['passenger', 'driver', 'admin']` 被改回 `['passenger']`
- 原因：前面踩雷點 1+2 連續失敗 → Firebase Auth 從未建成功此 uid → `auth.getUser(uid)` 失敗 → `isNewUser=true` → 走 `db.collection('users').doc(...).set({ roles: ['passenger'], ... })` **直接覆寫**
- 觸發條件：Firebase Auth user 不存在 + Firestore 文件已存在（兩端不同步）。常見於 admin 手動預先在 Firestore 加白名單但使用者尚未走過 line-exchange 流程
- 修復：isNewUser 路徑先檢查 Firestore 文件是否已存在；存在則只 merge LINE profile（lineUserId / displayName / pictureUrl），絕不動 roles / approved / driverApplication

**強制規範（未來開發）**：
- 任何用 `useRuntimeConfig()` 取得**JSON 結構**的 secret，type 都要當作 `string | object` 處理
- 任何用 `firebase-admin` 的 server route，service account 必須走 `useFirebaseAdmin()`（已內建深拷貝 + 必填欄位驗證 + private_key PEM 格式驗證）
- 任何同步 Firebase Auth ↔ Firestore 的 endpoint，**禁止用 `.set()` 直接寫使用者文件**，必須用 `.set({...}, { merge: true })` 或先 `.get()` 檢查存在性
- 任何 server-side 失敗都要 `console.error` 而非 silent，方便 Vercel runtime logs 定位（Vercel logs 對 console.error 級別最可靠）

**影響**：
- 修改：`server/utils/firebase-admin.ts`（核心修復，三層保護）、`server/routes/nuxt-api/auth/line-exchange.post.ts`（merge 不覆寫 + 全 handler wrap try-catch + 各步驟 console.error）
- 涉及 commits：`535926e` → `048f027`（11 個 commits 的漸進除錯過程）
- 同樣的修復也保護其他用 `useFirebaseAdmin` 的 server route：訂單建立、admin/users CRUD、admin/broadcast、driver apply 等

**替代方案**：
- 把 service account 拆成多個 env var（type / project_id / private_key 等獨立）→ 增加維護成本，且 destr 仍會對個別欄位 type-coerce；已捨棄
- 不用 Nuxt runtimeConfig，改用 `process.env` 直讀 → 失去 type safety，且 server-side 仍可能遇到 destr；已捨棄
- 換 `firebase-rest-api` 不用 admin SDK → 工程量大，已捨棄

---

### 2026/05/07 — 身分模型由單一 role 改為 roles[] 陣列（多角色支援）

**決策類型**：資料模型重構 / 業務邏輯
**標題**：Firestore `users/{uid}.role: string` 改為 `roles: Role[]`，支援單一使用者同時具 passenger / driver / admin 多重身分
**背景**：原本單一 role 互斥模型造成多項 UX 問題：
- admin 永遠看不到 ADMIN 跳轉鈕（因為 admin 沒有「乘客 / 司機」身分可進入相應路由）
- admin / approved driver 無法在乘客端訂車（middleware 強制把 admin 導 `/admin/traffic`、approved driver 導 `/driver/dashboard`）
- 實務上，admin 可能也是 driver / passenger，driver 也可能會自己訂車，單一身分過於僵硬

**決定**：
- **Firestore schema**：`users/{lineUid}.role: string` → `users/{lineUid}.roles: ('passenger' | 'driver' | 'admin')[]`
  - 所有使用者最少含 `'passenger'`（passenger 是基礎身分，無法被移除）
  - admin 加白名單：`arrayUnion('admin')`，移除：`arrayRemove('admin')`
  - driver 申請通過：`arrayUnion('driver')` + `approved=true`
  - `approved: boolean` 維持獨立欄位，**僅作為 driver 核准旗標**（passenger / admin 永遠視為 true）
- **Store**：`role: ref<Role|null>` → `roles: ref<Role[]>`，新增 computed：`isAdmin`、`isDriver`、`isPassenger`、`isApprovedDriver`
- **Middleware/role.ts**：
  - admin 路徑：`roles.includes('admin')` 才放行
  - driver 路徑：`roles.includes('driver') && approved` 才放行
  - **乘客路徑：所有已登入使用者皆可進入**（移除「admin / approved driver 不得進入乘客路由」的兩條 redirect）
- **CommonHeaderUser**：admin 在乘客/司機端顯示「ADMIN」鈕、approved driver 在乘客/admin 端顯示「DRIVER」鈕，提供雙向切換入口
- **Admin API `PATCH /nuxt-api/admin/users/[uid]`** 改為 `addRole` / `removeRole` 語意：
  - `addRole: 'admin'` → arrayUnion；`removeRole: 'admin'` → arrayRemove
  - **禁止 `removeRole: 'passenger'`**（passenger 是基礎身分）
  - `approved` 維持獨立操作（核准/停用 driver）
- **Admin API `GET /nuxt-api/admin/users`** server 端改用 `where('roles', 'array-contains', query.role)` 篩選；query 介面不變
- **broadcast.post.ts** 推播鎖定 role 同改 array-contains
- **既有資料遷移**：手動於 Firebase Console 對既有 1 位使用者改為 `roles: ['passenger', 'driver', 'admin']`（無自動遷移 script）

**影響**：
- 修改：`server/routes/nuxt-api/auth/line-exchange.post.ts`、`server/routes/nuxt-api/admin/users/{index.get.ts,[uid].patch.ts}`、`server/routes/nuxt-api/admin/broadcast.post.ts`、`app/protocol/fetch-api/api/admin/index.ts`、`app/stores/5.store-auth.ts`、`app/middleware/role.ts`、`app/components/common/CommonHeaderUser.vue`、`app/pages/{login,driver/auth,driver/register,admin/settings}/index.vue`
- 移除：StoreAuth.SetRole action（無人使用）
- 變更語意：`MockSignIn` 從接 `Role` 改為接 `Role[]`，admin/driver mock 同時帶 passenger 模擬實際多身分
- docs：`docs/api-contracts.md` 對齊新 schema

**替代方案**：
- 維持單一 role + 多端切換用 query 參數 → admin 仍無法訂車，未解決根本問題；已捨棄
- 加 `secondaryRoles` 欄位 → 複雜度高且資料分散；已捨棄
- 完全用 RBAC（permission-based）→ 過度設計，目前 3 種身分用 array 即可；已捨棄

---

### 2026/05/06 — 司機申請流程重新設計：/driver/register + 圖片上傳 + 1 天冷卻

**決策類型**：業務流程 / 新增功能
**標題**：未註冊或未核准司機統一導向 `/driver/register`，提供完整申請表單與審核狀態顯示；被拒絕者 1 天內不可重新申請
**背景**：原規格中，未核准 driver / 一般 passenger 進入 `/driver/auth` 完成 LINE 登入後，會被 `middleware/role.ts` 一律導至乘客端首頁 `/`，使用者無法得知申請狀態，也無「申請司機」的入口；同時 `line-exchange.post.ts` 因 `clientType=driver` 直接把新使用者寫成 `role: 'driver', approved: false`，違反「先申請後審核」的業務邏輯。
**決定**：
- **新增** `/driver/register` 頁面，依 store 狀態渲染三種模式：
  - `role=passenger / null` → 顯示完整申請表單
  - `role=driver, approved=false` 且未被拒絕 → 顯示「審核中」提示
  - `role=driver, approved=false` 且 `rejectedAt` 在 1 天內 → 顯示「冷卻中」剩餘時間
- **修** `line-exchange.post.ts`：新使用者一律建立為 `role: 'passenger'`（不再因 `clientType=driver` 自動寫 driver 身分）
- **修** `pages/driver/auth/index.vue` 導向邏輯為四分支：
  - `driver + approved` → `/driver/dashboard`
  - `driver + !approved` → `/driver/register`
  - `passenger / null` → `/driver/register`
  - `admin` → `/admin/orders`
- **修** `middleware/role.ts`：`/driver/register` 路徑放行（passenger 與未核准 driver 都可進入）
- **新增** API `POST /nuxt-api/driver/apply` 收申請資料（含圖片 URL）寫入 Firestore `users/{uid}.driverApplication`，並把 `role` 改為 `driver`、`approved=false`
- **新增** API `POST /nuxt-api/driver/upload`，將檔案推送至 Firebase Storage `drivers/{uid}/{docType}-{timestamp}.{ext}` 並回傳下載 URL
- **修** `admin/drivers/index.vue` 加入「待審核 / 已核准 / 已拒絕」三個分頁，可展開檢視申請資料與圖片，可拒絕（寫入 `rejectedAt`）並可手動解除冷卻（清空 `rejectedAt`）
- **新增 Firestore 欄位**（位於 `users/{lineUid}`）：
  - `driverCategory: string`（預設 `'0'`，admin 可調整為搶單排序權重）
  - `driverApplication: { driverName, phone, plateNumber, vehicleType, bankCode, bankAccount, documents: { licenseUrl, registrationUrl, insuranceUrl, goodCitizenUrl }, appliedAt, reviewedAt, reviewedBy, rejectedAt, rejectReason }`
- **冷卻機制**：被拒絕後 24 小時內 `apply` API 拒絕新提交（回傳 `403`），admin 可在 `/admin/drivers` 點「解除冷卻」立即清空 `rejectedAt`

**影響**：
- 新增：`app/pages/driver/register/index.vue`、`server/routes/nuxt-api/driver/apply.post.ts`、`server/routes/nuxt-api/driver/upload.post.ts`、`app/components/driver/RegisterUploadField.vue`
- 修改：`server/routes/nuxt-api/auth/line-exchange.post.ts`、`app/pages/driver/auth/index.vue`、`app/middleware/role.ts`、`app/stores/5.store-auth.ts`（補讀 `driverApplication`）、`app/pages/admin/drivers/index.vue`
- Firebase Storage Rules 與 Firestore Rules 需新增 `drivers/*` 與 `users.driverApplication` 的存取規則

**替代方案**：
- 司機申請仍走 admin 直接 Firestore 修改 → 使用者無自助申請體驗，已捨棄
- 不做冷卻 → 被拒絕的人可重複轟炸申請，已捨棄
- 圖片直接 base64 存 Firestore → 文件大小限制 1MB 不可行，已捨棄

---

### 2026/05/06 — Admin 端改回走 LINE LIFF + Firestore 白名單（推翻 2026/05/02 決策）

**決策類型**：Auth 架構修正
**標題**：Admin 端不再「跳過 LIFF」，與乘客 / 司機端同樣走 LINE LIFF 流程，由 Firestore `users/{uid}.role === 'admin'` 作為白名單依據
**背景**：2026/05/02 為解決 LIFF session 過期導致 admin 進不去的問題，採用「admin 路徑跳過 LIFF」策略。但此策略意味著 admin 無 LINE 身分綁定，無法顯示 LINE 頭像 / 名稱，也無法以單一 LINE 帳號統一三端登入。本次需求要求三端 Header 都能顯示登入者頭像，需重新走通 admin LIFF。
**決定**：
- 移除 `_InitLiffFlow` 中的 `if (route.path.startsWith('/admin')) { liffReady=true; return; }`
- Admin 端改與乘客端相同：走 `lineLiffIdPassenger`（LIFF App 不需區分；passenger LIFF 可承載任意角色）
- Firestore `users/{lineUid}.role` 為單一身分來源，admin 必須由現有 admin 在 `/admin/settings` 或 Firebase Console 手動設為 `role: 'admin', approved: true`
- 解決 2026/05/02 的 LIFF session 過期問題改沿用同日另一決策：「Firebase session 優先於 LIFF」— admin Firebase session 存活期間不會被 LIFF 強制跳轉
- Header 頭像顯示邏輯：admin role 與其他 role 共用同一份 `lineProfile` 來源

**影響**：
- 修改：`app/stores/5.store-auth.ts`（移除 admin 早期 return）
- 廢止：2026/05/02 決策「Admin 端跳過 LIFF」標記為 `[OBSOLETE]`，本決策取代
- 既有 admin 帳號：須確認 Firestore `users/{lineUid}` 文件存在且 `role: 'admin'`；首位 admin 設定方式不變（Firebase Console 手動建立）

**替代方案**：
- 為 admin 建立獨立 LIFF App → 成本高，已捨棄
- 維持 admin 不顯示頭像 → 違反本次 UX 一致性需求，已捨棄

---

### 2026/05/06 — 三端 Header 統一顯示 LINE 頭像 + 名稱（含 admin 跳轉鈕）

**決策類型**：UI / UX 統一
**標題**：乘客 / 司機 / Admin 三端 Layout Header 右側統一顯示圓形 LINE 頭像 + displayName，點擊跳轉至各端 profile 頁；若使用者具 admin 權限，於頭像左側顯示「ADMIN」按鈕跳轉至 `/admin/orders`
**背景**：原三端 Layout Header 無使用者識別資訊，使用者無法一目了然當前登入狀態；同時乘客端 Header 的「訂單」「預約」按鈕功能與底部 Tab Bar 重複。
**決定**：
- 三端 Header 右側統一加入：
  - 圓形頭像（尺寸 `clamp(28px, 8vw, 36px)` 適配 56px header 高度）
  - displayName 文字（小於 768px 視窗隱藏，僅顯示頭像）
  - i18n 語系切換（保留既有 `LangSwitcher`）
  - 點擊頭像 → 各端 profile 頁（乘客 `/profile`、司機 `/driver/profile`、admin 暫無 profile 頁，先導向 `/admin/orders`）
- **乘客端 Header 簡化**：移除「訂單」「預約」按鈕（與底部 Tab Bar 的「訂單」「+ 預約」重複）
- **Admin 跳轉鈕**：當 `role === 'admin'` 時，於頭像左側顯示「ADMIN」按鈕（紅底 amber 文字），點擊跳轉 `/admin/orders`；非 admin 使用者不顯示
- 抽出共用元件 `app/components/common/CommonHeaderUser.vue`（接 `lineProfile` + `role` props，三端 layout 共用）

**影響**：
- 新增：`app/components/common/CommonHeaderUser.vue`
- 修改：`app/layouts/front-desk.vue`、`app/layouts/driver.vue`、`app/layouts/back-desk.vue`
- 移除：乘客端 Header 的「訂單」「預約」按鈕（i18n key `nav.orders`、`nav.book` 仍保留供其他頁面使用）

**替代方案**：
- 在每個 layout 各自實作 → 三份重複程式碼，已捨棄
- 用 Pinia getter 直接讀 store → 仍需傳 props 給元件以利測試與重用，已捨棄

---

### 2026/05/06 — Pinia setup store 解構統一改用 storeToRefs

**決策類型**：技術修復
**標題**：禁止從 Pinia setup store 直接解構 reactive state；統一改用 `storeToRefs()` 包裹，actions 維持直接解構
**背景**：實機測試發現 admin 端在特定 Chrome 主 profile + 快取時序下出現「無限 loading」、`/profile` 個人卡永遠空白、`/driver/auth` 登入後不會自動導向、訂單頁 API 永遠不打等多個症狀；經 console 驗證 Pinia store 內 `authResolved=true`，但 layout v-if="!authResolved" 仍顯示 → 確認為「直接解構 setup store ref 失去 reactivity」共通根因。
**決定**：
- 修復模式：
  ```ts
  // 錯誤
  const { authResolved, lineProfile, SignOut } = StoreAuth();
  // 正確
  const authStore = StoreAuth();
  const { authResolved, lineProfile } = storeToRefs(authStore);
  const { SignOut } = authStore;  // actions 維持直接解構
  ```
- middleware 內的解構（`auth.ts`、`role.ts`）保持原寫法 — middleware 每次路由切換重新呼叫，無 reactivity 需求
- `front-desk.vue` 早已使用 `storeToRefs`，本次修復其他 8 個檔案並對齊
- 將此 pattern 加入 [docs/naming-conventions.md](naming-conventions.md) 與 `.claude/knowledge/frontend-conventions.md` 作為長期規範

**影響**：
- Commits `e6bc8d6`（admin layout）、`1490725`（其餘 7 檔）已套用此修復
- 修改檔案：`app/layouts/back-desk.vue`、`app/layouts/driver.vue`、`app/pages/profile/index.vue`、`app/pages/driver/profile/index.vue`、`app/pages/driver/auth/index.vue`、`app/pages/login/index.vue`、`app/pages/orders/index.vue`、`app/pages/driver/pending/index.vue`、`app/pages/home/index.vue`

**替代方案**：
- 改用 Options Store（不使用 setup store）→ 影響範圍過大，已捨棄
- 全部改用 store proxy 訪問（`store.x.y` 不解構） → 增加 verbose，已捨棄

---

### 2026/05/02 — Firebase session 優先於 LIFF，避免 LIFF 過期觸發強制跳轉

**決策類型**：Auth 架構修復  
**標題**：`_InitLiffFlow` 中將 Firebase `currentUser` 檢查移至 `liff.isLoggedIn()` 之前  
**背景**：LIFF session 與 Firebase session 是獨立的，且 LIFF session 有效期較短。原本邏輯先檢查 `liff.isLoggedIn()`，為 false 時直接呼叫 `liff.login()` 強制跳轉 LINE 登入；但 Firebase session 此時可能仍有效，導致 driver / passenger 在 LIFF session 過期後被不必要地踢出。  
**決定**：在 `liff.init()` 之後、`liff.isLoggedIn()` 之前，先取得 Firebase `currentUser`。若 currentUser 存在，直接 `liffReady=true` 並 return，跳過所有 LIFF 登入邏輯。  
**影響**：`app/stores/5.store-auth.ts`（`_InitLiffFlow`）；driver 與 passenger 端受益  
**替代方案**：延長 LIFF session → 非程式碼可控；每次進入頁面先刷新 token → 增加複雜度，已捨棄

---

### 2026/05/02 — Admin 端跳過 LIFF，採純 Firebase session 驗證 [OBSOLETE 2026/05/06]

> ⚠️ **本決策已被 2026/05/06「Admin 端改回走 LINE LIFF + Firestore 白名單」取代。** 保留此紀錄供歷史追溯。

**決策類型**：Auth 架構  
**標題**：`/admin` 路徑在 `_InitLiffFlow` 早期 return，不走 LINE LIFF 流程  
**背景**：Admin 端是後台管理介面，不需要 LINE LIFF 的功能（無 LINE 分享、無好友查詢）。原本 admin 路徑因 `isDriverPath=false` 而走 `lineLiffIdPassenger` LIFF 流程，導致 LIFF session 過期時觸發 `liff.login()` 強制跳轉，造成 admin 頁面間歇性無法進入（即使 Firebase session 有效）。  
**決定**：在 `_InitLiffFlow` 開頭加入 `if (route.path.startsWith('/admin')) { liffReady.value = true; return; }`，admin 端完全由 Firebase session 控制存取。  
**影響**：`app/stores/5.store-auth.ts`（`_InitLiffFlow`）  
**替代方案**：為 admin 建立獨立 LIFF App → 成本高且無實際需求；已捨棄

---

### 2026/05/02 — 機場人流儲存從 Firestore 改為 GitHub Gist

**決策類型**：基礎架構 / 外部整合  
**標題**：n8n 爬取桃園機場 XLS 後，改寫入 GitHub Gist（每日一個 JSON 檔），取代 Firestore `airport_flow_forecast`  
**背景**：原本以 Firestore 儲存人流預報資料，但 n8n → Firestore 的 API 認證需要 Service Account；而前端讀取 Firestore 需要 Firebase SDK，增加 bundle 體積。Gist 提供無認證的公開 raw URL，n8n 使用 GitHub PAT 即可 PATCH 更新。  
**決定**：
- n8n PATCH `https://api.github.com/gists/{gistId}`，每個日期一個 JSON 檔（`airport-YYYY-MM-DD.json`）
- Nuxt server `GET /api/airport/flow` 直接 fetch Gist raw URL（`responseType: 'text'` + 手動 JSON.parse，繞過 GitHub CDN 回傳 `text/plain` 的問題）
- hours 格式升級：每小時存 arrival / departure / all 三筆，前端篩選方向時有真實數據
- Gist 自動清理：每次 n8n 執行後 PATCH null 刪除 8~60 天前的日期檔
- n8n 排程改為每小時，同時處理今日與明日，下載失敗優雅跳過

**影響**：`server/api/airport/flow.get.ts`、`n8n-workflow-taoyuan-xls.json`、`app/pages/admin/traffic/index.vue`；移除 Firestore `airport_flow_forecast` 集合依賴  
**替代方案**：Firestore → 需 Service Account 憑證管理；Supabase Storage → 額外帳號；已捨棄

---

### 2026/04/30 — i18n 採用 @nuxtjs/i18n v10 + prefix_except_default 策略

**決策類型**：技術選型 / 架構  
**標題**：乘客端三語系（zh / en / ja）採用 `@nuxtjs/i18n` v10.2.4，預設語系（zh）不加 URL 前綴  
**背景**：Stage 6 目標之一為支援多語系，需選定 i18n 方案並決定 URL 策略。原有程式碼含大量硬編碼繁體中文（經 grep 統計乘客端頁面約 300+ 行、組件層約 468 行）。  
**決定**：
- 安裝 `@nuxtjs/i18n` v10.2.4（Nuxt 4 相容版），`langDir: 'locales'`，翻譯檔置於 `i18n/locales/{zh,en,ja}.js`
- strategy `prefix_except_default`：預設語系（zh）路由不加前綴（`/booking`），en/ja 加前綴（`/en/booking`、`/ja/booking`）
- 分兩層修復：Layer 1 核心頁面（home/booking/upcoming/fleet）→ Layer 2 乘客組件（7 個 passenger 組件）
- 翻譯鍵採階層命名：`booking.step.*`、`booking.type.*`、`booking.route.*`、`booking.confirm.*`、`map.*`、`ui.*`、`fleet.extras.*`（跨頁共用）

**影響**：`i18n/locales/zh.js`、`en.js`、`ja.js`；所有乘客端 `.vue` 頁面與組件；`nuxt.config.ts`  
**替代方案**：`vue-i18n` 單獨使用（不走 Nuxt module）→ 失去自動路由前綴、語系偵測；已捨棄

---

### 2026/04/29 — 首頁統計列改為 Split-flap Display（機場告示牌效果）

**決策類型**：UI / 視覺設計  
**標題**：首頁統計列動畫從 CSS `flip-in` 跑馬燈改為完整機場翻牌效果（Split-flap Display）  
**背景**：舊有跑馬燈實作（`FLIP_CHARS` 隨機字元 + `flip-in` keyframe）在數字切換時無法呈現真實機場告示牌的逐字翻牌感，且只能翻一次。  
**決定**：
- 新增 `SplitFlapChar.vue`：單字元翻牌組件，內含 4 層結構（static-top / flap-upper / flap-lower / static-bottom），使用 CSS `perspective` + `backface-visibility: hidden` + `rotateX()` 動畫，`v-if="isFlipping"` 每次翻牌觸發 DOM 重建以重播 CSS animation
- 新增 `SplitFlapBoard.vue`：字串容器，`charDelay` prop 控制 stagger 效果（預設 60ms）
- 隨機字元循環（`cycles` 次）後落地目標字元，增強機械感
- 統計數字初始值為等長空白字串，`setTimeout` stagger 後依序設入目標值

**影響**：`app/components/SplitFlapChar.vue`（新增）、`app/components/SplitFlapBoard.vue`（新增）、`app/pages/home/index.vue`（移除舊跑馬燈邏輯）  
**替代方案**：`canvas` 繪製 / 第三方 split-flap 套件 → 綁定外部依賴，已捨棄；純 JS setInterval 更新文字 → 無法呈現物理翻牌分層視覺，已捨棄

---

### 2026/04/28 — `.client.vue` 封裝瀏覽器專用套件

**決策類型**：架構規範  
**標題**：`chart.js`、Google Maps SDK 等 browser-only 套件一律封裝為 `.client.vue` 元件  
**背景**：Vercel 部署時 Rollup 靜態分析 chart.js ESM export map 失敗（`Cannot find module 'chart.js'`），嘗試過 `vite.ssr.external`、`build.transpile`、`@vite-ignore` 均無效。根本原因是 pnpm-lock.yaml 缺少 chart.js 條目（需同步提交），加上 SSR bundle 仍會嘗試解析 import。  
**決定**：凡瀏覽器專用套件的使用元件，檔名後綴改為 `.client.vue`（例：`TrafficChart.client.vue`），Nuxt 自動將其完全排除於 SSR build 之外。  
**影響**：`app/components/admin/TrafficChart.client.vue`；往後所有 chart.js / canvas / WebGL 元件均遵循此規則  
**替代方案**：dynamic import + `@vite-ignore` → 只壓制 warning，不解決 Rollup resolution；已捨棄

---

### 2026/04/28 — ElDatePicker 日期限制使用 `:disabled-date`

**決策類型**：Element Plus 使用規範  
**標題**：`ElDatePicker` 禁止使用 `:min`，改用 `:disabled-date` callback 限制可選日期  
**背景**：`:min` 是 `el-input-number` 的 prop，在 `el-date-picker` 上完全無效，導致乘客可選到昨天甚至更早的日期。  
**決定**：  
```ts
const disabledDate = (d: Date) => $dayjs(d).isBefore($dayjs().startOf('day'))
```
傳入 `:disabled-date="disabledDate"`，可精確禁用今天以前的所有日期。  
過去時間（今天已過的時段）則在 `canNext` computed 中加 `isPastDateTime` guard + UI 錯誤提示。  
**影響**：`app/components/passenger/BookingStepType.vue`  
**替代方案**：`:min` prop → 無效，已捨棄

---

### 2026/04/28 — LINE Bot 推播採用 fire-and-forget 模式

**決策類型**：後端架構  
**標題**：訂單建立後的 LINE 推播不阻塞 API 回應，失敗靜默 log  
**背景**：LINE Messaging API 推播偶爾因網路或 token 過期失敗，不應因此讓訂單建立的 POST API 回傳 500。  
**決定**：在 `server/utils/line-push.ts` 封裝推播邏輯，內部 `.catch()` 攔截錯誤僅 `console.error`，呼叫方不需 await 回傳值；訂單寫入 Firestore 成功後即刻回傳 201，推播在背景非同步執行。  
**影響**：`server/utils/line-push.ts`、`server/routes/nuxt-api/orders/index.post.ts`  
**替代方案**：await 推播結果 → 推播失敗會讓訂單建立失敗，體驗極差；已捨棄

---

### 2026/04/28 — 航空 API 採用 BFF Mock 模式（server/api/flight.get.ts）

**決策類型**：外部 API 整合  
**標題**：航班查詢以 Mock 資料在 BFF 層實作，格式完全對齊 Aviation Edge API  
**背景**：Aviation Edge 為付費 API，MVP 階段不申請帳號；但訂車流程中的接機/送機需要航廈資訊與預計起降時間。  
**決定**：
- 建立 `server/api/flight.get.ts`，內建 12 組模擬航班（CI/BR/JL/CX）
- 回傳格式對齊 Aviation Edge：`flightNo`、`airline`、`terminal`、`scheduledTime`、`estimatedTime`、`status`、`direction`
- 時間動態計算（`Date.now() + offsetMinutes * 60000`），送機航班基礎偏移 +25h 確保符合「起飛時間 ≥ 用車時間 +3h」驗證
- 正式上線時只需替換 handler 為 Aviation Edge HTTP 呼叫，介面不變

**影響**：`server/api/flight.get.ts`、`app/components/passenger/BookingStepType.vue`、`app/pages/booking/index.vue`  
**替代方案**：直接串接 Aviation Edge → MVP 不需實際資料，成本與複雜度過高；已捨棄

---

### 2026/04/27 — Google Maps 雙 Key + BFF 代理架構

**決策類型**：安全性 / 架構  
**標題**：Maps API 全程走 BFF（Nitro），前端僅使用 Browser Key 渲染地圖畫布  
**背景**：Google Maps 有兩種金鑰用途：Server Key（無限制 IP，用於後端 API 呼叫）和 Browser Key（限制 HTTP Referrer，用於 Maps JS 渲染）。  
**決定**：
- `NUXT_GOOGLE_MAPS_API_KEY`（Server Key）：僅 BFF endpoints 使用，包含 autocomplete / place-details / reverse-geocode / distance
- `NUXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`（Browser Key）：僅 MapRoutePreview.vue 用於載入 Maps JavaScript API 並渲染地圖畫布
- 台灣本島地理圍欄驗證同時在 server-side（place-details / reverse-geocode BFF）和 client-side（UI 提示）執行，形成雙層防護

**影響**：`server/api/maps/autocomplete.get.ts`、`place-details.get.ts`、`reverse-geocode.get.ts`、`app/components/MapRoutePreview.vue`  
**替代方案**：全部走 Browser Key → Server Key 洩漏風險，已捨棄

---

### 2026/04/27 — Places Autocomplete 採用 sessionToken 分段計費

**決策類型**：成本最佳化  
**標題**：`UiGooglePlaceInput` 每次「輸入+選取」週期使用同一 sessionToken，選取後重置  
**背景**：Google Places API 以 session 計費，同一 session 內的 autocomplete + detail 請求合計為一次計費  
**決定**：每個 UiGooglePlaceInput 實例在 mounted 時產生 sessionToken，選取完成後（GetMapsPlaceDetails 成功後）立即 reset，確保 session 不跨越選取行為  
**影響**：`app/components/ui/GooglePlaceInput.vue`  
**替代方案**：不使用 sessionToken → 每次 keystroke 計費，成本大幅上升，已捨棄

---

### 2026/04/27 — Drop Pin 採用「activeField」prop 決定更新目標

**決策類型**：互動設計  
**標題**：MapRoutePreview 不自行判斷要更新哪個欄位，由父層傳入 `activeField` 控制  
**背景**：地圖組件可能對應多個欄位（上車、下車、多個停靠站），若組件自行判斷會造成耦合  
**決定**：MapRoutePreview 接收 `activeField: 'origin' | 'waypoint-N' | 'destination' | null`，Drop Pin 觸發時 emit `pin-placed(field, place)`，父層決定更新哪個欄位  
**影響**：`app/components/MapRoutePreview.vue`、`app/pages/booking/index.vue`  
**替代方案**：由地圖組件維護「最近被 focus 的欄位」→ 狀態耦合，已捨棄

---

### 2026/04/26 — 設計系統改版為美式復古機場風

**決策類型**：設計規範  
**標題**：將 Editorial Horizon 設計系統全面改版為「美式復古機場風（Retro Airport Americana）」  
**背景**：Brain AI 提供 HTML 視覺參考稿（`_docs/inde.html`），風格為 Bebas Neue 粗體大標、黃黑斜條紋、琥珀金色調、毛玻璃效果，與原 Editorial Horizon 的午夜藍色調完全不同。  
**決定**：
- 廢棄原 Editorial Horizon 設計語言（午夜藍 `#051125`、Manrope/Inter 字體）
- 改採米白 `#F5F2EC`＋暖奶油 `#FAF8F4`＋琥珀金 `#D4860A` 為主色系
- 字體改為 Bebas Neue（大標）＋ Barlow/Barlow Condensed（英文）＋ Noto Sans TC（中文）
- 新增 16 個 `--da-*` CSS 變數至 `_theme-colors.css`
- `style-guide.md` 全面改版為 v2.0
- 統計列由跑馬燈改為**機場翻牌效果（Split-Flap Board）**

**影響**：所有 Ui* 元件、首頁、所有後續頁面均遵循新設計系統  
**替代方案**：維持 Editorial Horizon → 已捨棄（與參考稿風格落差過大）

---

### 2026/04/26 — UiInput 強制 maxlength 預設值

**決策類型**：元件規範  
**標題**：UiInput 的 maxlength prop 設定預設值 200，而非無限制  
**背景**：CLAUDE.md 規定 `ElInput` 必須加 `maxlength`，自製 UiInput 同樣遵循此原則，防止使用者意外輸入超長字串。  
**決定**：`maxlength` 預設 200，呼叫方如需不同上限須明確傳入  
**影響**：app/components/ui/Input.vue

---

### 2026/04/26 — _docs 規格文件整合至 cc_da

**決策類型**：開發流程  
**標題**：將 Brain AI 產出的 _docs 規格文件整合至 Execution AI 工作的 cc_da 專案  
**背景**：Brain AI 在 `C:\Projects\_docs\` 下產出了完整的 DestinationAnywhere 規格文件體系，需要與 Execution AI 的 cc_da 樣板合併。  
**決定**：
- 所有業務文件放入 `docs/` 目錄
- 技術文件適配至 Nuxt 4 + pnpm + Element Plus 現況
- `.windsurfrules` / `agent-protocols.md` 功能由 `CLAUDE.md` 取代（Claude Code 生態）
- 保留樣板原有的 `CLAUDE.md` / `.claude/knowledge/` 規範體系  

**影響**：整個開發流程，開發者需閱讀 `docs/` 了解業務背景  
**相關文件**：CLAUDE.md、docs/tech-stack.md

---

### 2026/04/26 — 安裝 @line/liff

**決策類型**：套件新增  
**標題**：安裝 LINE LIFF SDK  
**背景**：StoreAuth.InitAuthFlow() 需要 LIFF 初始化，`_InitLiffFlow()` 動態 import `@line/liff`  
**決定**：`pnpm add @line/liff`，動態 import 確保不進入 server bundle  
**影響**：app/stores/5.store-auth.ts、app/plugins/auth.client.ts  
**相關文件**：docs/tech-stack.md

---

### 2026/04/26 — Firebase Auth 掛載點決策

**決策類型**：技術選擇  
**標題**：選擇 `app/plugins/auth.client.ts` 作為 Firebase Auth 初始化掛載點  
**背景**：`onAuthStateChanged` 不能放在 middleware（每次路由都觸發），不能放在 app.vue（過度臃腫）  
**決定**：建立 `.client.ts` plugin，只在瀏覽器端執行，呼叫 `StoreAuth().InitAuthFlow()`  
**影響**：SSR 安全，app.vue 保持乾淨  
**替代方案**：在 middleware 用 authResolved flag 等待 → 已捨棄

---

### 2026/04/24 — 技術棧初始化

**決策類型**：技術棧選擇  
**標題**：選擇 Nuxt 4 + Vue 3 + Firebase + LINE LIFF 作為主要技術棧  
**背景**：需要快速開發三端（乘客、司機、管理者）訂車平台，LINE 生態整合是核心需求  
**決定**：
- 前端框架：Nuxt 4 + Vue 3 Composition API + TypeScript
- 樣式：Element Plus（企業樣板） + Tailwind CSS（設計系統補充）
- 後端：Nitro（server/api/ BFF 模式）
- 資料庫與認證：Firebase Firestore + Firebase Auth
- 登入方式：LINE LIFF
- 多語系：繁中（zh）+ 英文（en）+ 日文（ja）  

**影響**：整個專案技術架構  
**相關文件**：docs/tech-stack.md、docs/prd.md

---

### 2026/04/24 — 設計系統選擇（已被 2026/04/26 決策取代）

**決策類型**：設計規範  
**標題**：採用 Editorial Horizon 設計系統（Tailwind CSS）與 Element Plus 並行  
**背景**：企業樣板已整合 Element Plus，新 UI 元件採用 Tailwind + Editorial Horizon  
**決定**：
- Element Plus 用於複雜業務元件（表格、表單、彈窗）
- 自定義 Ui* 元件採用 Tailwind 設計系統風格

**⚠️ 已被取代**：設計系統改版為美式復古機場風，見上方 2026/04/26 決策  
**影響**：所有前端元件  
**相關文件**：docs/style-guide.md

---

**版本紀錄**
- 版本：v1.6（新增 .client.vue、ElDatePicker、LINE push、航空 API 四項決策）
- 更新日期：2026/04/28
