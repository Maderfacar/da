# 專案任務清單 (Project Tasks & Backlog)

**總進度**：Stage 7 維護迭代中（P0~P11、P12~P15、P17、P18、P19 程式碼層完成，僅剩 P5 部分項與 P16 暫緩債待施作）
**最後更新**：2026/05/09

---

## Stage 0：需求與規則最終確認

- [✅] 完成 prd.md
- [✅] 完成 tech-stack.md
- [✅] 完成 style-guide.md
- [✅] 完成 folder-structure.md
- [✅] 完成 agent-protocols.md（適配 Claude Code）
- [✅] 完成 roadmap.md
- [✅] 完成 tasks.md
- [✅] 完成 decision-log.md
- [✅] 完成 git-workflow.md
- [✅] 完成 naming-conventions.md
- [✅] 完成 api-contracts.md
- [✅] 完成 testing-strategy.md

**Stage Gate**：✅ 所有文件完成，已整合至 docs/

---

## Stage 1：環境初始化與規則設定

- [✅] 建立 Nuxt 4 專案（使用企業樣板）
- [✅] 設定 TypeScript + ESLint
- [✅] 安裝 Tailwind CSS（@nuxtjs/tailwindcss）
- [✅] 安裝 Firebase + firebase-admin
- [✅] 安裝 @line/liff
- [✅] 設定 .env.dev（FIREBASE_* / LINE_LIFF_* 欄位）
- [✅] 更新 nuxt.config.ts（runtimeConfig Firebase + LIFF）
- [✅] 建立三端路由骨架（乘客 5 頁 / 司機 4 頁 / 管理者 3 頁）
- [✅] 建立 BFF API 骨架（maps/distance、flight/status、trip/sync）
- [✅] 建立 StoreAuth / StoreTrip / StoreOrder
- [✅] 建立 app/plugins/auth.client.ts（Firebase onAuthStateChanged）
- [✅] 建立 docs/ 規格文件目錄
- [✅] 更新 CLAUDE.md 加入 docs/ 知識庫引用
- [✅] **Stage Gate**：pnpm build 通過 + pnpm lint 通過

---

## Stage 2：基礎原子組件開發

- [✅] 建立 UiButton（Primary / Secondary / Glass 三種變體）
- [✅] 建立 UiInput（支援 Light / Dark Mode）
- [✅] 建立 UiCard（Glassmorphism 效果）
- [✅] 建立 UiModal
- [✅] 建立 UiToast / UiBadge
- [✅] 建立元件展示頁 `/demo/components`
- [✅] **Stage Gate**：展示頁樣式正確 + build 通過

---

## Stage 3：佈局與靜態頁面

- [✅] 建立乘客端 Layout（front-desk：固定頂部 Nav + 底部 5-Tab Bar）
- [✅] 建立司機端 Layout（driver：深色頂部 Nav + 底部 4-Tab Bar）
- [✅] 建立管理者端 Layout（back-desk：Hamburger + 左側抽屜 280px）
- [✅] 實作路由守衛 middleware（auth + role）
- [✅] 首頁與所有頁面抽換為正式 Layout（移除頁面內暫時 nav）
- [✅] **Stage Gate**：三端頁面可切換 + lint ✅ + build ✅

---

## Stage 4：邏輯實作與狀態管理

- [✅] 完整實作 LINE LIFF 登入流程（line-exchange API 500 修復、authResolved 無限 loading 修復）
- [✅] 完整實作 Firebase Auth 狀態機（onAuthStateChanged finally 保證 authResolved 設定）
- [✅] 修復 SSR Hydration mismatch（司機端/Admin 改 CSR；乘客端殘留警告待後續追蹤）
- [✅] 乘客訂單建立表單（4 步驟：行程類型/地址/車種/計價）
- [✅] Google Maps 地址自動完成（UiGooglePlaceInput + BFF autocomplete / place-details）
- [✅] Google Maps 路線規劃（MapRoutePreview：BFF Route API → encoded polyline → Polyline 繪製 + fitBounds）
- [✅] Drop Pin 互動（地圖點擊 / 長按 → 逆向地理編碼 → 更新地址欄位，blur 延遲修正時序）
- [✅] 台灣本島地理圍欄（strictBounds + 服務端驗證 + 前端錯誤提示）
- [✅] 共用計價公式（shared/pricing.ts：車種起跳費 + perKm + 額外服務 × 200，進位至 50）
- [✅] 停靠站距離即時計算（GetMapsRoute 含 waypoints，停靠站填入後自動更新里程與車程）
- [✅] **Stage Gate**：表單 E2E 手動驗收通過（testMode bypass 可在 localhost 完整走完 4 步驟訂車流程）

---

## Stage 5：資料串接與持久化

- [✅] Firebase Firestore 訂單 CRUD（POST 寫入 + GET 查詢 + /upcoming 接真實資料）
- [✅] 司機位置即時更新（PUT location BFF + GET available + /driver/trip 任務頁 + /admin/war-room 地圖）
- [✅] 航空 API 串接（server/api/flight.get.ts Mock Aviation Edge + 訂單表單自動填入航廈）
- [✅] LINE Webhook 建立（HMAC 簽名驗證 + follow 歡迎訊息 + text 自動回覆）
- [✅] liff.getFriendship() + 加好友提醒橫幅（乘客端 layout）
- [✅] 機場人流預測（Firestore airport_flow + n8n POST API + /admin/traffic Chart.js 24h 圖）
- [✅] LINE Bot 訂單推播通知（訂單建立後主動推播乘客 LINE 確認訊息）
- [✅] 補完所有 driver / admin 路由頁面 UI（driver dashboard/pending/trip/profile；admin orders/notifications/drivers/settings）
- [✅] **Stage Gate**：MVP 核心流程可跑通（乘客訂車→Firestore→LINE 推播→司機端可見→Admin 可查）

---

## Stage 6：測試、優化與部署

- [✅] Vitest 單元測試（shared/pricing.ts — 8 tests passed）
- [✅] 首頁統計列改版為機場翻牌效果（Split-flap Display）
  - 新增 `SplitFlapChar.vue`（單字元翻牌動畫，CSS perspective + backface-visibility）
  - 新增 `SplitFlapBoard.vue`（字串容器，charDelay stagger）
  - 取代舊有跑馬燈 flip-in 動畫
- [✅] 多語系（i18n）完整覆蓋 — **Layer 1：核心頁面**
  - 安裝 `@nuxtjs/i18n` v10.2.4，strategy `prefix_except_default`，支援 zh / en / ja
  - `home/index.vue`、`booking/index.vue`、`upcoming/index.vue`、`fleet/index.vue` 全面改用 `$t()`
  - 三語系翻譯檔建立（`i18n/locales/zh.js` / `en.js` / `ja.js`）
- [✅] 多語系（i18n）完整覆蓋 — **Layer 2：乘客端組件層**
  - `BookingStepType.vue`、`BookingStepRoute.vue`、`BookingStepOptions.vue`、`BookingStepConfirm.vue`
  - `BookingLocationInput.vue`、`GooglePlaceInput.vue`、`MapRoutePreview.vue`
  - `booking/index.vue` 成功畫面（`訂單送出成功` / `訂單編號` / `再次訂車`）全面 i18n
  - 修復 `ja.js` 遺漏整個 `booking.nav/type/route/options/confirm` 區塊（Playwright E2E 發現）
  - 補齊 `en.js` / `ja.js` 缺少的 `map.*` 與 `ui.*` 頂層翻譯區塊
- [✅] Playwright E2E 測試（15/15 通過）
  - 語系切換 URL 路由驗證（zh / en / ja）
  - 各語系 booking step 標籤確認無殘留硬編碼中文
  - 首頁 Split-flap board 無 JS 錯誤
  - 翻譯鍵缺失警告（`[vue-i18n] Not found`）全零
- [✅] 修復 `loading/page.vue` `.is-hide` 缺少 `pointer-events: none`（遮罩 600ms 攔截點擊問題）
- [✅] 行動版與 Dark Mode 完整測試
  - Playwright config 新增 `mobile-chrome`（Pixel 5, 393px）與 `iphone-14`（390px）兩個 project
  - 新增 `tests/e2e/mobile.spec.ts`（17 個測試）：Nav/TabBar 不溢出、無橫向 overflow、LangSwitcher 下拉、司機端深色 Nav 背景驗證
  - `i18n.spec.ts` KNOWN ISSUE test 更新為正向斷言（ja.js bug 已修復）
  - 程式碼審查：375/390px 版面數學驗算通過，`padding-top:56px` / `env(safe-area-inset-bottom)` 均已正確實作
  - 修復 `BookingStepType.vue` emit overload lint 警告（`@typescript-eslint/unified-signatures`）
  - 修復 `MapRoutePreview.vue` empty arrow function lint 警告（`no-empty-function`）
  - `pnpm build` ✅ `pnpm lint`（app 程式碼）✅
