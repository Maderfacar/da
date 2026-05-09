# Design — P19 Driver Trip Mission

## Context

P18 完成 collection split（drivers / admins 獨立 collection）+ admin 三層分權後，driver 端剩下三個明顯缺口：
1. 沒有「我的任務」頁面（搶單後不知道去哪看自己的訂單）
2. 訂單狀態流粒度太粗（admin 看不到司機目前在「出發中」還是「已到點」）
3. 定位機制錯位（依賴司機手動上線；war-room 顯示不準）

## Goals

- driver 一登入即自動定位 + 持續 alive ping，不需手動上下線
- driver 在任務頁完整看得到自己被指派的訂單，並逐步操作五階段流程
- admin 在 war-room 即時看到每位司機的精確位置 + 任務進度 + 在線狀態
- 訂單狀態語意清楚對齊司機實際操作節點

## Non-Goals

- **不**改變既有搶單頁面（`/driver/pending`）
- **不**做接單通知（push 通知 / LINE Notify 等）— admin 指派後 driver 端 30s polling 會 refresh
- **不**做訂單拒絕功能（driver 接單後不可主動取消，只有 owner / admin 可改 cancelled）
- **不**做即時推送（WebSocket / Firestore realtime listener）— 30s polling 已足夠戰情室需求
- **不**做 driver 評分系統（drivers.rating 欄位 P18 已預留但本 spec 不啟用）
- **不**做 admin 戰情室畫誤差圈 / accuracy 視覺化（accuracy 寫入 Firestore 但 UI 顯示留 P20+）
- **不**對 P18 收尾的 driverApplication 搬遷做事；本 spec 完成後再開獨立 mini change

## Decisions

### 決策 1：drivers.status 語意調整 — Firestore 只存 online/busy；offline 由 lastActiveAt 推導；busy 從「出發」開始

**選擇**：
- driver 端不再寫 `offline` 進 Firestore。drivers.status 永遠只會是 `online` 或 `busy`
- war-room 端 client-side 比對 `lastActiveAt` 與當前時間，差距超過 **600 秒（10 分鐘）** 推導為 `offline`
- `busy` 觸發點是訂單由 `confirmed → en_route`（司機按「出發」），**不是接單時**。confirmed 階段 driver 仍 online + 有 active assigned order

**為何 600 秒而非 60 秒**：driver→server ping 頻率為 60 秒一次（force refresh），正常情況 `lastActiveAt` 每分鐘刷新；600 秒等於連續 10 次 ping 失敗才視為 offline，給網路臨時抖動充分緩衝，避免「司機正在開車但訊號短暫不好就被判 offline」的誤殺。

**為何 busy 從 en_route 開始而非 confirmed**：使用者指定。語意上，confirmed = 已接單待執行（仍可被 admin 重新指派或臨時取消）；en_route = 真的在跑這張單。confirmed 階段把 driver 視為 online + 有 assigned order，可在 war-room 側邊面板顯示「待執行訂單」但不算「任務中」filter。

**替代方案**：
- A. 維持 P18 設計（driver 主動切 offline）：與使用者「無上下線按鈕」需求衝突，已捨棄
- B. server cron job 每分鐘掃 drivers 把 stale 的設 offline：增加運維成本，且 Firestore 寫入頻繁（無實質好處），已捨棄
- C. 完全不存 status 欄位，全 server-side derive：API 每次都要 join orders 算 busy，效能差，已捨棄

**理由**：driver 端寫入位置時順便維護 status（online/busy）成本低；offline 是「沒有寫入訊號」的副產品，自然由「最後更新時間」推導即可，符合「fail-quiet」原則。

### 決策 2：訂單狀態機嚴格不可跳階段

**選擇**：driver 改 order status 必須符合：`confirmed → en_route → arrived_pickup → in_transit → completed`，server 端 reject 跳階段（如 confirmed → completed 拒）。

**替代方案**：寬鬆驗證、由前端控制按鈕邏輯：踩過幾次司機誤點 / 重複點擊 / 後端 race，已捨棄

**理由**：狀態機嚴格化可在 server 層擋掉所有亂跳，前端按鈕只是輔助 UX；萬一前端 bug，後端仍能保護資料完整性。

### 決策 3：driver active order 用「server-side query」而非「client-side derive」

**選擇**：新增 `/nuxt-api/orders/assigned.get.ts` endpoint，driver 帶 token 查詢 `where('assignedDriverId', '==', auth.uid)` + `where('orderStatus', 'in', [confirmed, en_route, arrived_pickup, in_transit])`。

**替代方案**：在既有 `/orders/index.get.ts` 加 `query.assignedDriverId` 參數：endpoint 職責變混雜（既有給 owner 看訂單，又給 driver 看任務），且 driver 是「我的任務」語意更清楚走獨立 endpoint，已捨棄。

**理由**：前端 driver/trip onMounted 一次 query 拿到 active orders 即可，不需 client-side filter；endpoint 語意清楚（passenger → orders/index.get；driver 任務 → orders/assigned.get）。

