# Design — Phase 1F Soft Match 確認 + 重新配對

## 1. 資料模型變動

### 1.1 `orders/{orderId}` 新增欄位

```ts
order.passengerConfirmationStatus?: 'auto' | 'pending' | 'accepted' | 'declined'
// auto: matchCount 完全命中，無需詢問
// pending: 已 LINE push 3 選 1，等乘客回應
// accepted: 乘客接受
// declined: 乘客拒絕 → 訂單已 cancelled_by_passenger

order.reMatchRound?: number          // default 0；每次 rematch +1

order.bidHistory?: Array<{
  round: number                       // reMatchRound 當下的值
  bids: OrderBid[]                    // 該輪結束時的 bids snapshot
  endReason: 'assigned' | 'rematched_by_passenger' | 'rematched_by_admin'
  endedAt: Timestamp
  endedBy?: string                    // admin uid（rematched_by_admin 時）
}>
```

### 1.2 不新增 collection

所有狀態仍在 `orders/{orderId}` 內。

## 2. Soft Match 判定

`server/utils/order-soft-match.ts` 🆕：

```ts
export function isSoftMatch(
  preferenceTagIds: string[],
  driverMatchResult: DriverMatchResult,
): boolean {
  if (preferenceTagIds.length === 0) return false  // 無偏好 → 不可能 soft
  return driverMatchResult.matchCount < preferenceTagIds.length
}
```

## 3. server endpoints

### 3.1 改寫 `assign.post.ts`（1E 既有）

加邏輯：
```
matchResult = computeDriverMatch(...)
if (isSoftMatch(preferenceTagIds, matchResult)) {
  order.passengerConfirmationStatus = 'pending'
  await pushSoftMatchToPassenger(env, order, driver, matchResult)
} else {
  order.passengerConfirmationStatus = 'auto'
  await pushOrderAssignedToPassenger(...)  // 1E 既有
}
await pushOrderAssignedToDriver(...)  // 1E 既有，仍同樣推給中選 driver
```

### 3.2 admin 強制重新配對 `POST /nuxt-api/admin/orders/[orderId]/rematch.post.ts` 🆕

- Auth: admin + `canManageOrders`
- Body: `{ reason?: string }`
- 守則（transaction）：
  - order.status === 'confirmed'
  - order.driverId 必須存在
- 動作（transaction）：
  - 把當前 `{ bids, driverId, assignedAt, assignedBy }` snapshot 到 `bidHistory` push
  - 清 `driverId` / `assignedAt` / `assignedBy` / `bids` / `passengerConfirmationStatus`
  - `dispatchAt = now`、`reMatchRound = (現有 + 1)`
  - `status = 'pending'`
- audit log: `order.rematch`
- 觸發：
  - LINE push 原中選 driver「您本次未繼續中選」
  - LINE push 所有 active driver 新需求單（沿用 1E `pushOrderDispatchToAllDrivers`）
  - LINE push passenger「正在重新為您配對」

### 3.3 passenger Soft Match decision `POST /nuxt-api/passenger/orders/[orderId]/soft-match-decision.post.ts` 🆕

- Auth: order owner (lineUid match)
- Body: `{ decision: 'accept' | 'wait' | 'cancel' }`
- 守則：order.passengerConfirmationStatus === 'pending'
- 動作：
  - `accept`：寫 `passengerConfirmationStatus = 'accepted'`；audit `order.soft_match_response`
  - `wait`：呼叫 `rematchOrder()`（同 3.2 邏輯）；audit `order.soft_match_response`
  - `cancel`：呼叫既有取消邏輯 + 通知 active bidders 取消；audit + `passengerConfirmationStatus = 'declined'` + `status = 'cancelled_by_passenger'`
- Response: `{ data: { decision, status }, status }`

### 3.4 LINE postback handler

在既有 LINE webhook 處理流程（grep `postback.data` / `webhook.post.ts`）加 case：

```
data 格式：passenger.softMatch.<decision>?orderId=<id>
```

3 個 case：
- `passenger.softMatch.accept?orderId=XXX` → 呼叫 3.3 endpoint with decision='accept'
- `passenger.softMatch.wait?orderId=XXX` → 同上 decision='wait'
- `passenger.softMatch.cancel?orderId=XXX` → 同上 decision='cancel'

postback 收到後：
- LINE bot reply 簡單訊息（「已收到您的選擇」）
- 同步 / 非同步呼叫 internal endpoint 寫狀態

## 4. LINE Soft Match Flex

`server/utils/line-soft-match-push.ts` 🆕：