- [✅] 部署至 Vercel（v0.3.13 已 push，Vercel 自動部署）
- [✅] **Stage Gate**：行動版測試通過 + Vercel 部署成功確認（待人類最終確認）

---

## Stage 7：維護與迭代（The Evolution）

**目標**：完成 MVP 缺口、串接真實外部服務、建立長期維護機制。

### P0：全端 LINE LIFF 登入強制 + 白名單審核（進行中）

> **背景**：三端（乘客/司機/Admin）統一以 LINE LIFF 登入，Admin 與 Driver 需通過白名單才能進入各自入口；任何未核准的 UID 一律導至乘客端首頁 `/`。

- [✅] `line-exchange.post.ts`：新 driver 登入時寫入 `approved: false`
- [✅] `StoreAuth`：新增 `approved` 狀態欄位，從 Firestore 讀取
- [✅] `role.ts` middleware：未核准 driver/admin 導至 `/`
- [✅] Server API `GET /nuxt-api/admin/users`：查詢使用者清單（依 role 篩選）
- [✅] Server API `PATCH /nuxt-api/admin/users/[uid]`：更新 role/approved
- [✅] `admin/settings/index.vue`：新增「存取控制」區塊（Admin 白名單 + 司機審核）

> **首位管理員設定方式**：須至 Firebase Console → Firestore → `users/{uid}` 手動設定 `role: "admin"`，或由現有管理員在系統設定頁操作。

### P1：乘客端缺口補齊（進行中）

- [✅] `/orders` 頁面真實串接 Firestore（目前顯示 mock 資料）
- [✅] `/profile` 頁面完整實作（個人資訊顯示、LINE 帳號連結狀態、登出）
- [✅] 首頁 `/` 近期行程區塊改用真實 Firestore 資料（目前為靜態 mock）

### P2：司機端 mock → 真實串接

- [✅] `/driver/pending` 搶單列表改用真實 Firestore 查詢（status=pending，接單寫入 assignedDriverId）
- [✅] `/driver/dashboard` 統計數據改用真實 Firestore 彙總（今日已完成趟次＋收入）
- [✅] `/driver/profile` 個人資訊真實串接（讀取 `users` 集合 createdAt + LINE profile）

### P3：Admin 端真實化

- [✅] `/admin/orders` 真實 Firestore 資料 + 指派司機彈窗（PATCH order → assignedDriverId）
- [✅] `/admin/drivers` 真實 Firestore 資料（role=driver），含核准/撤銷操作（取代 settings 頁的重複功能）
- [✅] `/admin/notifications` 真實 LINE Bot 廣播（POST /nuxt-api/admin/broadcast，依 role 篩選收件人）

### P4：外部整合

- [✅] **桃園機場 XLS 爬取**（2026/05/09 再次重構，棄用 n8n + Gist 改 server lazy fetch）：
  - ~~Firestore `airport_flow_forecast`~~ → ~~GitHub Gist~~ → **server 端 cheerio + xlsx + Firestore `airport_flow`** ✅
  - 棄用原因：n8n 服務 5/1 後連續 8 天無更新（Gist 內最後一筆 5/2），維運成本高；改成 server 內建抓取無外部依賴
  - 新流程：`GET /api/airport/flow` lazy fetch → 直拼 `taoyuan-airport.com/uploads/fos/{YYYY_MM_DD}.xls`（cheerio fallback）→ xlsx 解析 → 寫 Firestore cache → 自動清理 7 天前 doc
  - 移除：`n8n-workflow-taoyuan-xls.json` / `data/airport-forecast/` / `server/api/airport/flow.post.ts` / `server/routes/nuxt-api/airport-forecast/`
  - 移除 env：`NUXT_AIRPORT_FORECAST_GIST_URL`、Vercel 端可手動刪除
  - `admin/traffic` UI 重構：
    - 恢復 全端/第一航廈/第二航廈 及 進出境/入境/出境 篩選器 ✅
    - 移除自訂日期 input，保留今天/明天快捷鈕 ✅
  - **待人工操作**：至 n8n 將兩個「Bearer YOUR_GITHUB_PAT_HERE」節點改為真實 PAT（需 `gist` 權限）
- [✅] **CWA 氣象 API**：
  - BFF `GET /nuxt-api/weather?dataset=F-C0032-001&locationName=桃園市` 完整實作 ✅
  - `WeatherWidget.vue` 已串接，顯示桃園天氣（描述/最高最低溫/降雨機率）✅
  - 嵌入司機端 Dashboard 與 Admin Traffic 頁 ✅

> 注意：Admin 與司機端**不做 i18n**，乘客端 i18n 已於 Stage 6 完成。

### P5：品質維護

- [ ] 真實航空 API 替換 Mock Aviation Edge（`server/api/flight.get.ts`）
- [✅] ESLint 排除 `.claude/skills/` 目錄（修正 `no-unused-vars` 預存警告）
- [ ] 定期 `pnpm audit` 依賴安全性掃描

### P6：Auth 穩定性修復（2026/05/02 完成）

- [✅] **Firestore admin 文件缺失**：首位管理員 `users/{lineUid}` 文件不存在，導致 role=null → middleware 踢出 → admin 頁面無法進入。已透過 Firebase Admin SDK 建立 `{ role: 'admin', approved: true }`
- [⚠️ OBSOLETE 2026/05/06] **Admin 跳過 LIFF**：原本決策為 admin 路徑不走 LINE LIFF 功能；後因 P7 三端 Header 統一顯示 LINE 頭像需求，改回走 LIFF + Firestore 白名單（見 P8）
- [✅] **Firebase session 優先於 LIFF**：driver / passenger 路徑，若 Firebase `currentUser` 存在，直接跳過 `liff.login()` 強制跳轉，解決 LIFF session 過期但 Firebase session 有效時被踢出的問題

### P7：UI/UX 強化與 Pinia reactivity 修復（2026/05/06 進行中）

> **背景**：實機測試發現多個解構 Pinia setup store 失去 reactivity 引發的隱性 bug（admin 無限 loading、profile 卡空白、登入後不自動導向、訂單頁 API 不打）。同時補上三端 Header 顯示 LINE 頭像 + 名稱以提升 UX 一致性。

**P7-1：Pinia setup store 解構統一改用 `storeToRefs`（已完成）**
- [✅] `app/layouts/back-desk.vue`（commit `e6bc8d6`，解決 admin 無限 loading）
- [✅] `app/layouts/driver.vue`、`app/pages/profile/index.vue`、`app/pages/driver/profile/index.vue`、`app/pages/driver/auth/index.vue`、`app/pages/login/index.vue`、`app/pages/orders/index.vue`、`app/pages/driver/pending/index.vue`、`app/pages/home/index.vue`（commit `1490725`）

**P7-2：三端 Header 顯示 LINE 頭像 + 名稱（待做）**
- [ ] 補 `_LoadRoleFromFirestore` 讀取 `displayName` / `pictureUrl` 寫回 `lineProfile.value`（解決重新整理後 lineProfile=null 的問題）
- [ ] 新增 `app/components/common/CommonHeaderUser.vue`（圓形頭像 + displayName + 點擊跳轉 profile）
- [ ] `front-desk.vue` Header 加入 `CommonHeaderUser`，**移除「訂單」「預約」按鈕**（保留 LangSwitcher）
- [ ] `driver.vue` Header 加入 `CommonHeaderUser`（取代或並列「待命中」狀態圓點）
- [ ] `back-desk.vue` Header 加入 `CommonHeaderUser`（保留 ADMIN 標章）
- [ ] 若 `role === 'admin'`，於頭像左側顯示 ADMIN 跳轉鈕（連到 `/admin/orders`）；非 admin 不顯示

### P8：司機申請流程改造（2026/05/06~05/08 ✅ 完成）

> **背景**：原 `/driver/auth` 流程對未註冊使用者直接寫入 `role: 'driver', approved: false` 後又被 middleware 導回 `/`，使用者無從得知申請狀態。重新設計為「passenger 預設 → 主動申請 → admin 審核」標準三段流程，並新增 1 天冷卻避免轟炸申請。

**P8-1：後端架構修正** ✅（2026/05/06 commit `6a4ab84`）
- [✅] 修 `server/routes/nuxt-api/auth/line-exchange.post.ts`：新使用者一律建為 `roles: ['passenger']`
- [✅] 修 `app/middleware/role.ts`：`/driver/register` 路徑放行
- [✅] 修 `app/stores/5.store-auth.ts`：`_LoadRolesFromFirestore` 讀取 `driverApplication`

**P8-2：申請頁面** ✅（2026/05/08）
- [✅] 重寫 `app/pages/driver/register/index.vue` 三模式渲染：
  - 無 driver 身分 → apply 模式：完整申請表單
  - driver + !approved + 無 rejectedAt → pending 模式：審核中提示
  - driver + !approved + 有 rejectedAt 在 24h 內 → rejected 模式：拒絕原因 + 24h 倒數