### 決策 4：geolocation watch 在 layout 啟動，整 driver 端期間共用

**選擇**：`layouts/driver.vue` onMounted 啟動 watchPosition；切換 `/driver/dashboard` `/driver/trip` `/driver/profile` `/driver/pending` 時 layout 不重 mount，watch 持續執行；onUnmounted（離開 driver 端）才 clearWatch。

**替代方案**：
- A. 每個 page 各自啟動 watch：切頁就重啟，重新觸發授權（已踩過坑），已捨棄
- B. plugin 啟動 + 全站運行：gas 過大（passenger / admin 不需要 GPS），已捨棄

**理由**：watch 啟動成本一次（授權框只彈一次），driver 端切頁 share state，offline → online → busy 切換自然連續。

### 決策 5：上傳節流 — 5m / 60s / 50m accuracy / status 變化必傳

**選擇**：

```ts
const shouldUpload = (newPos, lastUploadedPos, lastUploadAt, statusChanged) => {
  if (statusChanged) return true; // status 變化必傳
  if (!lastUploadedPos) return true; // 首次必傳
  if (newPos.accuracy > 50) return false; // 過於不準，等收斂
  if (haversineDistance(newPos, lastUploadedPos) >= 5) return true; // 移動 5m+
  if (Date.now() - lastUploadAt >= 60_000) return true; // 60s alive ping
  return false;
};
```

**替代方案**：
- 純距離（5m）：靜止司機永遠不上傳，war-room 看不到他在線
- 純時間（30s）：移動極快時可能 miss 重要轉彎位置
- 結合：兼得；已採用

### 決策 6：geolocation 拒絕授權的回退路徑

**選擇**：blocking modal「司機端需要位置權限以執行任務追蹤。請至 LINE / 瀏覽器設定開啟位置權限後重新進入。」+「重試授權」按鈕；點重試呼叫 `getCurrentPosition`；連續拒絕 2 次或 5 秒沒回應 → `navigateTo('/home')`。

**理由**：給使用者一次重試機會（避免誤點拒絕無法恢復），但不無限 retry（避免 hang）；強制踢回 `/home` 而非 `/login`，因為 multi-role 使用者可能仍想用 passenger 端。

## Order Schema 細節

```typescript
// orders/{orderId}
interface OrderDoc {
  // 既有欄位（P14/P17 已有）
  orderId: string;
  userId: string;          // 訂單擁有者（不帶 prefix 的 lineUid，P17 起）
  lineUserId: string;
  orderType: 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';
  vehicleType: 'sedan' | 'mpv' | 'suv' | 'van';
  pickupDateTime: string;
  pickupLocation: { address, lat, lng, placeId?, displayName? };
  dropoffLocation: { address, lat, lng, placeId?, displayName? };
  passengerCount: number;
  estimatedFare: number;
  distanceKm: number;
  assignedDriverId: string | null;  // 'line:Uxxx' 格式（P14/P18）
  orderStatus: 'pending' | 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit' | 'completed' | 'cancelled';  // ← 新增 en_route, arrived_pickup
  createdAt: Timestamp;

  // P19 新增（每次 status 變更時 server 寫入時戳）
  statusHistory?: {
    confirmedAt?: Timestamp;
    enRouteAt?: Timestamp;
    arrivedPickupAt?: Timestamp;
    inTransitAt?: Timestamp;
    completedAt?: Timestamp;
    cancelledAt?: Timestamp;
  };
}
```

## Driver Schema 變更

```typescript
// drivers/{lineUid} —— P19 變更
interface DriverDoc {
  // ... P18 既有
  status: 'online' | 'busy';  // ← P19 移除 'offline'，由 lastActiveAt 推導
  location: {
    lat: number;
    lng: number;
    heading?: number;
    accuracy?: number;        // ← P19 新增
    updatedAt: Timestamp;
  } | null;
  lastActiveAt: Timestamp;    // ← P18 已有，P19 重要性升級（war-room offline 推導依據）
  // ... 其他既有
}
```

## API Schema

### `GET /nuxt-api/orders/assigned`（新增）

driver 取自己被指派的 active orders。

```typescript
// Response
{
  data: Array<{
    orderId: string;
    orderType: string;
    vehicleType: string;
    pickupDateTime: string;
    pickupLocation: { address, lat, lng, displayName? };
    dropoffLocation: { address, lat, lng, displayName? };
    passengerCount: number;
    estimatedFare: number;
    distanceKm: number;
    orderStatus: 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit';
    createdAt: number;  // millis
  }>;
  status: { code: 200, message: { ... } };
}
```

驗證：
- `auth.roles.includes('driver')` && `auth.approved`，否則 forbidden
- 強制 `where('assignedDriverId', '==', auth.uid)`（driver 不能指定他人）

### `PATCH /nuxt-api/orders/[orderId]`（修改）

接受新狀態 + 嚴格狀態機。

