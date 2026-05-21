# Hand-off：Phase 1E 訂單需求單 + 司機喊單 + Admin 配對

## 狀態

- **實作 100% 完成**：lint / test / build 三項全綠
- 一支 commit（**不 push**）；firestore rules 本 phase **不動**（無新 collection；orders 既有 server-only 寫入規則已 cover）
- 等 Brain AI 真機驗收 → 點「進 1F」

## 實作摘要

### shared 層（純函式 + 規格常數）
- [shared/orderDispatch.ts](../../../shared/orderDispatch.ts) 🆕 — `DriverTagSnapshot` / `MatchedTag` / `DriverMatchResult` types + `computeDriverMatch` 純函式（交集計數 + lang fallback + group sort）+ `buildDispatchTagIndex`
- [shared/orderDispatch.spec.ts](../../../shared/orderDispatch.spec.ts) 🆕 — Vitest 11 case（0 偏好 / 全擁有 / 全無 / 部分 / archived / driver-scope / lang / 重複 id / 聯集去重 + buildDispatchTagIndex 空 id），全綠

### server 層（utils + 7 endpoints + PATCH cancel hook）
- [server/utils/order-dispatch.ts](../../../server/utils/order-dispatch.ts) 🆕 — `OrderBidEntry` type + `serializeBids` / `loadActiveDrivers` / `loadDriverDisplayName` / `dispatchOrder` / `appendBid` / `withdrawBid` / `assignDriver` / `loadBidsWithDriverInfo` / `activeBidderLineUids` + `DispatchGuardError`（7 種 code）
- [server/utils/line-dispatch-push.ts](../../../server/utils/line-dispatch-push.ts) 🆕 — hard-coded Flex template 4 個 helper：`pushOrderDispatchToDrivers`（multicast 給所有 driver）/ `pushOrderAssignedToPassenger`（三語 Flex + 連 `/vehicles/{driverId}`）/ `pushOrderAssignedToDriver`（中選通知，連 `/driver/trip`）/ `pushOrderCancelledToBidders`（text multicast）+ `getDispatchPushEnv` helper
- [server/utils/audit-log.ts](../../../server/utils/audit-log.ts) ✏️ — `AuditAction` 加 4 個：`order.dispatch` / `order.bid` / `order.bid_withdraw` / `order.cancel_dispatched`
- [server/routes/nuxt-api/admin/orders/[orderId]/dispatch.post.ts](../../../server/routes/nuxt-api/admin/orders/%5BorderId%5D/dispatch.post.ts) 🆕 — admin 發出需求單（守 pending && !dispatchAt）+ 觸發 multicast 給全部 active driver（fire-and-forget）+ audit
- [server/routes/nuxt-api/admin/orders/[orderId]/bids.get.ts](../../../server/routes/nuxt-api/admin/orders/%5BorderId%5D/bids.get.ts) 🆕 — 回 order.bids（含撤回）+ 每筆 driver 的 matchCount / matchedTagNames / completedOrders / verifiedAt 即時計算
- [server/routes/nuxt-api/admin/orders/[orderId]/assign.post.ts](../../../server/routes/nuxt-api/admin/orders/%5BorderId%5D/assign.post.ts) 🆕 — transaction 守 status=='pending' && !assignedDriverId && driverId ∈ bids；寫 `assignedDriverId='line:Uxxx'` / `orderStatus='confirmed'` / `assignedAt` / `assignedBy` / `statusHistory.confirmedAt`；雙向 LINE 推播（passenger 含 `/vehicles/{driverId}` 連結；driver 含 trip 連結）+ audit
- [server/routes/nuxt-api/driver/dispatched-orders/index.get.ts](../../../server/routes/nuxt-api/driver/dispatched-orders/index.get.ts) 🆕 — driver 看板列表，回 `myBidStatus` ∈ `'none' | 'bid' | 'withdrawn'` + `activeBidCount`；不過濾必要條件（B1 拍版）
- [server/routes/nuxt-api/driver/dispatched-orders/[orderId].get.ts](../../../server/routes/nuxt-api/driver/dispatched-orders/%5BorderId%5D.get.ts) 🆕 — driver 看詳情頁的資料 endpoint（與 `/nuxt-api/orders/[orderId]` 分離；那個只允許 owner/admin/assigned driver，本 endpoint 允許 approved driver 看 dispatchable 訂單）。不回乘客 PII。
- [server/routes/nuxt-api/driver/orders/[orderId]/bid.post.ts](../../../server/routes/nuxt-api/driver/orders/%5BorderId%5D/bid.post.ts) 🆕 — transaction 守 status=='pending' && dispatchAt != null && !assignedDriverId && 自己沒未撤回 bid + audit
- [server/routes/nuxt-api/driver/orders/[orderId]/bid.delete.ts](../../../server/routes/nuxt-api/driver/orders/%5BorderId%5D/bid.delete.ts) 🆕 — 把對應 bid `withdrawnAt = now`（保留歷史）+ audit
- [server/routes/nuxt-api/admin/orders/index.get.ts](../../../server/routes/nuxt-api/admin/orders/index.get.ts) ✏️ — list 每筆 echo `dispatchAt` / `dispatchedBy` / `bids` / `assignedAt` / `assignedBy`
- [server/routes/nuxt-api/orders/[orderId].patch.ts](../../../server/routes/nuxt-api/orders/%5BorderId%5D.patch.ts) ✏️ — 取消「已派發但未指派」訂單時 fire-and-forget 推 cancelled 通知給所有 active bidders + audit `order.cancel_dispatched`

