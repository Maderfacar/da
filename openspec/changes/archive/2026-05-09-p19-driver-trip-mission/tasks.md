# Tasks — P19 Driver Trip Mission

> 順序執行；每 stage 完 verify 再進下一。Stage gate 失敗回對應 stage 修。

## Stage 0：理解現況 + Brain AI 確認

- [x] 0.1 讀 P18 decision-log 全部 + P18 spec
- [x] 0.2 讀 driver/trip / driver/pending / driver/dashboard / driver layout / war-room 現況
- [x] 0.3 讀 orders/[orderId].patch.ts 現有 status 機 + drivers/available.get.ts + drivers/[id]/location.put.ts
- [x] 0.4 **Brain AI 確認 design.md 決策 1（drivers.status offline 由 lastActiveAt 推導）** — 等回覆

## Stage 1：訂單狀態擴充（後端）

- [x] 1.1 修 `server/routes/nuxt-api/orders/[orderId].patch.ts`：
  - 加 status 接受清單：`pending | confirmed | en_route | arrived_pickup | in_transit | completed | cancelled`
  - driver 改 status 嚴格狀態機：
    - confirmed → en_route（driver 必須是 assignedDriverId 本人）
    - en_route → arrived_pickup
    - arrived_pickup → in_transit
    - in_transit → completed
    - 其他跳階段：reject
  - status 切 `en_route` 時（**不是 confirmed**），read order doc 取 assignedDriverId → drivers/{driverId} merge `status: 'busy'`
  - status 切 `completed` 時，**先 query 該 driver 是否還有其他「執行中」訂單**（查 orders where assignedDriverId == X and orderStatus in [en_route, arrived_pickup, in_transit] limit 1，**不含 confirmed**）；若無 → drivers/{driverId} merge `status: 'online'`
  - 寫 `statusHistory.{state}At = serverTimestamp()`（每次 status 變更累加）
- [x] 1.2 lint 通過

## Stage 2：driver active orders endpoint（後端）

- [x] 2.1 新建 `server/routes/nuxt-api/orders/assigned.get.ts`：
  - require-auth + roles 含 driver + approved=true（沒核准 driver 不可拿任務）
  - query `where('assignedDriverId', '==', auth.uid)` `where('orderStatus', 'in', ['confirmed', 'en_route', 'arrived_pickup', 'in_transit'])`
  - 排序 createdAt desc
  - 回傳 `{ data: AssignedOrder[], status: ... }`
- [x] 2.2 lint 通過

## Stage 3：drivers/available + location.put（後端）

- [x] 3.1 修 `server/routes/nuxt-api/drivers/available.get.ts`：
  - query 改撈所有 location 不為 null 的 drivers（去掉 `where('status', 'in', [...])`）
  - 回傳新增：`accuracy`（從 location.accuracy）、`lastActiveAt`（millis）、`activeOrder`（busy driver 才有，read orders limit 1 取 orderId + orderStatus）
  - 注意：busy driver 取 active order 用 driverId（即 doc.id，去 prefix 後）配對 orders.assignedDriverId（line: prefix 格式）
- [x] 3.2 修 `server/routes/nuxt-api/drivers/[id]/location.put.ts`：
  - body 接受 `accuracy?: number`，與 location 一起寫入
  - body.status 缺省時：query 該 driver 是否有「執行中」訂單（en_route/arrived_pickup/in_transit）→ 有則寫 'busy'、無則寫 'online'（不再寫 'offline'；confirmed 不算執行中）
  - body.status 帶 'offline' → 拒絕（400 badRequest，driver 端不應主動寫 offline）
  - body.status 'busy' / 'online' → 維持原行為
- [x] 3.3 lint 通過

## Stage 4：driver 自動定位 composable

- [x] 4.1 新建 `app/composables/use-driver-geolocation.ts`：
  - 內部 state：`permissionState: 'pending' | 'granted' | 'denied'`、`currentPos`、`accuracy`、`lastUploadedPos`、`lastUploadAt`
  - `RequestPermission()`：呼叫 `getCurrentPosition` 觸發授權框；resolve granted/denied
  - `StartWatch()`：`watchPosition` callback：
    - 若 accuracy > 50m → skip
    - 若 lastUploadedPos 存在 + Haversine < 5m + (now - lastUploadAt) < 60s → skip
    - 否則 `_DoUpload()`
  - `UploadNow(force=true)`：跳過 5m / 60s / accuracy 檢查，立即上傳一次（給 status 變更時用）
  - `StopWatch()`：clearWatch + 清 state
  - 暴露 reactive state：`{ permissionState, currentPos, accuracy }`