```typescript
// 既有：admin 任意；owner 只可 cancelled
// 新增：driver 自己的 active order 可推進狀態（嚴格狀態機）
//
// 狀態機：
//   confirmed → en_route → arrived_pickup → in_transit → completed
//   {confirmed, en_route, arrived_pickup} → cancelled (admin only)
//
// driver 改 status 時，server 同步：
//   en_route:  drivers/{driver}.status = 'busy'（不是 confirmed！）
//   completed: drivers/{driver}.status = 'online'（如無其他「執行中」訂單；
//              「執行中」= en_route / arrived_pickup / in_transit）
//   並 increment 訂單統計（已 P18 實作於 completed 觸發點）
//
// 每次 status 變更時 server 寫 statusHistory.{state}At = serverTimestamp()
```

### `GET /nuxt-api/drivers/available`（修改）

撈所有 drivers + driver 的 active order 摘要（讓 war-room 顯示「任務中：訂單 #ABC123」）。

```typescript
// Response
{
  data: Array<{
    driverId: string;
    displayName: string;
    status: 'online' | 'busy';
    lat: number;
    lng: number;
    heading: number | null;
    accuracy: number | null;     // ← P19 新增
    updatedAt: number;            // millis
    lastActiveAt: number;         // ← P19 新增（war-room 推導 offline 用）
    activeOrder: {                // ← P19 新增（busy driver 才有）
      orderId: string;
      orderStatus: 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit';
    } | null;
  }>;
}
```

### `PUT /nuxt-api/drivers/[id]/location`（修改）

寫入時自動維護 status。

```typescript
// 既有 body: { lat, lng, heading?, status?, displayName? }
// 新增 body: accuracy?: number
//
// 行為變更：
//   - 不再接受 client 帶 status='offline'（driver 端登出邏輯不寫 offline）
//   - body.status 缺省 → server 推導：driver 有 active order → busy；否則 online
//   - body.status 'busy' / 'online' → 接受並寫入
//
// （driver 不主動切 status，但保留 admin / 偵錯能力）
```

## Frontend State Machine（driver/trip）

```typescript
// app/pages/driver/trip/index.vue
type ActiveStatus = 'confirmed' | 'en_route' | 'arrived_pickup' | 'in_transit';

const ACTION_BY_STATUS: Record<ActiveStatus, {
  next: 'en_route' | 'arrived_pickup' | 'in_transit' | 'completed';
  label: string;
  i18nKey: string;
}> = {
  confirmed:       { next: 'en_route',       label: '前往上車點',     i18nKey: 'driverTrip.action.toPickup' },
  en_route:        { next: 'arrived_pickup', label: '已到達上車點',   i18nKey: 'driverTrip.action.arrived' },
  arrived_pickup:  { next: 'in_transit',     label: '乘客已上車',     i18nKey: 'driverTrip.action.boarded' },
  in_transit:      { next: 'completed',      label: '乘客已下車（完成）', i18nKey: 'driverTrip.action.complete' },
};

const ClickAdvance = async (order: AssignedOrder) => {
  const next = ACTION_BY_STATUS[order.orderStatus].next;
  // 1. 上傳當前座標（status 變化必傳，無視 5m threshold）
  await driverGeo.UploadNow();
  // 2. patch order status
  const res = await $api.PatchOrder(order.orderId, { orderStatus: next });
  // 3. 重 load active orders（completed 會從列表消失）
  await ApiLoadAssignedOrders();
};
```

## War-room State Filter

```typescript
type FilterMode = 'all' | 'online' | 'busy' | 'offline';

const OFFLINE_THRESHOLD_MS = 600_000; // 10 分鐘

const filteredDrivers = computed(() => {
  const now = Date.now();
  return drivers.value
    .map(d => ({
      ...d,
      derivedStatus: (now - d.lastActiveAt > OFFLINE_THRESHOLD_MS)
        ? 'offline' as const
        : d.status, // 'online' | 'busy'
    }))
    .filter(d => filter.value === 'all' || d.derivedStatus === filter.value);
});
```

Marker color：
- online → 綠
- busy → 琥珀
- offline → 灰（原本不顯示，改為灰圓點 + 半透明 0.4）

## i18n Keys（新增）

```js
// zh.js
status: {
  pending: '待指派',
  confirmed: '已接單',
  en_route: '前往上車',         // 新增
  arrived_pickup: '已到達上車點', // 新增
  in_transit: '行程中',
  completed: '已完成',
  cancelled: '已取消',
},
driverTrip: {  // 新增
  title: '我的任務',
  empty: '目前沒有指派任務',
  action: {
    toPickup: '前往上車點',
    arrived: '已到達上車點',
    boarded: '乘客已上車',
    complete: '乘客已下車（完成）',
  },
  passenger: '乘客',
  fare: '預估車資',
  distance: '距離',
},
warRoom: {  // 新增
  filter: { all: '全部', online: '上線', busy: '任務中', offline: '離線' },
  noActiveOrder: '待命中',
  activeOrder: '訂單 #{id}',
},
geoPermission: { // 新增
  title: '需要位置權限',
  body: '司機端需要位置權限以執行任務追蹤。請至 LINE / 瀏覽器設定開啟位置權限後重新進入。',
  retry: '重試授權',
},
```