> server endpoint 規範：driver self → `auth.roles.includes('driver')` + `auth.approved`；admin → `hasPermission(auth, 'canManageOrders')`，全部 audit log（admin 端動作）。

### protocol 層
- [app/protocol/fetch-api/api/admin/order-dispatch.ts](../../../app/protocol/fetch-api/api/admin/order-dispatch.ts) 🆕 — `OrderBidDto` / `AdminBidWithMatch` / `AdminOrderBidsRes` types + `DispatchOrder` / `GetAdminOrderBids` / `AssignDriverFromBids` API
- [app/protocol/fetch-api/api/admin/index.ts](../../../app/protocol/fetch-api/api/admin/index.ts) ✏️ — re-export `./order-dispatch`；`AdminOrder` 加 `dispatchAt` / `dispatchedBy` / `bids` / `assignedAt` / `assignedBy` 5 個 optional field；新增 `AdminOrderBidSnapshot` type
- [app/protocol/fetch-api/api/driver/order-bid.ts](../../../app/protocol/fetch-api/api/driver/order-bid.ts) 🆕 — `DriverDispatchedOrderItem` / `DriverDispatchedOrderDetail` types + `GetDispatchedOrders` / `GetDispatchedOrderDetail` / `PostOrderBid` / `DeleteOrderBid` API
- [app/protocol/fetch-api/api/driver/index.ts](../../../app/protocol/fetch-api/api/driver/index.ts) ✏️ — re-export `./order-bid`

### Admin UI
- [app/components/admin/OrderBidList.vue](../../../app/components/admin/OrderBidList.vue) 🆕 — 喊單清單元件；排序「未撤回優先 → matchCount desc → completedOrders desc → bidAt asc」；每張卡顯示司機名 + match chip + 完成趟數 + 認證時間 + bid 時間 + 指派按鈕；撤回的 bid 灰掉、無按鈕；響應式（窄螢幕按鈕全寬）
- [app/pages/admin/orders/index.vue](../../../app/pages/admin/orders/index.vue) ✏️：
  - 列表每張卡片 `is-status` cell 疊加 dispatch 徽章：未派發 → 「待派發」紅；已派發無 bid → 「待喊單」橘；已派發 N bid → 「N 喊單」橘
  - Modal 內加 `訂單需求單` section（僅當 `orderStatus === 'pending'`）：
    - 未派發 → 顯示「發出需求單」按鈕（call `DispatchOrder`）
    - 已派發 → 顯示派發時間 / 喊單數 + 嵌入 `AdminOrderBidList`（call `GetAdminOrderBids` 載入；`AssignDriverFromBids` 指派）
  - 不動既有「指派司機」legacy 按鈕（admin 直接派任意 approved driver 流程保留；走 PatchOrder）

