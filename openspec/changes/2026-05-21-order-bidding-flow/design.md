# Design — Phase 1E 訂單需求單 + 司機喊單 + Admin 配對

## 1. 資料模型變動

### 1.1 `orders/{orderId}` 新增 top-level 欄位

```ts
order.dispatchAt?: Timestamp           // admin 發單時間（null = 未發單）
order.dispatchedBy?: string            // admin uid
order.bids?: Array<OrderBid>           // append-only
order.assignedAt?: Timestamp           // admin 挑選時間
order.assignedBy?: string              // admin uid

interface OrderBid {
  driverId: string                     // lineUid
  driverDisplayName: string            // snapshot at bid time
  bidAt: Timestamp
  withdrawnAt?: Timestamp              // null = active；有值 = driver 撤回
}
```

**為何 snapshot driverDisplayName**：driver 改名後 admin 看 bids 還是當時 bid 的名字（一致性）。

### 1.2 不新增 collection

所有狀態都在 `orders/{orderId}` doc 內。LINE event 已有 audit 機制（P43 line_event_logs 既存）。

## 2. 純函式 layer

### 2.1 `shared/orderDispatch.ts` 🆕

```ts
export interface DriverTagSnapshot {
  driverId: string
  vehicleProfileTags: string[]    // tag ids
  driverScopeTags: string[]       // tag ids
}

export interface MatchedTag {
  id: string
  name: string                    // localized
  group: TagGroup
}

export interface DriverMatchResult {
  matchCount: number
  matched: MatchedTag[]
  preferenceCount: number         // 乘客原本勾的數量
}

export function computeDriverMatch(
  preferenceTagIds: string[],
  driver: DriverTagSnapshot,
  tagIndex: ReadonlyMap<string, { id: string; name: { zh_tw: string; en?: string; ja?: string }; group: TagGroup }>,
  lang: 'zh_tw' | 'en' | 'ja',
): DriverMatchResult
```

邏輯：
- driverAllTags = `Set([...vehicleProfileTags, ...driverScopeTags])`
- matched = `preferenceTagIds.filter(id => driverAllTags.has(id) && tagIndex.has(id))`
- 解析 name（依 lang fallback 繁中）
- matchCount = matched.length
- preferenceCount = preferenceTagIds.length

### 2.2 unit test cases（≥ 7）

- 乘客 0 偏好 → matchCount=0
- 乘客 3 偏好，driver 全擁有 → matchCount=3
- 乘客 3 偏好，driver 0 擁有 → matchCount=0
- 乘客 3 偏好，driver 部分擁有 → matchCount=部分
- 含 archived tag id → 不算 match（不在 tagIndex 內）
- driver-scope tag 也算 match（不分 scope）
- lang fallback 正確

## 3. server endpoints

### 3.1 admin 發單

`POST /nuxt-api/admin/orders/[orderId]/dispatch`

- Auth: admin + `canManageOrders`
- 守則：
  - order 存在
  - order.status === 'pending'
  - order.dispatchAt 為 null
- 寫入：`{ dispatchAt: now, dispatchedBy: auth.lineUid }`
- audit log: action='order.dispatch'
- 觸發：LINE push 所有 active driver（fire-and-forget；err 進 line_api_errors）
- Response: `{ data: { dispatchAt }, status }`

### 3.2 driver 接單看板列表

`GET /nuxt-api/driver/dispatched-orders`

- Auth: driver
- Query: 無
- 邏輯：
  - 撈 `orders where status==='pending' && dispatchAt != null && driverId == null`
  - 過濾掉「自己已 bid 且未撤回」的（driver 已喊單則跑到「已喊單」tab）
  - 依 booking 時段升序排（最近的在前）
- Response 每筆：
  ```ts
  {
    orderId, bookingAt, pickup, dropoff, passengerCount, fareEstimate,
    preferences: { tagIds, tagSnapshot },
    dispatchAt, myBidStatus: 'none' | 'bid' | 'withdrawn'
  }
  ```

或拆兩個 endpoint：`/dispatched` 和 `/my-bids` 分別撈。本 spec 採前者，response 多帶 `myBidStatus`。

### 3.3 driver 喊單

`POST /nuxt-api/driver/orders/[orderId]/bid`