- [x] 4.2 lint 通過

## Stage 5：driver layout 整合授權 + 全程 watch

- [x] 5.1 修 `app/layouts/driver.vue`：
  - import `useDriverGeolocation`
  - onMounted：
    - 跑 `RequestPermission()`：等使用者答覆 5 秒 timeout（5s 沒回 → 視為拒絕）
    - granted → `StartWatch()`
    - denied → 顯示 modal `<UiModal v-model:visible="showPermissionModal">`「司機端需要位置權限以執行任務追蹤」+ 重試按鈕
    - 重試按鈕點擊：再呼叫 `RequestPermission()`；連續拒絕 2 次 → modal 不再顯示，強制 `navigateTo('/home')`
  - onUnmounted：`StopWatch()`
- [x] 5.2 lint 通過

## Stage 6：driver/trip 重寫（任務列表 + 五階段操作）

- [x] 6.1 重寫 `app/pages/driver/trip/index.vue`：
  - 移除上下線按鈕、GPS 顯示卡（layout 接管）
  - 載入 active orders：onMounted 跑 `ApiLoadAssignedOrders`（call `GetAssignedOrders`）
  - 30 秒 polling + visibility refresh（同 orders/upcoming pattern）
  - 列表渲染（每張卡片）：
    - 訂單號（後 6 碼 uppercase）
    - 訂單類型 / 車型 badge
    - pickup / dropoff 路線（仿 driver/pending 樣式）
    - 用車時間 / 距離 / 估價
    - 當前 status 徽章
    - 主按鈕（依 ACTION_BY_STATUS 取 label）
  - `ClickAdvance(order)`：
    1. `await driverGeo.UploadNow()` 立即上傳座標
    2. `await $api.PatchOrder(order.orderId, { orderStatus: next })`
    3. 成功 → 重 load 列表（completed 會從列表消失）；失敗 → ElMessage 錯
- [x] 6.2 lint 通過

## Stage 7：API 介面 + i18n

- [x] 7.1 新增 `app/protocol/fetch-api/api/order/index.ts` `GetAssignedOrders` API 定義 + type
- [x] 7.2 修改 `app/protocol/fetch-api/api/order/type.d.ts`：
  - PatchOrderParams.orderStatus 加 `'en_route' | 'arrived_pickup'`
  - 新增 `AssignedOrder` interface
- [x] 7.3 修改 `app/protocol/fetch-api/api/driver/index.ts` 或對應檔：`UpdateDriverLocation` body 加 `accuracy?: number`
- [x] 7.4 修改 `i18n/locales/{zh,en,ja}.js`（三檔）：
  - `status.en_route` `status.arrived_pickup`
  - `driverTrip.*`（title / empty / action.* / passenger / fare / distance）
  - `warRoom.*`（filter / noActiveOrder / activeOrder）
  - `geoPermission.*`（title / body / retry）
- [x] 7.5 修改 passenger upcoming 頁 TripStatus type（如 STATUS_TAB_KEYS / STATUS_CLS / STATUS_LABEL 觸及的）：
  - 確認 `en_route` / `arrived_pickup` 是否要在 passenger 端顯示為「行程中」（合併顯示）；建議：passenger 端 `en_route` / `arrived_pickup` / `in_transit` 都歸類「行程中」tab，避免乘客看到太細節的狀態
- [x] 7.6 lint 通過

## Stage 8：war-room polish

- [x] 8.1 修改 `app/pages/admin/war-room/index.vue`：
  - markerMap unmount 清理：onUnmounted 內 `for (const [, m] of markerMap) m.setMap(null); markerMap.clear()`
  - heading 靜止時改畫圓點：`heading == null` → `path: google.maps.SymbolPath.CIRCLE`；有值 → 既有箭頭 path
  - 加狀態 filter UI：右上 4 個 radio button（全部/上線/任務中/離線）
  - `derivedStatus` 計算：`now - lastActiveAt > 600_000 ? 'offline' : status`（10 分鐘 threshold）
  - filter computed 套用：marker 與側邊清單同步顯示 / 隱藏
  - busy driver 側邊面板顯示 activeOrder（訂單號後 6 碼 + status 中文）
  - offline driver marker 灰色 + opacity 0.4