### Driver UI
- [app/components/driver/DispatchedOrderCard.vue](../../../app/components/driver/DispatchedOrderCard.vue) 🆕 — 接單看板卡片：訂單類型 chip / orderId / bid 狀態 chip（已喊單綠 / 已撤回紅）/ 用車時間 / 路線（pickup-line-dropoff）/ 偏好 chip / 人數/距離/車資 / 撤回 + 查看詳情按鈕
- [app/pages/driver/dispatched/index.vue](../../../app/pages/driver/dispatched/index.vue) 🆕 — 看板：兩 tab（可接訂單 / 已喊單），呼叫 `GetDispatchedOrders` 一次拿全部，前端依 `myBidStatus` 分流；已喊單 tab 內 card 帶撤回按鈕；點 card 進詳情頁
- [app/pages/driver/dispatched/[orderId].vue](../../../app/pages/driver/dispatched/%5BorderId%5D.vue) 🆕 — 詳情頁：訂單基本資訊 / 行程路線 / 乘客偏好 chip + hint / 航班 / 備註 / 費用 / 距離 / 人數 + sticky 底部行動按鈕（依 myBidStatus 切換「我要接這單」/「重新喊單」/「撤回喊單」）
- [app/layouts/driver.vue](../../../app/layouts/driver.vue) ✏️ — drawer navItems 加「接單看板 📦」入口（在「拉單」與「任務」之間）

### i18n（zh / en / ja 完整三語）
- [i18n/locales/zh.js](../../../i18n/locales/zh.js) / [en.js](../../../i18n/locales/en.js) / [ja.js](../../../i18n/locales/ja.js) — 加 `notification.dispatched.*` / `notification.assigned.*` / `notification.driverSelected.*` / `notification.cancelled.bidder` 共 11 個 key（**真翻譯**，非 fallback）

## 規格細節決策

| 議題 | 拍板 | 出處 |
|---|---|---|
| 訂單狀態 enum | 不引入 `bidding`，全期 `pending`；派發狀態靠 dispatchAt / bids / assignedDriverId 推斷 | proposal #1 |
| 發單對象 | 推全部 active driver（lineUserId 撈自 `users where roles array-contains 'driver' && approved`） | #2 |
| 看板過濾 | 不過濾必要條件（B1 拍版） | #3 |
| 喊單時限 | 不設硬時限（B2） | #4 |
| 超時無人喊單 | Admin 介入手動（B2） | #5 |
| Admin 挑選依據 | 司機名 + 標籤命中 + 過往訂單數（B3） | #6 |
| Driver 喊單入口 | LINE Flex 推播 → CTA 開 `/driver/dispatched/[orderId]`（透過 LIFF）；亦可從 layout drawer「接單看板」進入 | #7 |
| 司機可用時段 | 不檢查（D2） | #8 |
| bid 結構 | `{ driverId, driverDisplayName, bidAt, withdrawnAt? }`；matchCount 不入 bid（admin 看時即時讀 driver doc 計算） | #9 |
| 中選後其他 bid | 留在 `order.bids[]` 給 admin 看歷史 | #10 |
| Driver 撤回 bid | 支援；撤回後 `withdrawnAt = now` 不真的 splice，保留歷史 | #11 |
| Race condition | 用 `db.runTransaction`：dispatch / bid append / withdraw / assign 全部走 transaction；append 由 read-then-write 完成（不用 arrayUnion 避免 serverTimestamp 限制）；bid 內 `bidAt` 用 `new Date()` 客戶端時間 | #12 |
| LINE template | hard-coded（不進 `notification_templates`，Phase 2 可改） | #13 |
| Passenger 通知 | 三語 Flex（lang 由 `getUserLang(db, lineUid)` 撈 users/{lineUid}.lang）+ 連 `/vehicles/{driverId}` 公開頁 | #14 |
| Driver 未中選通知 | 不發（避免騷擾） | #15 |
| i18n | passenger 三語完整翻譯；admin / driver UI 文字繁中硬寫 | #16 |
| 訂單列表標示 | 列表卡片狀態 cell 疊加 dispatch 徽章（待派發 / 待喊單 / N 喊單） | #17 |
| 取消訂單 | 既有 PATCH cancel 路徑加 hook：若 `dispatchAt` 存在且 `!assignedDriverId` → multicast 通知 active bidders + audit `order.cancel_dispatched` | #18 |
| **lineUserId 來源** | `loadActiveDrivers` 從 `users.lineUserId` 撈（與既有 broadcast 一致）；同 user lineUid === lineUserId 是 LINE-auth 帳號普遍特性，cancelled 推送直接用 `b.driverId` 為 LINE userId 沿用該假設 | 既有資料慣例 |
| **assign 雙向推播** | fire-and-forget（`void (async () => {...})()`）；passenger 推 passenger OA + driver 推 driver OA；錯誤吞掉只 log | 對齊 orders.patch.ts 模式 |
| **dispatched-orders 列表 query** | `where('orderStatus', '==', 'pending').orderBy('pickupDateTime', 'asc').limit(200)` + in-memory filter dispatchAt && !assignedDriverId（避免 composite index 開新欄位） | Firestore inequality 單欄位限制 |
| **driver detail endpoint 獨立** | `/nuxt-api/driver/dispatched-orders/[orderId]` 與 `/nuxt-api/orders/[orderId]` 分離；後者要求 owner/admin/assigned，前者允許 approved driver 看 dispatchable | 既有 orders.get.ts 權限不允許接單前查看 |
| **Composite index** | dispatched-orders list 只用單欄位 `orderStatus + pickupDateTime` 既有 index，無新增 | 對齊 P15 `available.get.ts` 慣例 |

