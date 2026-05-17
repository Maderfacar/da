# 管理員自動通知 + Admin Dashboard — Tasks

## 開工前 prerequisite

- [x] **Brain AI 拍板 design.md 結尾 4 個決策點（D1–D4）** — 全照預設：D1=推、D2=A、D3=依各 admin lang、D4=任何 admin role
- [ ] 確認測試環境至少 1 位 admin 已加 passenger OA 為好友（否則推播驗證無對象）— 手動環境檢查，留給 prod 驗證

## Phase 1：Admin 推播基礎建設（約 1.5 hr）

### 1.1 收件人解析 util
- [x] 1.1.1 新增 `server/utils/admin-recipients.ts`
  - `adminDocHasPermission(data, perm)` — 純函式，對齊 `require-permission.ts` 的 `LEVEL_TABLE` + override 邏輯
  - `getAdminRecipients(db, perm)` — `.get()` 全表 → filter → 回傳 lineUid 陣列
- [x] 1.1.2 單元測試 `server/utils/admin-recipients.spec.ts`
  - level × permissions override 矩陣（super / admin / assistant、override true/false、level 缺失）— 9 tests pass

### 1.2 推播分派 util
- [x] 1.2.1 新增 `server/utils/notify-admins.ts`
  - `notifyAdmins(db, key, params)` — 解析收件人 → `Promise.allSettled` 逐一取各 admin lang → `sendLinePush('passenger', uid, msgs)`
- [x] 1.2.2 確認 `sendLinePush` / `LineMessage` 由 `server/utils/line-push.ts` 正確 import

### 1.3 文案 helper
- [x] 1.3.1 admin 通知文案三語表（`adminNotify.{orderCreated,orderStatusChanged,driverApplied}`）
  - 變更：admin 通知為 LINE push-only，前端不渲染；依 design §3.4「沿用既有 i18n message 機制」，
    放 server 端 `server/utils/admin-notify-message.ts`（對齊 `i18n-message.ts` 模式），未進 `i18n/locales/`
- [x] 1.3.2 三語對齊（zh_tw / en / ja）— 同上於 `admin-notify-message.ts`
- [x] 1.3.3 `orderStatus` 三語名稱 — i18n/locales 原本不存在，於 `admin-notify-message.ts` 新增 7 狀態三語表
- [x] 1.3.4 server 端取文案 helper `getAdminNotifyText`（取 admin lang → 組 text，fallback `zh_tw`；沿用 `getUserLang`）
  - 額外：pickup / driverName 為使用者輸入，組字前 `sanitizeText` 淨化（移除控制字元 / 零寬字元 + 截斷 100 字）

## Phase 2：三個觸發點接入（約 1.5 hr）

> 每個接入點都以 `void (async () => { try { ... } catch {} })()` 包裹，置於主資料寫入成功後，與既有乘客/司機推播並列。

- [x] 2.1 `orders/index.post.ts` — 訂單寫入成功後加 admin 通知（`adminNotify.orderCreated`）
- [x] 2.2 `admin/orders/index.post.ts` — 手動建單加 admin 通知（D1：推）
- [x] 2.3 `orders/[orderId].patch.ts` — `ref.update` 成功後加 admin 通知（`adminNotify.orderStatusChanged`，帶 from→to）
- [x] 2.4 `driver/apply.post.ts` — `driverRef.set` 成功後加 admin 通知（`adminNotify.driverApplied`）
- [x] 2.5 確認四處皆 fire-and-forget，主流程回應不被阻塞（code review 確認雙層錯誤保護）

## Phase 3：Dashboard API（約 1 hr）

- [x] 3.1 新增 `server/routes/nuxt-api/admin/dashboard/online.get.ts`
  - `getAuthFromEvent` + admin role 檢查（D4：任何 admin role）
  - `cutoff = now - 5min`，`Promise.all` 查 `users.lastSeenAt >=` 與 `drivers.lastActiveAt >=`
  - 回傳 `{ passengers:{count,list}, drivers:{count,list}, generatedAt }`，統一響應格式；list 依活躍時間 desc 排序
  - null 欄位轉空字串（後端規範）
- [x] 3.2 新增前端 API 定義 `app/protocol/fetch-api/api/admin/dashboard/`（`GetDashboardOnline`）+ `admin/index.ts` export
- [x] 3.3 補型別 `OnlineUser` / `OnlineDriver` — 依 line-event-log 慣例放於 protocol 模組 `type.d.ts`（非 `types/`，`types/` 僅有 nuxt.d.ts）

## Phase 4：Dashboard 頁面與導覽（約 1.5 hr）

- [x] 4.1 新增 `app/pages/admin/dashboard.vue`
  - back-desk layout，Pug template + SCSS scoped，SFC 結構依 CLAUDE.md
  - 線上乘客卡 + 線上司機卡（數量 + 名單：頭像/名稱/相對活躍時間）
  - `ApiGetOnline` + 30 秒輪詢，`onUnmounted` 清 interval
  - 載入 / 空 / 錯誤狀態
  - 顯示「資料時間」（generatedAt）
- [x] 4.2 `app/layouts/back-desk.vue` `ALL_NAV_ITEMS` 新增 dashboard 項（置選單最前）
- [x] 4.3 i18n `adminDashboard.*` 三語鍵（標題、卡片標籤、空狀態文案）

## Phase 5：驗證（約 1 hr）

- [x] 5.1 `pnpm lint` 乾淨
- [~] 5.2 vue-tsc 型別檢查 — 本變更伺服器端 .ts 全零錯誤；專案 baseline 已有 ~1695 個 vue-tsc 錯誤
       （Pug `v-for` 變數解析 false-positive，既有每個 Pug 頁面同類）；真正型別 gate 為 `pnpm build`
- [x] 5.3 `pnpm test` — 新增單元測試通過（77 tests pass，含新增 9 tests）
- [x] 5.4 `pnpm build` 成功
- [ ] 5.5 手動驗證（`pnpm dev`）— 需測試裝置 + admin 已加 passenger OA 好友，留給 prod 驗證：
  - [ ] 乘客下單 → 具 canManageOrders 的 admin 收到 LINE
  - [ ] admin 改訂單狀態 → admin 收到（含操作者本人）
  - [ ] 司機提交申請 → admin 收到
  - [ ] `assistant` level（有 canManageOrders）會收到；移除該權限 override 後不收
  - [ ] `/admin/dashboard` 顯示線上乘客 / 司機名單，30 秒刷新
- [x] 5.6 code-reviewer + security-reviewer agent 審查 — 0 CRITICAL / 0 HIGH，APPROVE；
       MEDIUM（user input 嵌入 LINE 文字）已於 1.3.4 sanitizeText 修正
- [x] 5.7 firestore rules — 新 API 走 admin SDK 繞過 rules，`users`/`drivers`/`admins` 讀取不受影響，無需改 rules

## 部署

- [ ] commit（Conventional Commits 繁中）
- [ ] push main → Vercel 部署
- [ ] prod 驗證三事件推播 + dashboard
- [ ] 更新 `docs/tasks.md` 進度、archive 本變更