- Auth: driver（必須 approved）
- 守則（transaction 內）：
  - order.status === 'pending'
  - order.dispatchAt != null
  - order.driverId == null
  - `order.bids` 內無**未撤回**的本 driver bid（撤回後可重 bid）
- 寫入：`order.bids` append `{ driverId, driverDisplayName, bidAt: now }`
- audit log: action='order.bid'
- Response: `{ data: { bidAt }, status }`

### 3.4 driver 撤回喊單

`DELETE /nuxt-api/driver/orders/[orderId]/bid`

- Auth: driver
- 守則：
  - order.status === 'pending' && order.driverId == null
  - 該 driver 有 active bid
- 寫入：把對應 bid 的 `withdrawnAt = now`（不真的 splice 陣列，保留歷史）
- audit log: action='order.bid_withdraw'

### 3.5 admin 看喊單清單

`GET /nuxt-api/admin/orders/[orderId]/bids`

- Auth: admin + `canManageOrders`
- 邏輯：
  1. 載 order doc
  2. 對 `order.bids` 內每個 bid（含 withdrawn）：
     - 讀對應 `drivers/{driverId}` doc（vehicleProfile / driver-scope tags / completedOrders / verifiedAt）
     - 計算 `computeDriverMatch(preferenceTagIds, driverSnapshot, tagIndex, 'zh_tw')`
- Response：
  ```ts
  {
    bids: [{
      driverId, driverDisplayName, bidAt, withdrawnAt,
      matchCount, matchedTagNames: string[],
      preferenceCount, completedOrders, verifiedAt
    }]
  }
  ```

### 3.6 admin 指派司機

`POST /nuxt-api/admin/orders/[orderId]/assign`

- Auth: admin + `canManageOrders`
- Body: `{ driverId: string }`
- 守則（**transaction**）：
  - order.status === 'pending'
  - order.dispatchAt != null
  - order.driverId == null
  - body.driverId 在 order.bids 內且未 withdrawn
- 寫入：`{ driverId, status: 'confirmed', assignedAt: now, assignedBy: auth.lineUid }`
- audit log: action='order.assign', payload 含 matchCount snapshot
- 觸發：
  - LINE push passenger（配對成功 + 連結 `/vehicles/{driverId}`）
  - LINE push driver（中選通知）
- Response: `{ data: { driverId, assignedAt }, status }`

### 3.7 取消訂單 hook（既有 PATCH endpoint 擴充）

`PATCH /nuxt-api/orders/[orderId]` 或 admin/orders/[id] PATCH：
- 若 cancel 動作且 order.dispatchAt 存在且 order.bids 非空 → fire-and-forget 通知所有 active bid 的 driver「此單已取消」

## 4. UI

### 4.1 Admin 訂單詳情頁 `app/pages/admin/orders/[id].vue` 改

加 section：

```pug
.AdminOrderDispatch(v-if="order.status === 'pending'")
  // 未發單
  template(v-if="!order.dispatchAt")
    ElButton(type="primary" @click="ClickDispatch") 發出需求單
  // 已發單，尚未指派
  template(v-else-if="!order.driverId")
    .header
      span 已派發於 {{ formatDate(order.dispatchAt) }}
      span {{ bidsCount }} 司機喊單中
    OrderBidList(:bids="bids" @assign="ClickAssign")
  // 已指派
  template(v-else)
    .header 已指派給 {{ assignedDriverName }}（{{ formatDate(order.assignedAt) }}）
```

### 4.2 `OrderBidList.vue` 🆕

Props: `bids: AdminBidDto[]`
Emits: `assign(driverId)`

每個 bid 卡片顯示：
- 司機名（snapshot at bid time）
- ★ 標籤命中率：`matchCount / preferenceCount`（顯示「3/5 命中」）
- ✓ 完成訂單數
- 認證時間（verifiedAt）
- bidAt 時間
- 「指派」按鈕（withdrawn 的 bid 灰掉、無按鈕）

排序：未撤回優先 → matchCount desc → completedOrders desc → bidAt asc（先喊先排前）。

### 4.3 Admin 訂單列表 `app/pages/admin/orders/index.vue` 改

每張訂單卡片右上加徽章：
- 未派發、status=pending → 「⚠ 待派發」
- 已派發、bids=0 → 「📤 待喊單」
- 已派發、bids ≥ 1、未指派 → 「{count} 喊單」徽章
- confirmed → 「已配對」