## 驗證結果

```
pnpm lint   ✅ 0 error / 0 warning
pnpm test   ✅ 11 test files / 193 tests passed（+11 case：orderDispatch.spec.ts）
pnpm build  ✅ exit 0；7 個新 endpoint chunk 全 emit：
            - admin/orders/_orderId/dispatch.post.mjs
            - admin/orders/_orderId/bids.get.mjs
            - admin/orders/_orderId/assign.post.mjs
            - driver/dispatched-orders/index.get.mjs
            - driver/dispatched-orders/_orderId_.get.mjs
            - driver/orders/_orderId/bid.post.mjs
            - driver/orders/_orderId/bid.delete.mjs
```

## 真機驗收 checklist（Brain AI）

啟動 `pnpm dev`，準備 3 種帳號（admin、driver A approved、driver B approved；乘客一個）：

### Admin 端發單流程

- [ ] **A1** 進 `/admin/orders`，列表 pending 訂單卡片右上看到「待派發」紅徽章
- [ ] **A2** 點該訂單開 modal，看到「訂單需求單」section + 「📤 發出需求單」按鈕（藍底）
- [ ] **A3** 點下後 toast「需求單已發出，已通知全部司機」→ section 立即變「已派發於 MM/DD HH:mm」+ 「0 司機喊單中」
- [ ] **A4** 關 modal，列表卡片徽章變「待喊單」
- [ ] **A5** Firebase console 看 `orders/{orderId}` doc 應有 `dispatchAt`（Timestamp）+ `dispatchedBy=<admin uid>`
- [ ] **A6** `audit_logs` 應有一筆 `action='order.dispatch'` doc

### Driver 收推播 + 看板

- [ ] **D1** Driver A LINE OA 收到 Flex 推播「📦 新訂單派發 #XXXXXXXX」+ CTA「查看詳情並接單」
- [ ] **D2** 點 CTA 進 `/driver/dispatched/{orderId}` LIFF（或直接 web）→ 看到訂單詳情 + 「我要接這單」按鈕（橘）
- [ ] **D3** 或：Driver 用 drawer「接單看板 📦」進 `/driver/dispatched` → 「可接訂單」tab 看到該單；卡片顯示偏好 chip、人數、距離、預估車資
- [ ] **D4** 點「我要接這單」 → toast「已喊單，請等候管理員指派」→ 按鈕變「撤回喊單」紅
- [ ] **D5** 回看板 → tab 切「已喊單」看到該單 + 卡片有「已喊單」綠 chip + 撤回按鈕

### Admin 看 bid + 指派

- [ ] **A7** Admin 重新進該訂單 modal → 「訂單需求單」section 顯示 `1 司機喊單中`，下方喊單清單顯示 driver A 卡片：
  - 司機名（snapshot at bid time）
  - ★ matchCount/preferenceCount 命中（若乘客有偏好）
  - matched tag chip
  - ✓ 完成趟數
  - 認證時間
  - bid 時間
  - 「指派此司機」按鈕
- [ ] **A8** 列表卡片徽章變「1 喊單」橘
- [ ] **A9** Driver B 也喊單 → admin 重新打開 modal 看到 2 個 bid，排序依 matchCount > completedOrders > bidAt
- [ ] **A10** Driver A 在自己端撤回 → admin 看 list 應該變「1 喊單」（active）但 modal 內 driver A 卡片變灰 + 「已撤回」chip + 無按鈕
- [ ] **A11** 點 driver B 「指派此司機」 → toast「已指派該司機，雙向通知已發送」→ section 消失（orderStatus → confirmed）
- [ ] **A12** Firebase 看 `orders/{orderId}`：`assignedDriverId='line:Uxxx'` / `orderStatus='confirmed'` / `assignedAt` / `assignedBy` / `statusHistory.confirmedAt` 都寫入

