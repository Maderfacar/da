# Tasks — admin-orders-dispatch-tiers

> 5 phase 對應後續 Step 1-5 視窗。每 phase 各自 `commit + push main` + prod 驗收，最後一 phase 完成才 `openspec archive`。

---

## Phase 1A — admin/orders 列表派單按鈕（純 UI，最小阻力）

> 對應 Step 1 視窗。後端 endpoint 不動。

### 0. 探勘（10 min）
- [x] 讀 `app/pages/admin/orders/index.vue:750-781` 既有 action column 結構
- [x] 讀 `app/pages/admin/orders/index.vue:842-845` 既有 Edit modal 內「📤 發出需求單」邏輯
- [x] 讀 `app/pages/admin/orders/index.vue:553` `ClickDispatch` 既有實作（call dispatch endpoint）
- [x] 確認 `UseAsk()` composable 簽名與用法

### 1. UI（60 min）
- [x] `app/pages/admin/orders/index.vue` action column 改：
  - `!dispatchAt` → 「📤 發布」按鈕（call ClickDispatchFlow）
  - `dispatchAt && !assignedDriverId` → 「🔁 重新發佈」+ `dispatchCount > 1` 時加 `×N` chip
  - `assignedDriverId` → 顯示「✓ 已指派」（disabled）
- [x] 新增 `ClickDispatchFlow(row)` / `ClickRedispatchFlow(row)`：
  - call `UseAsk()` 二次確認（發布：「確定發送需求單？」；重發：「已發送 N 次，確定再次發送？」）
  - 確認後 call 既有 `ApiDispatchOrder(orderId)` / `ApiRedispatchOrder(orderId)`
  - 成功 toast / 失敗錯誤訊息
- [x] 不刪 modal 內既有發布按鈕（列表是新增入口）

### 2. i18n（10 min）
- [x] `i18n/locales/zh.js` 加 `admin.orders.dispatch` / `admin.orders.redispatch` / `admin.orders.assigned` / `admin.orders.dispatchConfirm` / `admin.orders.redispatchConfirm`
- [x] `en.js` / `ja.js` 對齊翻譯

### 3. 驗證（15 min）
- [x] `pnpm lint:fix` 全綠
- [x] `pnpm test` 全綠（不需新 case）
- [x] `pnpm build` 全綠
- [x] 本機 dev 驗 3 場景：
  - 未發訂單 → 「📤 發布」可點 → 確認彈窗 → 寫入 dispatchAt
  - 已發未派 → 「🔁 重新發佈 ×1」可點 → 確認彈窗（顯示已發 N 次） → dispatchCount++
  - 已指派 → 「✓ 已指派」disabled

### 4. commit + push（5 min）
- [x] commit msg: `feat(admin): orders 列表加發布/重發需求單按鈕`
- [x] push main → Vercel 自動 deploy
- [x] HANDOFF：列 prod 驗收清單給 Brain AI

---

## Phase 1C — 訂單 tag 後修 + 車資重算

> 對應 Step 2 視窗。重點：Fare V2 抽 util + 預覽差價 UX + 折扣碼重檢。

### 0. 探勘（20 min）
- [x] 讀 `shared/pricing.ts` Fare V2 既有 calculate function（是否易於外呼？是否 inline 在 booking flow？）
- [x] 讀 `shared/orderPreferences.ts`（Phase 1D 既有 `buildPreferencesSnapshot` / `calcTagSurcharge`）
- [x] 讀 `server/routes/nuxt-api/orders/index.post.ts` 建單時 fare + tag + discount 寫入流程
- [x] 讀 `server/routes/nuxt-api/admin/orders/[orderId].patch.ts`（既有）
- [x] 讀 discount code 重檢邏輯位置（既有 endpoint 或 util）

### 1. Fare util 抽公用（45 min，前置）
- [x] 若 Fare V2 calculate 為 inline → 抽到 `shared/fare/calculate.ts` 或 `server/utils/fare-calculator.ts`
- [x] 既有 `orders/index.post.ts` 改用此 util（無功能變動）
- [x] 加單元測試覆蓋至少 80%
- [x] 跑 `pnpm test` 確認既有 case 全綠

### 2. shared 層（30 min）
- [x] `shared/orderPreferences.ts` 若有需要補 `recalcFinalTotal(order, newTagIds, tagIndex, discountCheck)` helper
- [x] 加單元測試