- [✅] 表單欄位：司機姓名、聯絡電話、車牌號、車型（sedan/mpv/suv/van radio）、銀行代號、銀行帳號
- [✅] 4 個證件上傳欄位：駕照、行照、保險卡、良民證（皆必填）
- [✅] 新建 `app/components/driver/RegisterUploadField.vue`：拖放 + 點擊上傳、jpg/png 預覽、pdf 圖示 fallback、5MB 上限、上傳中 spinner、清空按鈕

**P8-3：申請與圖片上傳 API** ✅（2026/05/08）
- [✅] 新建 `server/routes/nuxt-api/driver/upload.post.ts`：multipart → Firebase Storage `drivers/{lineUserId}/{docType}-{timestamp}.{ext}` → 1 年長效 signed URL；驗證 docType / mime / 5MB 上限
- [✅] 新建 `server/routes/nuxt-api/driver/apply.post.ts`：驗證冷卻（24h）→ 寫入 `users/{lineUserId}.driverApplication` 完整欄位 + `roles: arrayUnion('driver')` + `approved=false` + `driverCategory='0'`；保留 passenger / admin 等其他 role
- [✅] 新增 protocol `app/protocol/fetch-api/api/driver/index.ts`：`ApplyDriver` + `UploadDriverDocument`（multipart formdata）
- [✅] 補強 `firebase-admin.ts`：加 `storage` export，初始化時帶 `storageBucket`

**P8-4：登入後分流** ✅（2026/05/07 P10 順手做完）
- [✅] 修 `app/pages/driver/auth/index.vue` 導向四分支：
  - `isApprovedDriver` → `/driver/dashboard`
  - `isDriver && !approved` → `/driver/register`
  - `isAdmin` → `/admin/orders`
  - 純 passenger → `/driver/register`

**P8-5：Admin 審核強化** ✅（2026/05/08）
- [✅] 重寫 `app/pages/admin/drivers/index.vue` 三分頁（待審核 / 已核准 / 冷卻中）
- [✅] 司機卡片可展開檢視 `driverApplication` 完整資料（姓名/電話/車牌/車型/銀行/申請時間）+ 4 張證件圖片（jpg/png 直接顯示，pdf 圖示連結）
- [✅] 「拒絕」按鈕：用 `window.prompt` 取拒絕原因 → `removeRole: 'driver' + rejectedAt + rejectReason`
- [✅] 「解除冷卻」按鈕（僅冷卻中顯示）：`rejectedAt: null` 清空
- [✅] 「直接核准」按鈕（冷卻中也可越過冷卻直接核准）：`approved: true`
- [✅] 補 `server/routes/nuxt-api/admin/users/[uid].patch.ts` 支援 `rejectedAt` / `rejectReason` / `driverCategory` 三個新欄位
- [✅] 補 `server/routes/nuxt-api/admin/users/index.get.ts` 回傳完整 `driverApplication` 結構

**P8-6：權限規則** ✅ 代碼層（2026/05/08）
- [✅] 新建 `storage.rules`：`drivers/{lineUserId}/*` client 完全禁止讀寫，僅透過 server-side admin SDK 上傳；client 端用 signed URL 顯示圖片
- [✅] 既有 `firestore.rules`（P11-3）已涵蓋 `users.driverApplication` — owner / admin 可讀，寫入只透過 server admin SDK
- [ ] **待人工部署**：到 Firebase Console → Storage → Rules 貼上 `storage.rules` 並 Publish

**Stage Gate（P8）** — 2026/05/08 ✅ 代碼層全部通過：
- lint ✅
- 司機申請完整三段流程（passenger → 申請 → 審核 → 核准 / 拒絕 / 冷卻 / 解除）已串通
- 圖片上傳走 Firebase Storage + 1 年 signed URL，admin 端可直接顯示
- 多角色身分保留：申請 driver 不影響原有 passenger / admin 身分

### P9：Admin LIFF 白名單統一（2026/05/06 進行中，與 P7 並行）

> **背景**：P7 要求三端 Header 都顯示 LINE 頭像，admin 端必須有 LINE 身分；推翻 P6 的「admin 跳過 LIFF」決策。

- [ ] 移除 `app/stores/5.store-auth.ts` `_InitLiffFlow` 中 `route.path.startsWith('/admin')` 的早期 return
- [ ] 確認既有 admin 帳號 Firestore `users/{lineUid}` 文件存在且 `role: 'admin'`（首位 admin 仍須由 Firebase Console 手動建立）
- [ ] Vercel 部署後實機驗證：admin 從 LINE 內建瀏覽器進 `/admin/orders` 可正常顯示頭像 + 名稱

### P5：品質維護（沿用）

- [ ] 真實航空 API 替換 Mock Aviation Edge（`server/api/flight.get.ts`）
- [✅] ESLint 排除 `.claude/skills/` 目錄
- [ ] 定期 `pnpm audit` 依賴安全性掃描

> 注意：Admin 與司機端**不做 i18n**，乘客端 i18n 已於 Stage 6 完成。

**Stage Gate（P7 + P8 + P9）**：
- 三端 Header 顯示 LINE 頭像 + 名稱（lint ✅ + 部署 ✅ + 實機驗證 ✅）
- 司機申請流程可走通：passenger → 申請 → admin 核准 → /driver/dashboard
- 被拒絕司機 24h 內無法重申，admin 可手動解除冷卻
- Admin 端從 LINE 登入後可正常進入後台並顯示頭像

### P10：身分模型改為 roles[] 多角色陣列（2026/05/07 完成）

> **背景**：原單一 role 互斥造成 admin 看不到 ADMIN 跳轉鈕、admin / approved driver 無法在乘客端訂車。改為 roles 陣列後，單一使用者可同時具 passenger / driver / admin 多重身分。

**P10-1：後端 schema 與 API（已完成）**
- [✅] `server/routes/nuxt-api/auth/line-exchange.post.ts`：新使用者寫 `roles: ['passenger']`、custom token claims 改 `roles`、回傳 `roles[]`
- [✅] `server/routes/nuxt-api/admin/users/index.get.ts`：改用 `where('roles', 'array-contains', query.role)`
- [✅] `server/routes/nuxt-api/admin/users/[uid].patch.ts`：body 改為 `addRole` / `removeRole` 語意（arrayUnion / arrayRemove），禁止移除 passenger
- [✅] `server/routes/nuxt-api/admin/broadcast.post.ts`：targetRole 篩選改 array-contains
- [✅] `app/protocol/fetch-api/api/admin/index.ts`：`AdminUser.roles: Role[]`、`PatchAdminUserBody.{addRole,removeRole}`
- [✅] `docs/api-contracts.md`：對齊新 schema 與 PATCH 語意

**P10-2：前端 store / middleware / pages（已完成）**
- [✅] `app/stores/5.store-auth.ts`：`role` → `roles[]`，新增 computed `isAdmin` / `isDriver` / `isPassenger` / `isApprovedDriver`，移除 `SetRole` action，`MockSignIn(roles[])`
- [✅] `app/middleware/role.ts`：以 `roles.includes(...)` 判斷；**移除 admin / approved driver 不得進入乘客路由的 redirect**
- [✅] `app/components/common/CommonHeaderUser.vue`：新增 DRIVER 切換鈕（approved driver 在乘客/admin 端顯示），ADMIN 鈕改用 `isAdmin`
- [✅] `app/pages/login/index.vue`：以 `isAdmin` 判斷導向；MockSignIn 自動帶 passenger
- [✅] `app/pages/driver/auth/index.vue`：四分支導向改用 `isApprovedDriver` / `isDriver` / `isAdmin`
- [✅] `app/pages/driver/register/index.vue`：mode 判斷改用 `isDriver`
- [✅] `app/pages/admin/settings/index.vue`：管理員白名單與司機審核操作改用 `addRole` / `removeRole`

**P10-3：docs（已完成）**
- [✅] `docs/decision-log.md`：新增 2026/05/07 決策條目
- [✅] `docs/tasks.md`：新增本 P10 章節

**P10-4：手動操作（須使用者執行）**
- [✅] Firebase Console 將既有使用者文件 `users/{lineUid}` 加入 `roles: ['passenger', 'driver', 'admin']`（陣列型別）

**Stage Gate（P10）** — 2026/05/08 ✅ 全部通過：
- lint ✅ / Vercel 部署 ✅
- 乘客端 ADMIN 鈕顯示 ✅
- Admin 端 PASSENGER 鈕顯示 ✅
- 司機端不再循環登入 ✅
- 訂單建立成功並寫入 Firestore orders ✅