- [x] 8.2 對應 type 更新：`DriverInfo` 加 `accuracy?: number | null` `lastActiveAt: number` `activeOrder?: { orderId, orderStatus } | null`
- [x] 8.3 lint 通過

## Stage 9：firestore.rules 確認

- [x] 9.1 確認 `firestore.rules` orders rules 對 driver 改 status 的支援（理論上 server 走 admin SDK bypass rules，rules 不需動；但仍 verify orders rules 沒擋住 owner cancelled / driver patch）

## Stage 10：文件 + commit

- [x] 10.1 寫 `docs/decision-log.md` P19 條目（背景 + 決策摘要 + 強制規範：「狀態值修改 client/server/i18n 三處對齊」「driver status 不寫 offline 由 lastActiveAt 推導」「watchPosition 在 layout 啟動 vs page 啟動」）
- [x] 10.2 更新 `docs/tasks.md` v3.10 標 P19 完成
- [x] 10.3 一次性 commit + push 到 main（fast-forward）

## Stage Gate（部署完成後驗證）

- [x] G1 lint ✅
- [x] G2 driver 進 driver 端任一頁 → 彈授權框 → 通過 → 自動開始 watchPosition
- [x] G3 driver 拒絕授權 → modal 出現 → 重試一次再拒 → 強制踢回 /home
- [x] G4 admin 指派訂單 → driver/trip 列表出現該訂單（30s polling 內）
- [x] G5 driver 按「前往上車點」→ status → en_route；war-room 對應 marker activeOrder 也更新顯示
- [x] G6 五階段全跑：confirmed → en_route → arrived_pickup → in_transit → completed
- [x] G7 完成後 driver/dashboard `tripsToday++`、`earningsToday += fare`（P18 統計累加 + P19 嚴格狀態機驗證）
- [x] G8 司機完成最後一張訂單後 → drivers.status 自動切 'online'（war-room 看到綠色而非琥珀）
- [x] G9 司機關閉 LIFF → 600 秒（10 分鐘）後 war-room 顯示為 offline（灰色 / 從 default filter 隱藏）
- [x] G10 war-room filter「上線/任務中/離線/全部」切換正確
- [x] G11 滲透測試：driver A 嘗試 patch driver B 的訂單 status → 預期 403
- [x] G12 滲透測試：driver patch order status confirmed → completed（跳階段）→ 預期 400/403

## 期間衍生 Hotfix（commit log）

- `26da262` — P19 主程式碼 stage 1-10 完成
- `72e8cda` — assignedDriverId prefix 統一 + location.put 失敗檢查 + 授權 timeout 30s
- `365f1bd` — driver/trip 列表 + modal 詳情 + Google Maps 導航 + LIFF/stats fix
- `bdecf77` — P20 booking 表單擴充 backlog 進 tasks
- `07449f5` — drivers/[uid]/stats → drivers/[id]/stats 解 Nitro 動態路徑衝突（P14 起潛在 bug）
- `e5b766f` — driver-geolocation accuracy 50→100m / distance 5→10m 提升弱訊號上傳率

## G11 / G12 Code Review 證據

**G11（driver A 改 driver B 訂單 → 403）**：
[server/routes/nuxt-api/orders/[orderId].patch.ts](server/routes/nuxt-api/orders/[orderId].patch.ts) driver 限制段：
- `isAssignedDriver = isDriver && orderAssignedNormalized === auth.uid` — 比對訂單 assignedDriverId 與 caller auth.uid
- 若非 assigned driver 且 status 非 'confirmed'（搶單例外）→ `forbiddenError`
- `body.assignedDriverId !== auth.uid` → `forbiddenError('司機僅能指派自己')`
- 雙重防線：driver 無法 patch 他人訂單

**G12（driver 跳階段 confirmed → completed → 400）**：
- `DRIVER_NEXT_STATUS` 寫死狀態機表（confirmed→en_route, en_route→arrived_pickup, ...）
- `if (expected !== body.orderStatus)` → `badRequestError('狀態轉換錯誤：{prev} 不可改為 {next}')`
- 例外：cancelled / 重複 confirmed（搶單）放行
- driver 無法跳階段

## Spec 狀態：✅ Closed（2026-05-09）