### 4.4 Driver 接單看板 `app/pages/driver/dispatched/index.vue` 🆕

```pug
.DriverDispatched
  ElTabs(v-model="activeTab")
    ElTabPane(label="可接訂單" name="available")
      DispatchedOrderCard(v-for="o in availableOrders" :key="o.orderId" :order="o" @open="ClickOpen")
    ElTabPane(label="已喊單" name="mine")
      DispatchedOrderCard(v-for="o in myBids" :key="o.orderId" :order="o" :show-withdraw="true" @open="ClickOpen" @withdraw="ClickWithdraw")
```

### 4.5 Driver 訂單詳情 `app/pages/driver/dispatched/[orderId].vue` 🆕

顯示：
- 訂單基本資訊（時段 / 上下車 / 人數 / fare 估算）
- 乘客偏好（chip list）
- 自己車輛是否符合偏好（match 高亮）
- 「我要接這單」按鈕（若已 bid → 「撤回喊單」）

點按鈕 → call `$api.PostBid(orderId)` 或 `DeleteBid`。

### 4.6 `DispatchedOrderCard.vue` 🆕

簡要卡片：時段 / 上下車 / 預估金額 / 偏好標籤 chip / 自己 match 數標示。

## 5. LINE 推播模板（hard-coded）

`server/utils/line-dispatch-push.ts` 🆕：

### 5.1 訂單需求單推播

對象：所有 `drivers where approved=true` 的 lineUid（passenger channel push）

Flex template:
- Header: 「📦 新訂單派發」+ 預估金額
- Body: 時段 / 上下車 / 人數 / 偏好標籤 chip list（最多 5 個）
- Footer button: 「查看詳情」→ `liff.url` 開 `/driver/dispatched/[orderId]`（或 web 直連）

### 5.2 配對成功通知 passenger

對象：order.userId

Flex template:
- Header: 「🎉 配對成功」+ 上車時間
- Body: 車牌（**不寫車牌**，本期只有 verified driver name + 公開頁）/ 司機名 / 完成單數
- Footer button: 「查看車輛」→ `/vehicles/{driverId}`

### 5.3 中選通知 driver

對象：assigned driverId

Flex template:
- Header: 「✅ 您已中選」+ 上車時間
- Body: 上下車 / 乘客人數 / 注意事項
- Footer button: 「查看訂單」→ `/driver/orders/[orderId]`（既有路徑）

### 5.4 取消通知 active bidders（取消訂單時）

簡單 text：「訂單 XXX 已取消，您的喊單已自動撤回」

## 6. firestore.rules

**不動**。orders client 寫入仍 false，皆走 server endpoint。本 phase 不加新 collection。

## 7. Tests

- `shared/orderDispatch.spec.ts` ≥ 7 case
- 整合測試手測為主（race condition 用 firestore emulator 或真機跑）
- E2E 留 1G

## 8. 設計權衡與已知陷阱

1. **bid 撤回後可重 bid**：driver 撤回後若仍想接，可再喊；server 端只擋「未撤回的 active bid 不可重複」。
2. **MatchCount 不存進 bid**：理由是 driver 在 bid 時車輛狀況可能還會變（雖然本 phase 不支援，1F 重新配對才用），所以 admin 看 bids 時即時算最準。但會增加 read 量（每張 bid card 都要讀 driver doc）。可接受。
3. **multiple drivers 同時 bid race**：append 用 firestore array union 或 transaction read-then-write。建議 transaction（safer）。
4. **admin 同時 assign 兩個 driver race**：transaction 守則 `order.status === 'pending' && order.driverId == null`；第二個進來就會 fail。
5. **撤回的 bid 仍占空間**：保留歷史可給 admin 看「這 driver 喊了又撤」。`order.bids.length` 增長無上限；極端情況下若一張單被 100 driver 撤來撤去會肥。本 phase 不處理（可加 archival policy 至 Phase 2）。
6. **訂單需求單推播沒過濾**：B1 拍版「推全部」。若日後 driver 量大，可加 server 端過濾（如：4 人座訂單只推給 4/7/9 人座 driver）。本 phase 不做。
7. **assigned driver 反悔**：driver 中選後不接，本 phase 沒處理。應該由 admin 取消訂單再重派（走 1F 重新配對流程）。