**P10 Production Debug 補課（2026/05/07~08，11 個 commits）**：
- [✅] 535926e → 048f027：踩雷三大層完整修復（destr parse object / frozen object / isNewUser 覆寫）
- [✅] decision-log.md 詳記三大踩雷點與強制規範
- 學到的教訓：`useRuntimeConfig` 取 JSON secret 必須當 `string | object`；`firebase-admin` service account 必須先深拷貝；同步 Auth ↔ Firestore 文件禁用 `.set()` 直接覆寫

### P11：收尾整理（2026/05/08 ✅ 完成）

> **背景**：P10 production debug 過程中為了定位問題，留下大量 console.error / console.info；同時發現訂單 API 仍有 silent failure 隱憂；Firestore Rules 未正式設定。本階段一次清理乾淨。

**P11-1：移除 production debug log**（中優先級 ✅）
- [✅] `server/utils/firebase-admin.ts`：保留必填欄位 throw + PEM 格式驗證 throw，移除 verbose console.error
- [✅] `server/routes/nuxt-api/auth/line-exchange.post.ts`：保留兜底 try-catch 與失敗 console.error，移除入口 / 步驟性 / success summary 等除錯 log
- [✅] `app/stores/5.store-auth.ts`：移除 LIFF flow 各階段 `console.info` debug log，保留 line-exchange / _InitLiffFlow 失敗時 console.error
- [✅] `app/plugins/auth.client.ts`：保留 `window.__authStore` 開發 debug 機制，移除 `[plugin/auth] exposed` console.info

**P11-2：訂單 API silent failure 修復**（**高優先級** ✅）
- [✅] `server/routes/nuxt-api/orders/index.post.ts`：Firestore 寫失敗時回 `serverError(...)` 而非 silent 200；前面 400 路徑統一改用 `badRequestError` helper；成功路徑改用 `successResponse` helper
- [✅] 補檢查：`drivers/[id]/location.put.ts` 在 `firebaseServiceAccountJson` 缺失時 silent 回 200 → 改 `serverError`；統一改用 helpers
- [✅] 確認其他寫入 endpoint（`orders/[orderId].patch.ts`、`admin/users/[uid].patch.ts`、`airport-forecast/index.post.ts`）失敗路徑都正確 return error

**P11-3：Firestore Security Rules 正式設定**（低優先級 ✅）
- [✅] 新建 `firestore.rules` 含三大集合（users / orders / drivers）+ 預設拒絕兜底
  - `users/{lineUid}`：使用者只能讀自己（auth.uid == 'line:' + lineUid），admin 可讀所有；寫入禁止 client，僅 server admin SDK
  - `orders/{orderId}`：乘客讀自己訂單，admin / driver 可讀所有；寫入禁止 client
  - `drivers/{driverId}`：admin 可讀所有，driver 自己可讀自己；寫入禁止 client
  - `airport_flow_forecast`：公開讀
- [ ] **待人工操作**：使用者需到 Firebase Console → Firestore Database → Rules 貼上 `firestore.rules` 內容並 Publish（或用 firebase CLI `firebase deploy --only firestore:rules`）
- 部署後 client console 的 `Missing or insufficient permissions` warning 會消失

**P11-4：Vercel 專案清理**（低優先級）
- [✅] 確認 production 跑的是 `da-line-liff-app.vercel.app`
- [ ] **待人工操作**：使用者需到 Vercel Dashboard → 找到 `cc_da` 專案 → Settings → 最下方 Delete Project，避免日後混淆（代碼層無可動）

**P11-5：MockSignIn 簽名修復補課**（已完成）
- [✅] `app/plugins/auth.client.ts`：`MockSignIn('passenger')` → `MockSignIn(['passenger'])` 對齊 P10 簽名

**Stage Gate（P11）** — 2026/05/08 ✅ 全部通過：
- lint ✅
- production logs 乾淨（無多餘 debug 訊息）✅
- 訂單寫失敗會回前端 error 而非靜默成功 ✅
- firestore.rules 已建立（待使用者部署）✅

### P12：司機端循環登入 + Admin 司機管理無限轉圈雙修（2026/05/08 ✅ 完成）

> 詳見 docs/decision-log.md 2026/05/08 P12 條目。

- [✅] 還原 `app/stores/5.store-auth.ts` `_InitLiffFlow` 的 P6 Firebase currentUser 檢查（commit `fd8c4d9`）
- [✅] `server/routes/nuxt-api/admin/users/index.get.ts` 移除 `.orderBy('createdAt')` 改 in-memory sort（避開 composite index 部署）
- [✅] `app/pages/admin/drivers/index.vue` ApiLoadDrivers 加 try-finally + Array.isArray guard（commit `ec70f69`）

### P13：司機證件上傳失敗修復（2026/05/08 ✅ 完成）

> 詳見 docs/decision-log.md 2026/05/08 P13 條目。

- [✅] `server/utils/firebase-admin.ts` storageBucket 取值順序：server-only > public > `.firebasestorage.app` > `.appspot.com`（commit `89bd2e7`）
- [✅] `server/routes/nuxt-api/driver/upload.post.ts` catch 暴露 err.message 協助定位
- [✅] **使用者操作**：確認 Vercel `NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET` = `destination-anywhere-cfd50.firebasestorage.app`

### P14：上線安全修復 — 全部受保護 endpoint 加 require-auth（2026/05/09 ✅ 完成）

> 詳見 docs/decision-log.md 2026/05/09 P14 條目。共解決 6 個 CRITICAL 漏洞。

**Server side（10 個 endpoint + 1 個新 helper）** ✅
- [✅] 新增 `server/utils/require-auth.ts`：`getAuthFromEvent` + `authFailResponse`（commit `da52cb5`）
- [✅] admin endpoints 4 個套 admin only guard：broadcast / orders.get / users.get / users.patch
- [✅] driver/upload + driver/apply：caller.lineUid === body.lineUserId 或 admin
- [✅] orders/index.get：純 passenger 強制只能讀自己；admin/driver 可帶 query.userId
- [✅] orders/[orderId].patch：owner 只能 cancel；admin/driver 任意更新
- [✅] drivers/[id]/location.put + drivers/[uid]/stats.get：caller.uid === id 或 admin

**Client side（3 處）** ✅
- [✅] `app/stores/5.store-auth.ts` 加 `GetFreshIdToken()` action
- [✅] `app/protocol/fetch-api/methods.ts` onRequest 改 async 帶 Bearer ID token
- [✅] `app/protocol/fetch-api/api/driver/index.ts` UploadDriverDocument 直接 $fetch 加 header

**Stage Gate（P14）** — 2026/05/09 ✅ 通過實機驗證：
- 無痕直接打 `/nuxt-api/admin/users` → 401 ✅
- admin 端 / 司機端 / 乘客端正常流程 idToken 自動帶上 ✅

### P15：路由整理 + silent failure 修復（2026/05/09 ✅ 完成）

> 詳見 docs/decision-log.md 2026/05/09 P15 條目。

**第二批：路由整理 + dev 痕跡** ✅（commit `cde9af7`）
- [✅] `app/pages/index.vue`：原本 if/else 都導 `/home` → 改成依登入狀態 + roles 分流
- [✅] `app/pages/admin/index.vue`：`/admin` 入口從 `/admin/traffic` 改為 `/admin/orders`（與其他 admin 落點一致）
- [✅] 刪除 `app/pages/demo/components.vue` + `tinymce-editor.vue`（兩支頁面無 middleware 對外可開）
- [✅] **使用者操作**：刪除 Vercel `NUXT_PUBLIC_TEST_MODE`，prod 不再顯示 MockSignIn 鈕

**第三批：silent failure 修復** ✅（commit `4b19700`）
- [✅] `server/routes/nuxt-api/orders/available.get.ts`：Firebase 未設不再 silent 200，改 serverError
- [✅] `server/routes/nuxt-api/drivers/available.get.ts`：同上
- [✅] `server/routes/nuxt-api/auth/line-exchange.post.ts`：既有使用者 displayName/pictureUrl 同步失敗加 console.warn
- [✅] client 4 個頁面加 status guard + Array.isArray + try-finally：`orders/index.vue`、`home/index.vue`、`admin/orders/index.vue`、`admin/settings/index.vue`

### P16：暫緩項目（待轉換批次再做）

> **背景**：使用者要求先把資安債 / 體驗修飾暫停，轉向乘客端完善。本節記錄已盤點但暫緩的項目，避免遺忘。