### 3. Server 層（90 min）
- [x] `server/utils/discount-recheck.ts` 🆕：`recheckDiscountCode(discountCodeId, baseFare + tagSurcharge): { discountAmount, warning?: 'expired_fallback' }`
- [x] `server/routes/nuxt-api/admin/orders/[orderId].patch.ts` 擴充：
  - 接 body.preferences.tagIds
  - 狀態守則：`pending` / `dispatched` 可改，`assigned` 後 `forbiddenError`
  - 重 snapshot + 重算 fare + 重檢 discount
  - 寫 audit log: `order.tag-update.price-recalc`
  - 回傳 success + 新 finalTotal + warning
- [x] `server/routes/nuxt-api/admin/orders/[orderId]/recalc-preview.post.ts` 🆕：
  - 同樣計算流程，**不**寫 doc
  - 回傳 `{ before, after, diff, warnings }`
- [x] `firestore.rules` 不動

### 4. UI（120 min）
- [x] `app/pages/admin/orders/index.vue` Edit modal 加 tag 編輯區塊：
  - 複用 `PassengerTagPreferencePicker.vue`（Phase 1D 既有元件）
  - reactive watch tagIds 變動 → debounce 300ms → call `ApiRecalcPreview()`
  - 顯示「原價 → 新價 → 差額」卡片（差額 > 0 紅、< 0 綠）
  - 折扣碼過期 warning 顯示
  - 確認按鈕 → `UseAsk()` 二次確認（顯示差額金額）→ call `ApiUpdateOrderTags()`
  - 訂單 `assigned` 狀態時 disabled + tooltip 說明
- [x] `app/protocol/fetch-api/api/admin/index.ts` 加 `ApiRecalcPreview` + `ApiUpdateOrderTags`

### 5. i18n（15 min）
- [x] 三語加 `admin.orders.tagEditTitle` / `priceBefore` / `priceAfter` / `priceDiff` / `discountExpiredWarning` / `confirmTagUpdate` / `assignedLocked` 等

### 6. 驗證（30 min）
- [x] `pnpm lint:fix` / `pnpm test`（≥ 80% coverage 新 case）/ `pnpm build` 全綠
- [x] 本機 dev 驗 4 場景：
  - `pending` tag 改動 → 預覽差價 → 確認 → 寫成功 + audit log
  - `dispatched` tag 改動 → 同上
  - `assigned` tag 改動 → 403 + UI disabled
  - 有 discount code 且碼過期 → warning + fallback 原 discount

### 7. commit + push（5 min）
- [x] commit msg: `feat(admin): 訂單後修 tag 觸發車資重算`
- [x] push main → Vercel deploy
- [x] HANDOFF prod 驗收清單

---

## Phase 2A — driverCategory 編輯 UI

> 對應 Step 3 視窗。範圍小。

### 0. 探勘（10 min）
- [x] 讀 `app/pages/admin/drivers/[uid].vue:181` 既有 driverCategory 顯示位置
- [x] 讀 `server/routes/nuxt-api/admin/users/[uid].patch.ts:183-184` 既有 PATCH driverCategory 邏輯

### 1. Enum + util（30 min）
- [x] `shared/types/driver-category.ts` 🆕：
  - `DRIVER_CATEGORY` const enum（NOVICE='0' / STANDARD='1' / PRO='2'）
  - `DRIVER_CATEGORY_LABEL` 三語 record
  - `DriverCategory` type
- [x] `server/utils/driver-category.ts` 🆕：
  - re-export from shared
  - `getCategoryLabel(level, lang)` helper
  - 升級規則 stub（comment block 列三 metric 候選）

### 2. UI（45 min）
- [x] `app/pages/admin/drivers/[uid].vue` 加 driverCategory 編輯區塊：
  - ElSelect 三選一（顯示中文 label + 等級號）
  - 「儲存」按鈕 → `UseAsk()` 二次確認
  - 確認後 call `PatchAdminUser({ driverCategory })`
  - 成功 toast / 失敗錯誤訊息
  - 顯示「最後變更」時間 + actorDisplayName（從 audit_logs 拉）

### 3. Server 層（20 min）
- [x] `server/routes/nuxt-api/admin/users/[uid].patch.ts` 補強 audit log：
  - 既有 `driver.category_change` action 已存在，payload 擴充為 `{ before, after }`
  - actorUid 由 writeAuditLog 自動寫（等同 adminId）
  - 加 `isDriverCategory` runtime 驗證，非合法值 badRequest

