# 決策紀錄 (Decision Log)

每次重大決策或新增套件時，必須立即更新此檔案（時間由新到舊）。

格式：**日期** / **類型** / **標題** / **背景** / **決定** / **影響** / **替代方案**

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