**P16-1：資安債（建議上線後 1 週內）** — ✅ **2026-05-13 P31 全部完成**
- [✅] **Signed URL TTL 縮短**：[upload.post.ts](../server/routes/nuxt-api/driver/upload.post.ts) 1 年 → 4 小時；新增 [signed-url.ts](../server/utils/signed-url.ts) resign helper + [driver-docs/sign.post.ts](../server/routes/nuxt-api/driver-docs/sign.post.ts) endpoint；[admin/users/index.get.ts](../server/routes/nuxt-api/admin/users/index.get.ts) server resign；[admin/drivers/[uid].vue](../app/pages/admin/drivers/%5Buid%5D.vue) + [driver/profile/index.vue](../app/pages/driver/profile/index.vue) client-side resign
- [✅] **err.message 暴露 prod guard**：`server/routes/nuxt-api/driver/upload.post.ts` prod 只回通用「上傳失敗，請稍後重試」，dev 才附 err.message
- [✅] **Rate limiting**：[rate-limit.ts](../server/utils/rate-limit.ts) Firestore-based helper + [line-exchange](../server/routes/nuxt-api/auth/line-exchange.post.ts)（IP 10/min）/ [driver/apply](../server/routes/nuxt-api/driver/apply.post.ts)（uid 3/h + IP 10/h 雙鎖）/ [admin/broadcast](../server/routes/nuxt-api/admin/broadcast.post.ts)（uid 10/h）接入；firestore.rules `rate_limits` client 全禁；fail-open 設計避免 Firestore 故障導致全停擺

**P16-2：體驗修飾（上線後可做）**
- [✅] `/admin/war-room` `console.error` 加 prefix `[admin/war-room]` 對齊其他檔
- [✅] `/driver/dashboard` ONLINE HRS 暫隱藏（永遠顯示 0 無參考價值；接後端上線時數累計 API 後再放回）
- [✅] `/admin/notifications` 通知歷史持久化已由 P25-2 audit log cover（`broadcast.send` action 寫入 `audit_logs/`，super admin 可在 `/admin/audit-logs` 過濾查詢）
- [✅] `/driver/profile` totalTrips label 已對齊為 `TODAY TRIPS`（之前記錄 stale）

**P16-3：基礎設施**
- [ ] **使用者部署 firestore.rules**：Firebase Console → Firestore → Rules 貼上 `firestore.rules` 內容並 Publish
- [ ] **使用者部署 storage.rules**（P8 建立但用戶以自有規則覆寫，已 OK）
- [ ] **刪除 Vercel `cc_da` 舊專案**：避免與 `da-line-liff-app` 混淆
- [ ] **真實航空 API 替換 Aviation Edge mock**（`server/api/flight.get.ts`）：需業務 RFP 決定來源
- [ ] **pnpm audit 排程**：寫進 GitHub Actions 月排程

### P17：乘客端完善（2026/05/09 進行中）

> **背景**：使用者要求轉向乘客端完善。code-explorer agent 全面盤點 + booking → orders → upcoming 流程交叉確認。詳見 P17 工作清單。

**P17-1：上線阻擋級（2026/05/09 ✅ 完成）**
- [✅] **userId 格式不一致 bug（P14 引入回歸）**
  - 修法：`server/routes/nuxt-api/orders/index.post.ts` 加 require-auth + 強制 `userId = lineUserId = auth.lineUid`
  - `CreateOrderParams` / `GetOrderListParams` userId 改為 optional
  - `booking/index.vue` 不再傳 userId/lineUserId；`orders/index.vue` `upcoming/index.vue` 不再傳 query.userId
  - **使用者操作**：清空 Firestore `orders` collection 內舊測試訂單（帶 `line:` prefix）
- [✅] **`upcoming/index.vue` orderStatus 'in_transit' 統一**：TripStatus、STATUS_TAB_KEYS、STATUS_CLS、3 個 i18n 檔（zh/en/ja）的 `status.*` 與 `upcoming.tab.*` 全部對齊
- [✅] **`orders/index.vue` magic 200 改為 `$enum.apiStatus.success`**

**P17-2：應做才好上線（2026/05/09 ✅ 完成）**
- [✅] **訂單取消功能**：`/orders` 與 `/upcoming` 的 pending / confirmed 訂單顯示「取消訂單」按鈕；UseAsk 確認 → PatchOrder → 重 load
- [✅] **booking 成功後加「查看行程」按鈕**：原「再訂一張」改為次按鈕，新增「查看行程」主按鈕跳 `/upcoming`
- [✅] **訂單狀態 polling**：`/orders` 與 `/upcoming` 加 30s setInterval + visibility 切回時 refresh，onUnmounted 清理 timer

**P17-3：體驗細節（先列入待辦）**
- [ ] 訂單詳情頁（/orders/:orderId）— 乘客看不到 stopovers、距離、車程、司機資訊（成本：大，需新增路由）
- [ ] `profile` 頁加訂單統計（總趟數 / 累計里程）+ 客服聯絡資訊
- [✅] `fleet/index.vue` 預約按鈕已帶 `?vehicleType=` query 直連 `/booking` 預選車型
- [✅] `orders/index.vue` STATUS_LABEL / VEHICLE_LABEL 走 i18n（[orders/index.vue:73-76](../app/pages/orders/index.vue) `t('status.{status}')` / `t('vehicle.{vehicleType}')`）
- [✅] `upcoming/index.vue` STATUS_TAB_KEYS 已含 `cancelled` filter
- [✅] `app/protocol/fetch-api/methods.ts` 401 自動登出邏輯實作（[methods.ts:1-15](../app/protocol/fetch-api/methods.ts) `HandleUnauthorized` + onResponseError hook，含重入守衛 `_isSigningOut`）
- [✅] 加好友橫幅與 home Hero 排版重疊修正（P32）：[front-desk.vue:71](../app/layouts/front-desk.vue) main 加 `has-banner` class + 顯示橫幅時整體下移 40px（橫幅高 = 10px padding × 2 + 20px content），所有 front-desk 頁面自然避開遮擋

**P17-4：使用者偏好變更**
- [✅] **乘客端登出按鈕**：早於 commit `473ada0` 移除（不需重做；司機端 / Admin 端保留）

### P18：Collection Split — drivers + admins 獨立 collection（2026/05/09 程式碼層完成）

> 完整設計與 tasks 見 `openspec/changes/2026-05-09-collection-split/`：
> - `proposal.md`：背景、範圍、影響
> - `design.md`：schema 細節、決策與 trade-off
> - `tasks.md`：Stage 0~10 順序化 checklist
> - `migration.md`：使用者手動 Firebase Console 操作指引

**P18 程式碼層改動（Stage 1~9 ✅ 完成）**：
- [✅] **Stage 1**：`server/utils/require-auth.ts` 載入 admin level + permissions overrides
- [✅] **Stage 2**：新增 `server/utils/require-permission.ts`（Permission 列舉 + LEVEL_TABLE + hasPermission）
- [✅] **Stage 3**：`driver/apply.post.ts` 同步建 `drivers/{lineUid}` + `admin/users/[uid].patch.ts` driverCategory 改寫 drivers
- [✅] **Stage 4**：`drivers/[id]/location.put` + `drivers/[uid]/stats.get` + `drivers/available.get` 三 endpoint 對齊新 schema
- [✅] **Stage 5**：`orders/[orderId].patch.ts` 訂單 completed 時對 drivers doc increment 統計
- [✅] **Stage 6**：`admin/users/[uid].patch.ts` 套 require-permission + 同步 admins doc 建 / 刪 / super 保護；新增 `admin/admins/index.get.ts` + `admin/admins/[uid].patch.ts`；`admin/broadcast.post.ts` 套 canBroadcast；`admin/orders/index.get.ts` 套 canManageOrders
- [✅] **Stage 7**：`admin/index.ts` 加 GetAdmins / PatchAdmin；`store-auth.ts` 加 level + isSuper；`admin/settings/index.vue` admin tab 限 super + level 編輯 UI
- [✅] **Stage 8**：`firestore.rules` drivers rules 對齊 lineUid + 新增 admins rules
- [✅] **Stage 9**：docs/decision-log P18 條目 + tasks.md 更新

**P18 使用者操作（Stage 10）**：
- [ ] 依 `openspec/changes/2026-05-09-collection-split/migration.md` 在 Firebase Console 手動建 admins/drivers doc + 清舊 driverCategory + 部署新 firestore.rules

**P18 後續工作**（2026/05/12 全部整併進 P25 規劃；分區管理已決議**移除**）：
- → 司機統計 today 欄位每日歸零：見 P25-1（與 online hours 合併，lazy reset）
- → admin operation audit log：見 P25-2
- → admins.permissions 細粒度 override UI：見 P25-4
- → 司機評分系統：見 P25-3（暫保留至業務需求觸發）
- ❌ 分區管理：2026/05/12 決議移除（不需要此功能；drivers.assignedRegions 欄位保留但 schema 文件標註 deprecated）

### P19：Driver Trip Mission — 司機任務頁 + 五階段狀態流 + 自動定位（2026/05/09 程式碼層完成）

> 完整設計與 tasks 見 `openspec/changes/2026-05-09-p19-driver-trip-mission/`：
> - `proposal.md`：背景、範圍、影響
> - `design.md`：6 個決策、schema、狀態機、i18n
> - `tasks.md`：Stage 0~10 順序化 checklist + G1~G12 stage gate

