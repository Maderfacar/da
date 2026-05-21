# Phase 1E 任務拆解

> 依 `design.md` 實作。**本 phase 最大**（後端 + 三端 UI + LINE 模板），建議分 2 視窗：
> - 視窗 1：shared + server + protocol（後端骨架完成）
> - 視窗 2：admin UI + driver UI + LINE templates + 整合測試
> 或一視窗連跑 6+ 小時也可。完成後一支 commit。

## 0. 探勘（15 min）
- [ ] 讀 1D HANDOFF 確認 `order.preferences` schema（如果 1D 已實作）
- [ ] 讀 `server/utils/admin-recipients.ts`（1B 用過撈 canManageDrivers admin list；本期撈 active driver list 可能要新 helper）
- [ ] 讀 `server/utils/line-push.ts` 既有 LINE push helper 用法
- [ ] 讀 `server/routes/nuxt-api/admin/orders/[id].vue`（既有 admin 訂單詳情頁，是 page 還是 ts）
- [ ] 讀既有訂單列表 page 與 status 渲染
- [ ] 確認 driver web 端既有路徑 `/driver/*` 與 layout
- [ ] grep `firestore.runTransaction` 確認既有 transaction 用法

## 1. shared 層（30 min）
- [ ] `shared/orderDispatch.ts` 🆕
  - `DriverTagSnapshot` / `MatchedTag` / `DriverMatchResult` types
  - `computeDriverMatch(preferenceTagIds, driver, tagIndex, lang)` function
- [ ] `shared/orderDispatch.spec.ts` 🆕（≥ 7 case，見 design §2.2）

## 2. server utils（45 min）
- [ ] `server/utils/order-dispatch.ts` 🆕
  - `loadActiveDriverIds(db)` → string[]（撈 drivers where approved=true）
  - `appendBid(db, orderId, driverId, displayName)` → transaction-safe
  - `withdrawBid(db, orderId, driverId)` → transaction-safe
  - `assignDriver(db, orderId, driverId, adminUid)` → transaction-safe（守 status + driverId null）
  - `loadBidWithDriverInfo(db, orderId, tagIndex)` → 給 admin endpoint
- [ ] `server/utils/line-dispatch-push.ts` 🆕
  - `pushOrderDispatchToAllDrivers(env, order, driverIds)` 訂單需求單推播
  - `pushOrderAssignedToPassenger(env, order, driver)` 配對成功
  - `pushOrderAssignedToDriver(env, order)` 中選通知
  - `pushOrderCancelledToBidders(env, order, bidderIds)` 取消通知
  - 各 helper 內 build Flex message hard-coded（不進 notification_templates）
- [ ] `server/utils/audit-log.ts` 改：
  - `AuditAction` 加 `order.dispatch` / `order.bid` / `order.bid_withdraw` / `order.assign` / `order.cancel_dispatched`

## 3. server endpoints（60 min）
- [ ] `server/routes/nuxt-api/admin/orders/[orderId]/dispatch.post.ts` 🆕（守 status=pending && !dispatchAt + push 全部 driver + audit）
- [ ] `server/routes/nuxt-api/admin/orders/[orderId]/bids.get.ts` 🆕（return bid + match 計算）
- [ ] `server/routes/nuxt-api/admin/orders/[orderId]/assign.post.ts` 🆕（transaction + 2 LINE push + audit）
- [ ] `server/routes/nuxt-api/driver/dispatched-orders/index.get.ts` 🆕（撈可接 + 自己 bid 過的）
- [ ] `server/routes/nuxt-api/driver/orders/[orderId]/bid.post.ts` 🆕（transaction + audit）
- [ ] `server/routes/nuxt-api/driver/orders/[orderId]/bid.delete.ts` 🆕（withdraw + audit）
- [ ] 既有 PATCH order endpoint 改：取消時若 dispatched + bids 非空 → 推播取消給 active bidders

## 4. protocol（30 min）
- [ ] `app/protocol/fetch-api/api/admin/order-dispatch/{index.ts,type.d.ts}` 🆕
  - `DispatchOrder`、`GetOrderBids`、`AssignDriver`
  - 對應 dto / body 型別
- [ ] `app/protocol/fetch-api/api/driver/order-bid/{index.ts,type.d.ts}` 🆕
  - `GetDispatchedOrders`、`PostBid`、`DeleteBid`

## 5. Admin UI（90 min）
- [ ] `app/components/admin/OrderBidList.vue` 🆕（喊單清單元件）
- [ ] `app/pages/admin/orders/[id].vue` 改：
  - 加 dispatch section（依 status / dispatchAt / driverId 顯示三狀態）
  - 嵌入 `OrderBidList`
  - ClickDispatch / ClickAssign methods
- [ ] `app/pages/admin/orders/index.vue` 改：
  - 列表每張卡片加狀態徽章（待派發 / 待喊單 / N 喊單 / 已配對）

## 6. Driver UI（90 min）
- [ ] `app/components/driver/DispatchedOrderCard.vue` 🆕
- [ ] `app/pages/driver/dispatched/index.vue` 🆕（看板，可接 / 已喊單兩 tab）
- [ ] `app/pages/driver/dispatched/[orderId].vue` 🆕（訂單詳情 + 喊單按鈕）
  - 顯示 preferences chip + 自己 match 高亮
  - 「我要接這單」/「撤回喊單」依 myBidStatus 切換

## 7. i18n（20 min）
- [ ] zh.js / en.js / ja.js 加：
  - `notification.dispatched.*`（訂單需求單推播訊息）
  - `notification.assigned.*`（passenger 配對成功通知）
  - `notification.driverSelected.*`（driver 中選通知）
- 注意：admin / driver UI 端文字繁中硬寫即可（拍版 #16）

## 8. 驗證（15 min）
- [ ] `pnpm lint` 全綠
- [ ] `pnpm test` 全綠（含新 case，預期 +7 case）
- [ ] `pnpm build` 全綠

## 9. 真機 smoke（30 min）
- [ ] admin 進訂單詳情 → 點「發出需求單」→ dispatchAt 寫入
- [ ] 用 driver 帳號收 LINE → 點 CTA 進接單看板
- [ ] driver 喊單 → admin 看到 bid
- [ ] driver 撤回 → admin 看到該 bid 灰掉
- [ ] admin 指派 → driver / passenger 都收 LINE
- [ ] passenger 點配對成功 LINE → 進公開頁正確
- [ ] 兩 driver 同時喊單 race → 都成功
- [ ] admin 同時挑兩個 race → 第二個失敗

## 10. commit + HANDOFF
- [ ] commit message: `feat: Phase 1E — 訂單需求單 + 司機喊單 + admin 配對`
- [ ] **不 push**
- [ ] 寫 HANDOFF.md
- [ ] 回報「Phase 1E 完工，等 Brain AI 點『進 1F』」