### LINE 通知雙向

- [ ] **L1** Driver B LINE OA 收到 Flex「✅ 您已中選 #XXXXXXXX」+ CTA「查看任務」→ 連 `/driver/trip`（LIFF）
- [ ] **L2** 乘客 LINE OA 收到 Flex「🎉 配對成功」（zh/en/ja 依 user.lang）+ CTA「查看車輛資訊」→ 連 `/vehicles/{driverB-lineUid}`（LIFF）→ 跳到 1C 車輛公開檔案頁
- [ ] **L3** Driver A（撤回的）LINE 不收到通知（spec #15）

### Race condition

- [ ] **R1** 開兩個 driver session 同時點「我要接這單」（同筆訂單）→ 兩個都成功（append-only）；admin 看 bids 兩筆都在
- [ ] **R2** 開兩個 admin session 同時點 assign 不同 driver（同筆訂單）→ 第一個成功；第二個回 400「訂單已指派司機」（transaction 守 `!assignedDriverId`）
- [ ] **R3** Admin 已指派後 driver A 點撤回 → 回 400「訂單已指派，無法撤回喊單」

### 取消已派發訂單

- [ ] **C1** Admin 對「已派發、未指派、有 active bid」訂單取消（在 modal 內取消訂單）→ 所有 active bidder 都收 LINE 文字通知「⚠️ 訂單已取消 #XXXX 已取消，您的喊單已自動撤回。」
- [ ] **C2** `audit_logs` 應有 `action='order.cancel_dispatched'` doc + `payload.bidderCount`

### 邊界

- [ ] **E1** 訂單已 confirmed（assigned）→ modal 不顯示「訂單需求單」section
- [ ] **E2** 訂單 cancelled / completed → 列表卡片不顯示 dispatch 徽章
- [ ] **E3** 派發後乘客自己取消（passenger 端取消）→ 同 C1（bidders 都收通知）
- [ ] **E4** Admin 取消「未派發」訂單（pending && !dispatchAt）→ 不觸發 bidder 推播（沒有 bidders）

> firestore rules 沒 deploy；本 phase **無新 collection**，所有 dispatch / bid 欄位都在 `orders/{orderId}` doc 內，既有 server-only 寫入規則已 cover。

## 留尾（不在本 phase 範圍）

- ⏳ Soft Match / 重新配對流程（passenger 端 / driver 中選後反悔）→ Phase 1F（spec 2026-05-21-soft-match-rematching 已寫好）
- ⏳ E2E 測試 + rules deploy + prod push → Phase 1G
- ⏳ Driver 量大時的需求單推播過濾（如 4 人座訂單只推 4/7/9 人座 driver）→ Phase 2
- ⏳ `order.bids[]` 撤回後保留歷史，極端情況可能膨脹 → archival policy 在 Phase 2 補
- ⏳ Notification template editor 化（LINE Flex 文案可由 admin 編輯）→ Phase 2
- ⏳ Driver 中選後反悔（接單後 cancel）→ 走 admin 取消重派流程，由 1F 處理
- ⏳ 中選 driver 在 LINE 看完通知後，從 LIFF 進 `/driver/trip` 看到該單（trip 頁本身已存在；CTA URL 與 trip 頁的訂單 list 銜接尚未真機驗）

## 已知陷阱與設計權衡