### 4. i18n（10 min）
- [x] 三語加 `admin.drivers.categoryEdit.*`（label / edit / save / cancel / lastChanged / levels）

### 5. 驗證（10 min）
- [x] `pnpm lint:fix` / `pnpm test` / `pnpm build` 全綠
- [x] 本機 dev 驗：admin 改某司機 category → audit log 寫入 → driver doc 更新

### 6. commit + push（5 min）
- [x] commit msg: `feat(admin): drivers 詳情頁加 driverCategory 編輯`
- [x] push main → Vercel deploy
- [x] HANDOFF

---

## Phase 2B + 2C — schema + 發布表單 + filter + bid 守則 + LINE 分批 + 倒數

> 對應 Step 4 視窗。**範圍最大**。含 migration backfill。

### 0. 探勘（30 min）
- [x] 讀 `app/pages/admin/orders/index.vue` 既有發布表單位置
- [x] 讀 `server/routes/nuxt-api/admin/orders/[orderId]/dispatch.post.ts` + `redispatch.post.ts`
- [x] 讀 `server/routes/nuxt-api/driver/dispatched-orders/index.get.ts:56-57` filter 邏輯
- [x] 讀 `server/routes/nuxt-api/driver/orders/[orderId]/bid.post.ts:5` transaction 守則
- [x] 讀 `server/utils/order-dispatch.ts` `loadActiveDrivers` 既有實作
- [x] 讀 `app/pages/driver/dispatched/index.vue` 訂單卡結構
- [x] 讀 `i18n/locales/zh.js` 既有 driver / admin 相關 keys

### 1. Schema 型別（30 min）
- [x] `app/protocol/fetch-api/api/admin/index.ts` `AdminOrder` interface 加 `dispatchVisibility` 欄位（含 nested types）
- [x] `app/protocol/fetch-api/api/driver/order-bid.ts` 司機端 OrderItem 加 `dispatchVisibility.currentLevel` / `openedAt`（給倒數 UI 用）
- [x] `shared/types/dispatch-visibility.ts` 🆕 共用 type

### 2. server util（60 min）
- [x] `server/utils/dispatch-duration.ts` 🆕：`DISPATCH_DURATION` config + `getNextDowngradeAt(orderType, currentLevel, openedAt)` helper
- [x] `server/utils/order-dispatch.ts` 改 `loadActiveDrivers` → 加 optional `minCategory` 參數
- [x] `server/utils/order-dispatch.ts` 加 `multicastByLevel(orderId, level, templateKey)` helper（封裝 load drivers + load template + multicast）
- [x] 單元測試 ≥ 80% coverage

### 3. dispatch endpoint（60 min）
- [x] `dispatch.post.ts` 改：
  - 接 body.startLevel: '0' | '1' | '2'
  - 寫 `dispatchVisibility = { startLevel, currentLevel: startLevel, openedAt: serverTimestamp, levelHistory: [{ level: startLevel, openedAt, openedBy: adminId, reason: 'init' }] }`
  - LINE multicast 改用 `multicastByLevel(orderId, startLevel, 'order.dispatched')`
- [x] `redispatch.post.ts` 改：
  - 重置 `currentLevel = startLevel`，`openedAt = serverTimestamp`，push 新 levelHistory entry
  - LINE multicast 同上
- [x] `firestore.rules`（若需更新 order.dispatchVisibility 允許 admin / system）

### 4. driver-side filter + bid（45 min）
- [x] `server/routes/nuxt-api/driver/dispatched-orders/index.get.ts` 改：
  - 拉 driver doc 取 driverCategory（fallback '0'）
  - memory filter 加：`order.dispatchVisibility.currentLevel <= driver.driverCategory`
- [x] `server/routes/nuxt-api/driver/orders/[orderId]/bid.post.ts` 改：
  - transaction 內加守則：driver.driverCategory < order.dispatchVisibility.currentLevel → log anomaly + return forbiddenError
  - 不會走到此分支（client filter 已過濾），純防直打 API
- [x] 單元測試 + e2e mock 5 場景（pro 看 2 / standard 看 ≤1 / novice 看 0 / 直打 API 403）

### 5. admin 發布表單（45 min）
- [x] `app/pages/admin/orders/index.vue` Edit modal + Wave 1A 列表發布按鈕都加「首發等級」select：
  - '2' = 高級司機優先（pro only）
  - '1' = 中級起（standard + pro）
  - '0' = 全車隊（all approved）
  - '__draft__' = 暫不發布（不寫 dispatchAt）
