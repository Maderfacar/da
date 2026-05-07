# 專案任務清單 (Project Tasks & Backlog)

**總進度**：Stage 7 維護迭代中（P0~P6 完成，P7/P8/P10 進行中）
**最後更新**：2026/05/07

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

- [✅] **n8n 桃園機場 XLS 爬取**（已全面重構）：
  - ~~Firestore `airport_flow_forecast`~~ → **改用 GitHub Gist** 儲存（每日一檔 JSON）✅
  - Server `GET /api/airport/flow` 改讀 Gist raw URL，支援 `date` / `terminal` / `direction` query ✅
  - n8n workflow 重構（`n8n-workflow-taoyuan-xls.json`）：
    - 排程改為**每小時**執行（原每日 17:00）✅
    - 每次同時處理**今日與明日**兩個日期（SplitInBatches，下載失敗自動跳過）✅
    - hours 改存 arrival / departure / all 三筆，前端方向篩選有真實數據 ✅
    - 執行結束後**自動刪除 7 天前** Gist 檔案（PATCH null）✅
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

### P8：司機申請流程改造（2026/05/06 進行中）

> **背景**：原 `/driver/auth` 流程對未註冊使用者直接寫入 `role: 'driver', approved: false` 後又被 middleware 導回 `/`，使用者無從得知申請狀態。重新設計為「passenger 預設 → 主動申請 → admin 審核」標準三段流程，並新增 1 天冷卻避免轟炸申請。

**P8-1：後端架構修正**
- [ ] 修 `server/routes/nuxt-api/auth/line-exchange.post.ts`：新使用者一律建為 `role: 'passenger'`（移除 `clientType=driver` 的 driver 預設邏輯）
- [ ] 修 `app/middleware/role.ts`：`/driver/register` 路徑放行（passenger 與未核准 driver 都可進）
- [ ] 修 `app/stores/5.store-auth.ts`：`_LoadRoleFromFirestore` 讀取 `driverApplication`（含 `rejectedAt`、`appliedAt`）

**P8-2：申請頁面**
- [ ] 新建 `app/pages/driver/register/index.vue`，三模式渲染：
  - `role=passenger / null` → 申請表單
  - `driver + !approved + !rejectedAt`（或 `rejectedAt` 已過 24h）→ 「審核中」提示
  - `rejectedAt` 在 24h 內 → 「冷卻中」剩餘時間倒數
- [ ] 表單欄位：司機真實姓名、聯絡電話、車牌號、車型（sedan/mpv/suv/van，中英對照）、銀行代號、銀行帳號
- [ ] 4 個圖片上傳欄位：駕照、行照、保險卡、良民證（皆必填）
- [ ] 新建 `app/components/driver/RegisterUploadField.vue`：拖放上傳 + 預覽 + 進度

**P8-3：申請與圖片上傳 API**
- [ ] 新建 `server/routes/nuxt-api/driver/upload.post.ts`：multipart → Firebase Storage `drivers/{uid}/{docType}-{timestamp}.{ext}` → 回傳 download URL
- [ ] 新建 `server/routes/nuxt-api/driver/apply.post.ts`：驗證冷卻 → 寫入 `users/{uid}.driverApplication` + 改 `role='driver', approved=false, driverCategory='0'`
- [ ] 新增 protocol：`app/protocol/fetch-api/api/driver/index.ts` 加入 `ApplyDriver`、`UploadDriverDocument`

**P8-4：登入後分流**
- [ ] 修 `app/pages/driver/auth/index.vue` 導向四分支：
  - `driver + approved=true` → `/driver/dashboard`
  - `driver + approved=false` → `/driver/register`
  - `passenger / null` → `/driver/register`
  - `admin` → `/admin/orders`

**P8-5：Admin 審核強化**
- [ ] 修 `app/pages/admin/drivers/index.vue` 加「待審核 / 已核准 / 已拒絕」三分頁
- [ ] 司機卡片可展開檢視 `driverApplication` 完整資料 + 4 張證件圖片
- [ ] 「拒絕」按鈕：寫入 `rejectedAt = now`、`rejectReason`
- [ ] 「解除冷卻」按鈕（僅對 `rejectedAt` 在 24h 內者顯示）：清空 `rejectedAt`
- [ ] 新增 API `PATCH /nuxt-api/admin/users/[uid]` 支援 `approved`、`rejectedAt`、`driverCategory`

**P8-6：權限規則**
- [ ] Firebase Storage Rules：`drivers/{uid}/*` 只允許 owner 上傳、admin 讀取
- [ ] Firestore Rules：`users/{uid}.driverApplication` 只允許 owner 寫、admin 讀寫

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

**Stage Gate（P10）**：
- lint ✅ / build 待 Vercel 部署驗證
- 實機：admin 從乘客端可看到 ADMIN 切換鈕、approved driver 在乘客端可看到 DRIVER 切換鈕
- admin / approved driver 可進入乘客端訂車流程不會被踢出

---

**使用規則**
- 每完成一個子任務，立即更新狀態（[ ] → [✅] 或 [🔄]）
- 重大決策必須同步記錄至 docs/decision-log.md
- P7 / P8 / P9 為 2026/05/06 新增工作項，P10 為 2026/05/07 新增

**版本紀錄**
- 版本：v3.4（Stage 7 P10 roles[] 多角色遷移完成）
- 更新日期：2026/05/07
