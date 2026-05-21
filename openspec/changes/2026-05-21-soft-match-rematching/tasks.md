# Phase 1F 任務拆解

> 依 `design.md` 實作。完成後 `commit`（不 push），等 Brain AI 點「進 1G」。

## 0. 探勘（15 min）
- [ ] 讀 1E HANDOFF 確認 `order.bids[]` / `dispatchAt` / `driverId` 寫入 pattern
- [ ] 讀既有 LINE webhook postback 處理檔（grep `postback.data` in `server/routes/api/line/webhook.post.ts` 或 line-channel.ts）
- [ ] 讀既有 `cancelled_by_passenger` 訂單取消邏輯（grep `cancelled_by_passenger`）
- [ ] 確認 referral 的 LINE Flex 3-button postback 用法可參考

## 1. shared 層（15 min）
- [ ] `shared/orderDispatch.spec.ts` 改或新 file：加 `isSoftMatch()` test cases（≥ 4 case）

## 2. server utils（45 min）
- [ ] `server/utils/order-soft-match.ts` 🆕
  - `isSoftMatch(preferenceTagIds, matchResult)` 純判定
- [ ] `server/utils/order-dispatch.ts` 改：
  - 加 `rematchOrder(db, orderId, reason, adminUid?)`
    - transaction：move bids → bidHistory，清 driverId / assignedAt / assignedBy / bids / passengerConfirmationStatus，dispatchAt=now，reMatchRound++
    - return 原中選 driverId（給 LINE push）
- [ ] `server/utils/line-soft-match-push.ts` 🆕
  - `pushSoftMatchToPassenger(env, order, driver, matchResult)`
  - 3 button postback flex
- [ ] `server/utils/line-dispatch-push.ts` 改：
  - 加 `pushDriverDeselected(env, order, driverId)` → 通知原中選 driver
  - 加 `pushPassengerRematch(env, order)` → 通知 passenger「正在重新配對」
- [ ] `server/utils/audit-log.ts` 改：
  - `AuditAction` 加 `order.rematch` / `order.soft_match_response`

## 3. server endpoints（60 min）
- [ ] `server/routes/nuxt-api/admin/orders/[orderId]/assign.post.ts` 改：
  - assign 後判斷 isSoftMatch → 設 `passengerConfirmationStatus = 'pending' | 'auto'`
  - isSoftMatch → 走 `pushSoftMatchToPassenger`
  - 完全命中 → 走既有 `pushOrderAssignedToPassenger`
- [ ] `server/routes/nuxt-api/admin/orders/[orderId]/rematch.post.ts` 🆕
  - admin + canManageOrders 守則
  - 呼叫 `rematchOrder()` + audit + 3 個 LINE push
- [ ] `server/routes/nuxt-api/passenger/orders/[orderId]/soft-match-decision.post.ts` 🆕
  - passenger（order owner）守則
  - body: `{ decision: 'accept' | 'wait' | 'cancel' }`
  - accept / wait / cancel 三分支
  - 寫 audit
- [ ] 既有 LINE webhook 處理：
  - 加 `passenger.softMatch.<decision>?orderId=XXX` postback handler
  - parse orderId + decision → internal `soft-match-decision.post.ts` endpoint
  - 回 LINE reply（簡單 ack 訊息）

## 4. protocol（10 min）
- [ ] `app/protocol/fetch-api/api/admin/order-dispatch/index.ts` 改：加 `ForceRematch(orderId, body)`
- [ ] passenger soft match decision 主要走 LINE postback，不一定要 fetch-api（若要 web fallback 可加 `PostSoftMatchDecision`）

## 5. Admin UI（45 min）
- [ ] `app/pages/admin/orders/[id].vue` 改：
  - confirmed section 顯示 `passengerConfirmationStatus` tag
  - 加「強制重新配對」按鈕 + confirm dialog（理由 textarea）
  - 顯示 `bidHistory[]` section（歷次配對輪次）
- [ ] `app/pages/admin/orders/index.vue` 改：
  - reMatchRound > 0 加「重派 {N} 次」徽章

## 6. Driver UI（10 min）
- [ ] `app/pages/driver/dispatched/[orderId].vue` 改（若該頁存在）：
  - 若 driver 是 assigned driver 且 confirmationStatus='pending' → 顯示「等待乘客確認」狀態

## 7. i18n（20 min）
- [ ] zh / en / ja 三檔加 `notification.softMatch.*` 與 `notification.rematch.*`（passenger 三語）
- [ ] admin / driver UI 文字繁中即可

## 8. 驗證（10 min）
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`

## 9. 真機 smoke（30 min）
- [ ] admin 指派完全命中 driver → passenger 收正常配對 push
- [ ] admin 指派部分命中 → passenger 收 3 按鈕 Flex
- [ ] 點「接受」→ admin 端 confirmationStatus='accepted'
- [ ] 點「等下一輪」→ admin 端訂單回 pending、reMatchRound=1、bidHistory 加一筆、全部 driver 收新需求單
- [ ] 點「取消訂單」→ cancelled_by_passenger，無扣款
- [ ] admin 點「強制重新配對」→ 同上 wait 流程，原 driver 收 deselect 通知
- [ ] admin 訂單列表正確顯示重派次數徽章

## 10. commit + HANDOFF
- [ ] commit message: `feat: Phase 1F — Soft Match + 重新配對流程`
- [ ] **不 push**
- [ ] 寫 HANDOFF.md
- [ ] 回報「Phase 1F 完工，等 Brain AI 點『進 1G』」