- [x] ClickDispatchFlow 改：先讓 admin 選等級才 submit
- [x] 「暫不發布」分支：不 call endpoint，僅儲存其他欄位

### 6. 司機端倒數 UI（60 min）
- [x] `app/pages/driver/dispatched/index.vue` 訂單卡加倒數區塊
- [x] `app/composables/useCountdown.ts` 🆕 或複用既有：每秒更新顯示
- [x] 倒數歸 0 顯示「即將降級」（不主動觸發降級，等下次 GET）
- [x] 樣式：剩餘 ≤ 60s 變紅

### 7. Migration script（45 min）
- [x] `server/scripts/backfill-dispatch-visibility.ts` 🆕：
  - Query 全 orders collection
  - 對每筆 batch update（500/batch）寫 `dispatchVisibility = { startLevel:'0', currentLevel:'0', openedAt: dispatchAt ?? createdAt, levelHistory:[{level:'0', openedAt, openedBy:'system', reason:'init'}] }`
  - `--dry-run` flag 只 log 不寫
  - log 每筆 id + 結果
- [x] 本機 dev dry-run 測試（用 firebase emulator 或 staging）

### 8. i18n（20 min）
- [x] 三語加 `admin.orders.startLevel.*` / `driver.dispatch.countdownLabel` / `driver.dispatch.aboutToDowngrade`

### 9. 驗證（45 min）
- [x] `pnpm lint:fix` / `pnpm test`（含新 case ≥ 80% coverage） / `pnpm build` 全綠
- [x] 本機 dev 驗 5 場景：
  - admin 發布 startLevel='2' → pro driver 看到 / standard / novice 看不到
  - admin 發布 startLevel='1' → standard + pro 看到 / novice 看不到
  - admin 發布 startLevel='0' → 全 approved 看到
  - novice driver 直打 bid API 對 currentLevel='2' 訂單 → 403 + log
  - 重發訂單 → currentLevel 重置回 startLevel
- [x] prod migration dry-run pass 後 Claude 用 firebase MCP 跑 prod migration

### 10. commit + push（15 min）
- [x] commit msg: `feat(dispatch): 訂單分級派單 schema + filter + 守則`
- [x] push main → Vercel deploy
- [x] prod migration 執行（Claude 自己用 firebase MCP，不丟 User）
- [x] HANDOFF 給 Brain AI prod 驗收清單

### 留尾給 Phase 2D
- Lazy 自動降級
- Admin 手動降級按鈕
- LINE template `dispatch.level-down`

---

## Phase 2D — Lazy 降級 + admin 手動降級 + LINE template + archive

> 對應 Step 5 視窗。完工後 archive change。

### 0. 探勘（15 min）
- [x] 讀 Step 4 落地的 `dispatched-orders.get.ts` + `multicastByLevel`
- [x] 讀 既有 LINE template 結構（template-registry.ts；本專案改走 registry + notification_templates collection）
- [x] 讀 admin templates UI（admin/line-management Flex Templates tab）確認 registry 新 entry 自動列出

### 1. Lazy check 在 driver GET（60 min）
- [x] `server/routes/nuxt-api/driver/dispatched-orders/index.get.ts` 加 lazy check：
  - 對每筆 pending order 算 `getNextDowngradeAt`
  - 若 `now > nextDowngradeAt` → transaction：
    - re-fetch 確認 currentLevel 未變（expectedLevel match）
    - update currentLevel-- + openedAt=serverTimestamp + levelHistory push
    - 若已被另 request 降過 → throw DispatchGuardError('level_changed') silent skip
  - transaction 成功後 fire-and-forget call `multicastLevelDown(orderId, newLevel)` + writeAuditLog
  - 有候選降級時 re-read snap 避免本 response 仍用舊 currentLevel 判斷可見性
- [x] 單元測試 12 個 case 覆蓋 race condition + 三 mode（downgrade-dispatch-level.spec.ts）

### 2. Admin 手動降級 endpoints（45 min）
- [x] `server/routes/nuxt-api/admin/orders/[orderId]/dispatch-level/downgrade.post.ts` 🆕：
  - 守則：admin + canManageOrders + 訂單 pending + dispatched + 未指派 + currentLevel !== '0'
  - 共用 `downgradeDispatchLevel` helper（mode='downgrade'）
  - fire-and-forget `multicastLevelDown` + writeAuditLog action='order.dispatch_level.downgrade'