**P19 程式碼層改動（Stage 1~10 ✅ 完成）**：
- [✅] **Stage 1**：`orders/[orderId].patch.ts` 訂單狀態擴充為 7 值 + driver 嚴格狀態機 + en_route 觸發 driver busy + completed 切回 online + statusHistory 寫入
- [✅] **Stage 2**：新增 `orders/assigned.get.ts`（driver 取自己被指派的執行中訂單）
- [✅] **Stage 3**：`drivers/available.get.ts` 撈所有 drivers + 加 activeOrder/lastActiveAt/accuracy；`drivers/[id]/location.put.ts` 接受 accuracy + 拒絕 client 寫 offline
- [✅] **Stage 4**：新增 `app/composables/use-driver-geolocation.ts`（5m / 60s / 50m accuracy / Haversine + UploadNow force）
- [✅] **Stage 5**：`app/layouts/driver.vue` 整合授權 flow + blocking modal + 重試 + 拒絕 2 次踢回 /home + onUnmounted clearWatch
- [✅] **Stage 6**：`app/pages/driver/trip/index.vue` 重寫為任務列表 + 五階段操作按鈕 + 30s polling
- [✅] **Stage 7**：API 介面層 + type 對齊（`order/index.ts` 加 GetAssignedOrders；`order/type.d.ts` 加 AssignedOrder + PatchOrderParams.orderStatus 擴充；`driver/type.d.ts` 加 accuracy / lastActiveAt / activeOrder）；`upcoming/index.vue` _normalizeForPassenger 把 en_route / arrived_pickup 歸併為 in_transit
- [✅] **Stage 8**：`admin/war-room/index.vue` polish — markerMap unmount cleanup + heading null 改圓點 + 4 狀態 filter + busy driver 顯示 activeOrder + offline 半透明
- [✅] **Stage 9**：firestore.rules 不需動（server admin SDK bypass）
- [✅] **Stage 10**：docs/decision-log P19 條目 + tasks.md 更新

**P19 Stage Gate（spec [tasks.md:135-146](../openspec/changes/2026-05-09-p19-driver-trip-mission/tasks.md)）**：
- [✅] G1~G10 driver flow（授權 / 五階段 / busy / offline / war-room filter）
- [✅] G11 driver A 改 driver B 訂單 → 403：[orders/[orderId].patch.ts:135](../server/routes/nuxt-api/orders/%5BorderId%5D.patch.ts) `isAssignedDriver = isDriver && orderAssignedNormalized === auth.uid` + L138 `forbiddenError`，外加 L144 `body.assignedDriverId !== auth.uid → forbiddenError`
- [✅] G12 driver 跳階段 confirmed → completed → 400：[orders/[orderId].patch.ts:59](../server/routes/nuxt-api/orders/%5BorderId%5D.patch.ts) `DRIVER_NEXT_STATUS` 嚴格狀態機表 + L231 `if (expected !== body.orderStatus) badRequestError`

**P19 後續工作**（2026/05/12 部分整併進 P25）：
- ❌ **passenger 看自己訂單司機位置（driver 地圖中心追蹤）**：2026/05/13 Brain AI 決議**移除**，不在 roadmap 內
- 訂單推送通知（接單 / status 變更時推 LINE 訊息給乘客）— 待業務優先級確認
- → driver/dashboard online hours 統計：✅ **2026-05-13 已完成 P25-1**

> 註：driver/admin 端 i18n 多語化於 2026/05/09 由使用者決議移除（內部後台不需多語）

### P24：TDX 航班 GeneralSchedule 整合（2026/05/12 ✅ 完成 — Booking 階段排程驗證主資料源）

> 完整設計與 stage 拆解見 [`openspec/changes/2026-05-12-tdx-flight-integration/HANDOFF.md`](../openspec/changes/2026-05-12-tdx-flight-integration/HANDOFF.md)
>
> 接續前一輪 [`2026-05-10-flight-registry-tracker/HANDOFF.md`](../openspec/changes/2026-05-10-flight-registry-tracker/HANDOFF.md) Stage 3。

**Stage 進度**：
- [✅] **Stage 0**：HANDOFF spec 文件（commit `5b676ab`）
- [✅] **Stage 1**：[server/utils/tdx-flight.ts](../server/utils/tdx-flight.ts) helper（OAuth + 雙 endpoint + 4 條 validation + codeshare 雙向；commit `60b0c73`）
- [✅] **Stage 2**：[server/utils/flight-registry.ts](../server/utils/flight-registry.ts) 擴 tdx 子物件 + read/write helpers（commit `e667a28`）
- [✅] **Stage 3**：[server/api/flight.get.ts](../server/api/flight.get.ts) `_lookupFlight` 整合 TDX layer + 拔 Aviation Edge 調用（commit `bc66738`）
- [✅] **Stage 4**：docs/decision-log + tasks.md 更新（本 commit）

**驗證 4 條**：
1. flightNo 找得到（含 codeshare 雙向比對）
2. 至少一端機場在台灣（TPE / TSA / KHH / RMQ）
3. 用車日期在 EffectiveDate~ExpireDate 區間內
4. 用車日期當天的 ISO weekday 在該班的 WeekDays 內

任一不過 → 統一回 404 → UI 顯示既有 `notFound` 文案。

**Aviation Edge 處置**：
- booking 階段 helper 全保留在 [server/api/flight.get.ts](../server/api/flight.get.ts) 內，僅 `_lookupFlight` 不調用
- 等之後接「即時狀態查詢」階段（單筆訂單當天的 status / estimatedTime / actualTime / 延誤）才啟用，可能改成單獨 endpoint `/api/flight/realtime`

**待 user 部署後驗收**：
- [ ] 設定 Vercel env：`NUXT_TDX_CLIENT_ID` + `NUXT_TDX_CLIENT_SECRET`
- [ ] LIFF 實測：訂車 → 輸入 CI102（中華大航班）→ 應秒回；輸入未來 30 天日期應驗證 schedule
- [ ] LIFF 實測：輸入查不到的航班 → 顯示 `notFound`
- [ ] LIFF 實測：codeshare 案例（如 JL 與 CI 共用 TPE-NRT）兩個編號都能查到

---

### P23：Fleet 設定動態化（2026/05/11 ✅ 完成 — 計價參數 hardcode 退役）

> 完整設計與 tasks 見 `openspec/changes/2026-05-11-p23-fleet-admin-config/`：
> - `proposal.md`：背景、Firestore schema、SU 制設計、影響範圍
> - `HANDOFF.md`：Stage 進度、API ref、Store ref、7 個已知陷阱

**Stage 進度**：
- [✅] **Stage 1**（commit `3183f3c`）：Firestore 3 collection schema + `server/utils/fleet-config.ts` + 公開 GET + admin CRUD endpoints + auto-seed defaults
- [✅] **Stage 2-3**（commit `4668e06`）：`StoreConfig` Pinia store + plugin 啟動撈一次 + 8 個 caller 切換 + booking 行李 SU 制 UI + order schema (`luggageCount` → `luggageItems`)
- [✅] **Stage 4**：fleet 頁讀動態 config（併進 Stage 2）
- [✅] **Stage 5**（本 commit）：admin/settings 加 3 個 CRUD 區塊（車型 / 行李類型 / 加值服務），含三語 label 編輯
- [✅] **Stage 6**：driver/admin trip modal 顯示行李明細（併進 Stage 3）

**G5 驗收**：admin 可在 `/admin/settings` Fleet 區塊新增 / 編輯 / 啟用切換 / 刪除三種資源，乘客 booking 頁 reload 後即時看到變更生效

**後續 backlog**：
- admin 編輯後 real-time listener 推播給線上乘客（目前需 reload page）
- icon picker 進階 UI（目前單純字串輸入 mdi 名稱）
- 加值服務「按時計費 / 條件式定價」（目前單次定額）
- 多幣別（目前 TWD only）

---

### P20：Booking 表單擴充（乘客端收尾查驗時做）

**觸發時機**：使用者在乘客端做收尾查驗時一併處理

**為什麼需要**：P19 driver/trip modal 設計顯示「乘客電話 / 航班 / 航廈 / 備註」等欄位，但 booking 表單目前並未收集這些資訊：
- `contactPhone`（聯絡電話）— driver/trip modal 目前顯示「請透過 LINE 聯絡」placeholder
- `flightNumber`（航班編號）— 接送機情境必要
- `terminal`（航廈）— 接送機情境必要
- `notes`（備註）— 任何特殊需求

**待修改範圍**：
- `app/pages/booking/index.vue`：表單加 4 個欄位
  - 聯絡電話（必填，配合 P17 規範驗證 09xxxxxxxx 格式）
  - 航班編號（接送機才顯示，optional）
  - 航廈（接送機才顯示，optional）
  - 備註（textarea，optional，限 200 字）