```
Header:
  title: 「⚠️ 配對部分符合」
  subtitle: 「您勾選的 {N} 項偏好中，{M} 項符合」

Body:
  - 司機：{driverDisplayName}
  - ✓ 符合偏好：{matchedTagNames join '、'}
  - ✗ 未符合：{unmatchedTagNames join '、'}
  - 上車時間：{bookingAt}
  - 完成單數：{completedOrders}
  - 「查看車輛」link → /vehicles/{driverId}

Footer buttons（3 個）:
  1. 接受此車（primary）  → postback: passenger.softMatch.accept
  2. 等下一輪配對（secondary） → postback: passenger.softMatch.wait
  3. 取消訂單（warn） → postback: passenger.softMatch.cancel
```

Helper sig：`pushSoftMatchToPassenger(env, order, driver, matchResult)`。

## 5. Admin UI 改動

### 5.1 訂單詳情頁 confirmed section 顯示

當 `order.status === 'confirmed'`：

```pug
.AdminOrderConfirmed
  .header 已配對：{{ driver.displayName }}
  .status-row
    span 乘客確認狀態：
    ElTag(:type="confirmationTagType") {{ confirmationLabel }}
    //- auto: 自動接受（success）
    //- pending: 等待乘客回應（warning）
    //- accepted: 已接受（success）
    //- declined: 已拒絕（danger - 但會跳到 cancelled）

  .rematch-section
    ElButton(type="warning" @click="ClickForceRematch") 強制重新配對
    //- 點下開 confirm dialog：填理由 textarea + 確認 → 觸發 rematch endpoint

.AdminOrderHistory(v-if="order.bidHistory?.length")
  h4 配對歷史
  .round(v-for="h in order.bidHistory" :key="h.round")
    span Round {{ h.round }} - {{ h.endReason }} - {{ formatDate(h.endedAt) }}
    .bids
      span(v-for="b in h.bids" :key="b.driverId")
        | {{ b.driverDisplayName }}（{{ formatDate(b.bidAt) }}）
```

### 5.2 訂單列表徽章

reMatchRound > 0 → 顯示「重派 {N} 次」徽章（admin 列表頁）。

## 6. i18n

```js
// zh - passenger 通知
notification.softMatch: {
  title: '⚠️ 配對部分符合',
  subtitle: '您勾選的 {total} 項偏好中，{matched} 項符合',
  matched: '✓ 符合偏好',
  unmatched: '✗ 未符合',
  driver: '司機',
  bookingAt: '上車時間',
  completedOrders: '完成單數',
  viewVehicle: '查看車輛',
  btnAccept: '接受此車',
  btnWait: '等下一輪配對',
  btnCancel: '取消訂單',
  ackAccepted: '已接受配對，行程即將開始',
  ackWait: '已重新進入配對佇列，將盡快為您找新車輛',
  ackCancel: '訂單已取消',
}
notification.rematch.passenger: {
  title: '🔄 正在重新為您配對',
  body: '原車輛已撤回，正在尋找其他符合的司機',
}
notification.rematch.driverDeselected: {
  title: '🔁 訂單已重新分派',
  body: '訂單 {orderId} 已重新進入配對，本次未由您接單',
}

// en / ja: 同結構，自行翻譯
```

## 7. Tests

- 不寫 component 單元測試
- server endpoint 手測為主
- isSoftMatch unit test 加入 `shared/orderDispatch.spec.ts`（或新 spec 檔）

## 8. 設計權衡與已知陷阱

1. **passenger 不回應 LINE 怎辦**：confirmationStatus 停在 'pending'。admin 可在 UI 看到此狀態 + 手動觸發 force rematch 救。可加 SLA：12h 沒回應自動 rematch（本 phase 不做）。
2. **3 選 1 期間 driver 該等嗎**：driver 仍處於「中選」狀態（仍在 `order.driverId`）。但若 passenger 點 wait/cancel，driver 才會收到 deselect 通知。driver 在這段空窗期不確定能不能接是真實風險。可加：confirmationStatus='pending' 期間 driver 看訂單詳情顯示「等待乘客確認」。本 phase 做。
3. **bidHistory 越累越大**：reMatchRound 不設上限 → 理論上 1 張訂單可累積 N 輪。實務上 admin 應在 2-3 輪後判斷單不可滿足而取消。可加上限警告（本 phase 不做）。
4. **後付意味全額退款是 noop**：第三個按鈕「取消訂單」實際上就是 cancelled_by_passenger，不寫任何 refund 邏輯。若後續改前付（Phase 2+ 加金流），這裡要補退款 hook。
5. **car LINE postback handler 既有架構**：需 grep `postback.data` 看現有處理 case，加新 prefix `passenger.softMatch.*`。不影響既有 case。
6. **driver 反悔流程**：本 phase 走 admin 手動「強制重新配對」。未來可加 driver 端「我無法接此單」按鈕（自助），但會有濫用風險（被 assign 後反悔），優先級低。