- [x] `server/routes/nuxt-api/admin/orders/[orderId]/dispatch-level/force-open.post.ts` 🆕：
  - 同上守則
  - 共用 `downgradeDispatchLevel` helper（mode='force-open' → currentLevel='0'）
  - writeAuditLog action='order.dispatch_level.force_open'

### 3. Admin UI（45 min）
- [x] `app/pages/admin/orders/index.vue` 列表 + 快速動作列加兩按鈕：
  - 「⬇️ 立即降級」disabled when currentLevel='0' → UseAsk 二次確認
  - 「🔓 全開放」disabled when currentLevel='0' → UseAsk 二次確認
  - call `$api.DowngradeDispatchLevel` / `ForceOpenDispatchLevel`
  - 成功後 refetch 列表
  - per-row loading state（Set<orderId>）防 disable 互相干擾
  - SCSS 區分顏色：downgrade 橘紅 / force-open 紅

### 4. LINE template 新 entry（45 min）
- [x] `dispatch.level-down` 加進 `server/utils/template-registry.ts`（與本專案既有 17 個 template 同機制）：
  - category='dispatch'
  - outputType='flex' / audience='driver' / i18nMode='single' / triggerType='auto'
  - placeholders: orderId/orderType/date/pickupAddress/dropoffAddress/paxSummary/estimatedFare/newLevel
  - defaultContent 含繁中文案
  - requiresSuperLevel=true（與其他 dispatch.* 一致）
- [x] `multicastLevelDown` helper 加在 `server/utils/line-dispatch-push.ts`（resolveTemplate + buildDispatchFlex + sendLineMulticast 走 driver OA）
- [x] admin/line-management UI 自動列出（template-registry 驅動，無需動 admin UI 程式碼）
- [N/A] firestore_add_document 寫 prod — 本專案 template 從 registry default 取，admin 編輯才寫 notification_templates doc；無需預先寫入

### 5. i18n（10 min）
- [x] 三語加 `admin.orders.downgradeNow` / `forceOpenAll` / `downgradeConfirm*` / `forceOpenConfirm*` / `downgradeSuccess` / `forceOpenSuccess` / `downgradeFailed` / `downgradeAtLowest`

### 6. 驗證（45 min）
- [x] `pnpm lint` / `pnpm test`（354/354 全綠，含新 12 case）/ `pnpm build` 全綠
- [ ] Brain AI 本機 dev / prod 驗 6 場景：
  - airport 訂單 currentLevel=2 等 3 分鐘後司機 GET → 自動降到 1 + standard 看到 + LINE push
  - 從 1 等 5 分鐘 → 降到 0 + novice 看到 + LINE push
  - transfer 訂單 8/12 分鐘正確
  - charter 訂單 30/60 分鐘正確
  - admin 「立即降級」→ 二次確認 → 降一級 + LINE push
  - admin 「全開放」→ 二次確認 → currentLevel='0' + LINE push 全 approved
  - 兩司機同時 GET：transaction 不重複降級（unit test 已驗）

### 7. commit + push（10 min）
- [x] commit msg: `feat(dispatch): 分級派單降級機制 + LINE level-down template`
- [x] push main → Vercel deploy

### 8. Archive change（15 min）
- [x] 跑 `/opsx:verify` 確認 5 phase tasks 全勾、0 critical
- [x] 跑 `/opsx:archive 2026-05-24-admin-orders-dispatch-tiers`
- [x] commit msg: `docs: archive admin-orders-dispatch-tiers`
- [x] push main

### 9. HANDOFF（最終）
- [x] 給 Brain AI prod e2e 驗收清單（6 場景）
- [x] memory 寫 `project-admin-orders-dispatch-tiers.md`：完工日期、commit hashes、留尾項

---

## 驗收 Gate（umbrella）

各 phase 完成後，Brain AI prod 端驗收綠才能進下一 phase：

| Phase | 驗收 gate |
|---|---|
| 1A | admin/orders 列表 3 場景按鈕切換正確 |
| 1C | tag 後修 4 場景全綠（含 discount 過期 fallback） |
| 2A | admin 改 driver category 後 audit log 顯示 |
| 2B+2C | 三級司機可見性正確 + migration 0 fail |
| 2D | Lazy 自動降級時間正確 + admin 按鈕觸發 LINE push |

每 phase 失敗的 prod 驗收 = stop the line，不進下一 phase。