- `server/routes/nuxt-api/orders/index.post.ts`：`CreateOrderBody` 接收上述欄位 + Firestore 寫入
- `app/protocol/fetch-api/api/order/type.d.ts`：`CreateOrderParams` type 補上欄位
- `i18n/locales/{zh,en,ja}.js`：對應 label / placeholder / 錯誤訊息（三語言對齊 P17 強制規範）
- 既有訂單資料**不影響**：新欄位 nullable，舊訂單顯示「—」即可

---

### P25：Driver / Admin 後續強化（2026/05/12 規劃，整合 P18 + P19 backlog）

> **背景**：P18 collection-split 與 P19 driver trip mission 完成後，drivers / admins schema 預留多個欄位但邏輯尚未實作。2026/05/12 與 Brain AI 對齊四項決議後彙整為 P25 統一規劃；分區管理（drivers.assignedRegions）已決議**移除**，不在此章節範圍。
>
> **觸發時機**：P24 TDX 部署驗收後啟動；P25-2（audit log）為**上線後 2 週內必補**，其餘依優先級排程。

**範圍總覽**：
| 子任務 | 優先級 | 狀態 | 說明 |
|--------|--------|------|------|
| P25-1 | P1 | ✅ 完成 | driver 統計 today 歸零 + online hours（合併實作，共用 todayResetAt） |
| P25-2 | **P0** | ✅ 上 prod `fe6ac8b` | admin operation audit log（19 種 AuditAction + 8 endpoint instrument + super-only `/admin/audit-logs`） |
| P25-3 | P3 | ⏳ 業務 5 問待拍板 | 司機評分系統（暫保留 schema，業務需求觸發再啟動） |
| P25-4 | P3 | ⏳ 依賴 P25-2 + use case | admins.permissions 細粒度 override UI（有單獨 use case 再做） |

---

#### P25-1：driver 統計 today 歸零 + online hours 合併實作（優先級 P1）— ✅ **2026-05-13 完成**

> **決議**：採用 lazy reset（方案 B），不依賴 Vercel Cron；today 歸零與 online hours 共用 `todayResetAt` 欄位避免雙寫。
>
> **完成範圍**：
> - [✅] [server/utils/driver-stats.ts](../server/utils/driver-stats.ts)：`maybeResetTodayPatch` / `settleOnlineSessionPatch` / `composeStatusTransitionPatch` / `computeTodayOnlineSeconds`（dayjs.tz('Asia/Taipei') 跨日判斷）
> - [✅] [PATCH /drivers/[id]/status](../server/routes/nuxt-api/drivers/%5Bid%5D/status.patch.ts)：driver/admin 切 online ↔ offline，busy 中拒絕
> - [✅] [orders/[orderId].patch.ts](../server/routes/nuxt-api/orders/%5BorderId%5D.patch.ts)：en_route → busy 結算 online 段；completed → 累加前先 maybeResetToday、無 remaining 訂單時切回 online 重啟 session
> - [✅] [drivers/available.get.ts](../server/routes/nuxt-api/drivers/available.get.ts)：fallback — online 且 lastActiveAt > 5min 視為 offline + lazy 結算（用 lastActiveAt 結算，不算「離線後」假時數）
> - [✅] [drivers/[id]/location.put.ts](../server/routes/nuxt-api/drivers/%5Bid%5D/location.put.ts)：heartbeat 順便檢查跨日歸零（30s 一次，最遲過 00:00 後 30s 歸零）
> - [✅] [drivers/[id]/stats.get.ts](../server/routes/nuxt-api/drivers/%5Bid%5D/stats.get.ts)：回傳 `todayOnlineSeconds`（含當前 session live delta）+ `status`
> - [✅] [driver/dashboard/index.vue](../app/pages/driver/dashboard/index.vue)：ONLINE HRS 顯示 + 上下線開關（busy 中禁用）+ 60s polling

**Schema 擴充**：
- `drivers/{lineUid}` 新增 4 個欄位：
  - `todayResetAt: Timestamp`（最近一次 today 系列歸零時間，台北日期判斷依據）
  - `currentOnlineSessionStartAt: Timestamp | null`（當前 online 段起點；offline / busy 為 null）
  - `todayOnlineSeconds: number`（今日累計上線秒數，已結束的 online 段累加）
  - `totalOnlineSeconds: number`（累計上線秒數）

**Lazy Reset 邏輯**：
- 共用 helper `server/utils/driver-stats.ts`：`maybeResetToday(driverDoc): { resetNeeded, patch }`
  - 比對 `todayResetAt` 的 `dayjs().tz('Asia/Taipei').format('YYYY-MM-DD')` 與今天是否相同
  - 不同 → 回傳 `patch = { todayTrips: 0, todayEarnings: 0, todayOnlineSeconds: 0, todayResetAt: now }`
- 所有 today 系列寫入入口（completed 訂單、status 切換）都先過此 helper

**Online Hours 狀態機**：
- 新增 endpoint `PATCH /nuxt-api/drivers/[id]/status`（自己 or admin 可改）
  - online → busy / offline：計算 `delta = now - currentOnlineSessionStartAt`，`todayOnlineSeconds += delta`、`totalOnlineSeconds += delta`、`currentOnlineSessionStartAt = null`
  - offline → online：先過 maybeResetToday，再 `currentOnlineSessionStartAt = now`
  - busy → online：恢復計時，`currentOnlineSessionStartAt = now`（busy 期間不計入 online hours）
- 整合 P19 五階段：`orders/[orderId].patch.ts` 訂單 en_route → busy 時要結算當前 online 段；completed → online 時要恢復計時

**UI 對齊**：
- `app/pages/driver/dashboard/index.vue:25` 移除 hardcode `'0'`，改為 computed：
  - 若 `status==='online'` → `(now - currentOnlineSessionStartAt + todayOnlineSeconds) / 3600`
  - 否則 → `todayOnlineSeconds / 3600`
  - 每 60s 刷新一次（已有頁面 polling 機制可複用）
- `app/pages/driver/dashboard/index.vue` today trips / today earnings 也讀新欄位

**Fallback 機制**（driver 忘了按下線就關 app）：
- `drivers/available.get.ts` 讀取時，若 `status==='online'` 且 `lastActiveAt > 5 分鐘前` → 視為 offline、強制結算 online 段（lazy 寫回）
- 與 P19 已存在的 offline 推導邏輯整合

**驗證項**：
- G25-1-1：driver 0:00 後第一次接單，todayTrips 從 0 開始累加（非接續昨日）
- G25-1-2：driver 上線 1 小時 → busy 1 小時 → 下線，online hours = 1 小時（busy 期間不計）
- G25-1-3：driver online 後關 app 不下線，5 分鐘後自動結算
- G25-1-4：日期跨越時點正確（夏令時間 N/A，台北無夏令）

---

#### P25-2：Admin Operation Audit Log（優先級 **P0**）— ✅ **已完成上 prod（commit `fe6ac8b` 2026-05-12）**

> **背景**：目前 admin 在後台所有操作（核准司機、撤銷管理員、改訂單狀態、廣播 LINE、改加值服務）完全無紀錄。多 admin 並存後立即會成痛點。
>
> **完成狀態**（commit `fe6ac8b`）：
> - [✅] [server/utils/audit-log.ts](../server/utils/audit-log.ts) `writeAuditLog` helper（19 種 AuditAction、payload mask SENSITIVE_KEYS、actorDisplayName 快照、用 await 不 fire-and-forget — Vercel serverless 砍未完成 promise 解法）
> - [✅] 8 個 admin mutating endpoint 已 instrument：`admin/admins/[uid].patch`、`admin/users/[uid].patch`、`admin/broadcast.post`、`admin/config/[resource]/{index.post,[id].put,[id].delete}`、`admin/orders/[orderId]/notify.post`、`orders/[orderId].patch`（admin 操作才 log）
> - [✅] [server/routes/nuxt-api/admin/audit-logs/index.get.ts](../server/routes/nuxt-api/admin/audit-logs/index.get.ts) super-only GET + filter + cursor pagination
> - [✅] [app/pages/admin/audit-logs/index.vue](../app/pages/admin/audit-logs/index.vue) 列表頁（篩選 + 展開行看 payload/ip/UA）
> - [✅] [app/layouts/back-desk.vue](../app/layouts/back-desk.vue) nav 加「操作日誌」（superOnly flag）
> - [✅] firestore.rules audit_logs client 全禁 + 三語 i18n
> - [✅] Firestore 複合索引首次查詢自動提示建立（actorUid+createdAt / action+createdAt / targetType+targetId+createdAt）