1. **bid 撤回後可重 bid**：driver 撤回後若仍想接，可再喊；server 只擋「未撤回的 active bid 不可重複」，撤回的 bid 留在陣列內帶 `withdrawnAt` 標記。Detail 頁 myBidStatus='withdrawn' 顯示「重新喊單」按鈕。
2. **matchCount 即時讀 drivers doc**：每張 bid card 都會多 1 個 driver doc read。100 bids 一張單會炸 100 read。本 phase 不處理（admin 通常 ≤ 10 bids）。
3. **bid append 用 `new Date()` 而非 `serverTimestamp`**：Firestore transaction 內 array union 不能含 `FieldValue.serverTimestamp()`，故 bidAt 用客戶端時間（精度足夠；網路延遲 ≤ 1s）。order.dispatchAt / assignedAt 仍用 serverTimestamp（不在陣列內）。
4. **dispatched-orders query 不過濾 dispatchAt / assignedDriverId**：Firestore 單次 query 只能對單欄位用 inequality。改在 in-memory filter，limit(200) 撈夠多後過濾。日後若 active pending 訂單 ≥ 200，需考慮加 composite index 或拆 endpoint。
5. **driver detail endpoint 與 orders/[orderId].get.ts 分離**：後者守 owner/admin/assignedDriver，approved driver 接單前看不到；本 phase 開 `/driver/dispatched-orders/[orderId]` 不回 PII（lineUserId / contactPhone / passengerName）。
6. **assignedDriverId 格式統一 `line:Uxxx`**：與既有 P19 hotfix 一致（normalize 寫入 + 兼容雙格式讀取），assign endpoint 寫入時強制前綴。
7. **LINE multicast 對「approved=false」司機**：`loadActiveDrivers` 已過濾 approved==true；未通過審核的 driver 不會收到推播。
8. **取消已派發訂單的 audit 只在 admin 時寫**：passenger 自己取消也會推 bidders，但不寫 audit_logs（passenger action 不入 audit；既有 orders.patch.ts 慣例）。
9. **Active driver lineUserId 假設等於 lineUid**：對 LINE-auth 帳號這幾乎必然（line-exchange 寫入時 `lineUserId = lineProfile.sub`，而 doc id 也是同一個 sub）。若日後支援非 LINE 登入司機，需重新審視 `pushOrderCancelledToBidders` 直接用 `b.driverId` 為 LINE userId 的假設。
10. **Composite index 風險**：本 phase 所有 query 都用既有 single-field index（`orderStatus` / `pickupDateTime` / `roles` array-contains），不需要 Brain AI deploy 新 index。

## Commit

```
feat: Phase 1E — 訂單需求單 + 司機喊單 + admin 配對
```

新增 / 改動檔案清單：

**新增**
- shared/orderDispatch.ts 🆕
- shared/orderDispatch.spec.ts 🆕
- server/utils/order-dispatch.ts 🆕
- server/utils/line-dispatch-push.ts 🆕
- server/routes/nuxt-api/admin/orders/[orderId]/dispatch.post.ts 🆕
- server/routes/nuxt-api/admin/orders/[orderId]/bids.get.ts 🆕
- server/routes/nuxt-api/admin/orders/[orderId]/assign.post.ts 🆕
- server/routes/nuxt-api/driver/dispatched-orders/index.get.ts 🆕
- server/routes/nuxt-api/driver/dispatched-orders/[orderId].get.ts 🆕
- server/routes/nuxt-api/driver/orders/[orderId]/bid.post.ts 🆕
- server/routes/nuxt-api/driver/orders/[orderId]/bid.delete.ts 🆕
- app/protocol/fetch-api/api/admin/order-dispatch.ts 🆕
- app/protocol/fetch-api/api/driver/order-bid.ts 🆕
- app/components/admin/OrderBidList.vue 🆕
- app/components/driver/DispatchedOrderCard.vue 🆕
- app/pages/driver/dispatched/index.vue 🆕
- app/pages/driver/dispatched/[orderId].vue 🆕
- openspec/changes/2026-05-21-order-bidding-flow/HANDOFF.md 🆕

**改動**
- server/utils/audit-log.ts ✏️（加 4 個 AuditAction）
- server/routes/nuxt-api/admin/orders/index.get.ts ✏️（echo 5 個 dispatch field）
- server/routes/nuxt-api/orders/[orderId].patch.ts ✏️（cancel hook 推 bidders + audit）
- app/protocol/fetch-api/api/admin/index.ts ✏️（re-export + AdminOrder 加 5 field + AdminOrderBidSnapshot type）
- app/protocol/fetch-api/api/driver/index.ts ✏️（re-export ./order-bid）
- app/pages/admin/orders/index.vue ✏️（list 徽章 + modal dispatch section + bids API 載入）
- app/layouts/driver.vue ✏️（drawer 加「接單看板」入口）
- i18n/locales/zh.js ✏️（notification.* 11 keys）
- i18n/locales/en.js ✏️
- i18n/locales/ja.js ✏️