**Collection Schema**：
- `audit_logs/{autoId}`：
  ```typescript
  {
    actorUid: string;                 // 操作者 lineUid
    actorDisplayName: string;          // 快照（避免後續 admin 改名導致歷史失準）
    actorLevel: 'super' | 'admin' | 'assistant';
    action: AuditAction;               // 列舉值，見下
    targetType: 'driver' | 'admin' | 'order' | 'broadcast' | 'fleet';
    targetId: string;                  // 被操作對象 ID
    payload: Record<string, unknown>;  // before/after diff（敏感欄位需 mask）
    ip?: string;                       // 從 event headers 取
    userAgent?: string;
    createdAt: Timestamp;
  }

  type AuditAction =
    | 'driver.approve' | 'driver.reject' | 'driver.unblock_cooldown' | 'driver.category_change'
    | 'admin.add' | 'admin.remove' | 'admin.level_change' | 'admin.permissions_override'
    | 'order.assign' | 'order.status_change' | 'order.cancel_by_admin'
    | 'broadcast.send'
    | 'fleet.vehicle_update' | 'fleet.luggage_update' | 'fleet.extra_update' | 'fleet.delete';
  ```

**實作範圍**：
- 新建 `server/utils/audit-log.ts`：`writeAuditLog(event, action, targetType, targetId, payload)` helper
  - 自動從 event 抓 actor（require-auth context）、IP、UA
  - fire-and-forget 失敗 console.error 不阻擋主流程（避免 audit 寫失敗導致業務失敗）
- 全部 admin 端會改資料的 endpoint 加入呼叫（盤點 ~10 個）：
  - `admin/users/[uid].patch.ts`（含 add/remove role、level、permissions、driverCategory、approve/reject）
  - `admin/admins/[uid].patch.ts`
  - `admin/broadcast.post.ts`
  - `admin/orders/[orderId].patch.ts`（指派司機、改狀態）
  - `admin/fleet/vehicles/*` + `luggage/*` + `extras/*`（P23 加值服務 CRUD）
- 新建 `server/routes/nuxt-api/admin/audit-logs/index.get.ts`（super only，支援 actor / action / target / date range 篩選 + cursor pagination）
- 新建 `app/pages/admin/audit-logs/index.vue`（super only；表格顯示最近 200 筆，搭配篩選器）
- `app/layouts/back-desk.vue` 抽屜加「操作日誌」入口（僅 super 可見）

**Firestore Rules**：
- `audit_logs/{logId}`：client 全部禁止；僅 server admin SDK 讀寫

**索引**：
- 至少建立 `actorUid + createdAt desc`、`action + createdAt desc`、`targetType + targetId + createdAt desc` 三組複合索引

**保留策略**：
- 暫時無刪除策略（單筆 doc 約 1-2 KB，1 年累積估算 < 50 MB；先觀察）
- 後續若量大可加 Cloud Function 月歸檔至 Storage

**驗證項**：
- G25-2-1：super admin 撤銷另一個 admin → audit_logs 出現 `admin.remove` 紀錄
- G25-2-2：assistant 嘗試讀 audit-logs → 403
- G25-2-3：audit 寫失敗（Firestore 故障）不影響主操作回 200
- G25-2-4：payload 內 sensitive 欄位（如 LINE token）已 mask

---

#### P25-3：司機評分系統（優先級 P3，暫保留 schema）

> **決議**：2026/05/12 決定**暫保留**功能規劃，業務需求觸發後再啟動實作。schema 已預留 `drivers.rating / ratingCount`，目前 server 不寫入。
>
> **業務 5 問待確認**（啟動前需先回答）：
> 1. 誰評？乘客單向 or 雙向？
> 2. 何時評？訂單 completed 後彈窗 or 可在 /orders 補評？是否可跳過？
> 3. 評什麼？整體 1-5 星 or 分項（準時 / 態度 / 車況）？
> 4. 誰看得到？admin only or 乘客訂車前能看？
> 5. 文字評論？匿名與否？

**預期實作範圍**（先記錄供未來實作）：
- 新建 collection `ratings/{orderId}`：`{ orderId, driverLineUid, passengerLineUid, score: 1-5, comment?, createdAt }`
- `orders` schema 加 `ratingId?: string`（防重複評）
- 後端 `POST /nuxt-api/ratings`：transaction 寫 ratings doc + 更新 `drivers.rating`（移動平均）
- 乘客端 `/orders` completed 訂單加「評分」按鈕
- admin 端 `/admin/drivers` 司機卡片顯示平均評分

---

#### P25-4：admins.permissions 細粒度 override UI（優先級 P3）

> **背景**：P18 Stage 2 已寫好 `hasPermission` 支援 `admins.permissions` override，但目前無 UI 寫入，等同未啟用。

**使用場景**：
- assistant 臨時要幫忙審核 driver → super 單獨給他 `canManageDrivers: true`，不升 admin
- admin 是行銷專員不該看金流 → super 給他 `canViewFinance: false` 蓋掉 level 預設

**實作範圍**：
- `app/pages/admin/settings/index.vue` admin tab，每個 admin row 旁加「進階權限」展開按鈕
- 展開後 5 個 checkbox（對應 5 個 Permission，預設值為 level 對應結果）
  - 未動 checkbox → permissions 寫 null（走 LEVEL_TABLE）
  - 勾掉或勾起 → permissions: { [perm]: false | true }
- 後端 `admin/admins/[uid].patch.ts` body 加 `permissions: Partial<Record<Permission, boolean>> | null`
- 與 P25-2 audit log 整合：override 變更寫 `admin.permissions_override` action

---

**P25 已決議移除項目**：
- ❌ **分區管理（drivers.assignedRegions）**：2026/05/12 決議不需要此功能
  - schema 欄位保留以避免破壞既有 doc，但 [openspec/changes/2026-05-09-collection-split/design.md](../openspec/changes/2026-05-09-collection-split/design.md) 需補註 `@deprecated`
  - require-auth / require-permission / drivers endpoints 完全不引用此欄位

**Stage 排程建議**：
- 上線後第 1~2 週：P25-2（audit log）
- 上線後第 2~3 週：P25-1（today 歸零 + online hours）
- 業務需求觸發再啟動：P25-3 / P25-4

---

### P27：driverApplication users → drivers 搬遷（2026/05/12 Stage A 完成）

**背景**：P18 collection split 當時只搬了 driverCategory；driverApplication 整包仍留在 users，造成 driver 資料散在 users / drivers 兩處。P26 driver profile editor 開工前需先搬好，避免雙讀兼容碼污染。

**目標**：
- `users/{uid}.driverApplication` → `drivers/{uid}.application`
- 22 檔讀寫 reference 切換
- 一次性 migration script + idempotent 設計

**Stage A 完成項目（2026/05/12）**：
- [✅] server/utils/driver-application.ts — readDriverApplication + batchReadDriverApplications helper
- [✅] AuditAction 加 'migration.driver_application_move' + AuditTargetType 加 'migration'
- [✅] driver/apply.post.ts 寫入 target 改 drivers.application；冷卻檢查走 helper dual-read
- [✅] admin/users/[uid].patch.ts dot-path 改寫 drivers.application.*
- [✅] admin/users/index.get.ts list 改 batch dual-read（drivers 優先 users fallback）
- [✅] app/stores/5.store-auth.ts client SDK 也走 dual-read
- [✅] scripts/migrate-driver-application-to-drivers.mjs — 一次性 migration（支援 --dry-run / --apply）
- [✅] storage.rules / driver/upload.post.ts / auth/line-exchange.post.ts 註解更新

**Stage B 完成項目（2026/05/12 同日）**：
- [✅] `pnpm migrate:driver-app --dry-run` 驗證影響筆數（scanned 2 / migrated 2 / 0.37s）
- [✅] `pnpm migrate:driver-app --apply` 執行 prod 搬遷（migrated 2 / failed 0 / 0.63s）
- [✅] Firebase Console 抽查 users/drivers + audit_logs；prod admin/drivers 列表資料完整顯示
- [✅] 移除 server/utils/driver-application.ts 內 users fallback；整個刪除 batchReadDriverApplications
- [✅] 移除 store-auth.ts 內 data.driverApplication fallback
- [✅] 移除 admin/users/index.get.ts 內 driversMissingApp fallback block + import
- [✅] apply.post.ts 註解修正（移除 Stage A dual-read 提及）

**完成後解鎖**：P26 driver profile editor 開工

---

**使用規則**
- 每完成一個子任務，立即更新狀態（[ ] → [✅] 或 [🔄]）
- 重大決策必須同步記錄至 docs/decision-log.md
- P12 為 2026/05/08 新增，P13 同日 storage 修復，P14 / P15 為 2026/05/09 新增（上線安全修復、路由整理、silent failure），P16 為暫緩清單，P17 為乘客端完善，P25 為 2026/05/12 新增（driver/admin 後續強化），P27 為 2026/05/12 新增（driverApplication 搬遷，P26 前置）

**版本紀錄**
- 版本：v3.16（P25-1 today 歸零 + online hours 完成；P32 加好友橫幅 vs Hero 重疊修正；P19 driver 地圖中心追蹤決議移除）
- 更新日期：2026/05/13
