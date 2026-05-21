# Phase 1E — 訂單需求單 + 司機喊單 + Admin 配對（2026-05-21）

> 整體計畫第 5 phase。前置：1A taxonomy / 1B vehicle profile / 1C public page / 1D booking tag pricing 已完成。
> **本 phase 是整個系列最大的 wave**（後端狀態流轉 + 三端 UI + LINE 模板），建議拆 2 視窗實作。

## Why

1D 已能把乘客偏好寫進訂單（`order.preferences`）。但訂單建立後**還是 pending**，沒有任何配對流程：admin 看不到「該叫誰來搶」，driver 也不知道有單。

本 phase 接上中間流程：
1. Admin 看到新訂單 → 點「發出需求單」→ LINE 推全部 driver
2. Driver 進接單看板看訂單 → 評估自己車輛符不符 → 喊單
3. Admin 看喊單清單 → 看標籤命中率 + 過往訂單數 → 挑一個司機指派
4. Passenger / Driver 雙方收 LINE 通知

## What Changes

### 訂單狀態流轉（拍版 #9 不要 `bidding` 狀態）

```
pending ─[admin dispatch]─► pending (dispatchAt set)
        ─[driver bid]────► pending (bids[] append)
        ─[admin assign]──► confirmed
        ─[cancel]────────► cancelled_by_passenger | cancelled_by_admin
```

訂單狀態欄 (`status`) 在整個喊單期間都是 `pending`。**「派發狀態」靠 `order.dispatchAt`、`order.bids[]`、`order.driverId` 推斷**，不引入新 status enum。

### 機制總覽

1. **Admin 發單**：`POST /nuxt-api/admin/orders/[orderId]/dispatch`
   - 守則：order.status==='pending' && !order.dispatchAt
   - 寫入 `dispatchAt = now`、`dispatchedBy = adminUid`
   - 觸發 LINE push 給所有 active driver
2. **Driver 接單看板**：`GET /nuxt-api/driver/dispatched-orders`
   - 列：所有 order.status==='pending' && order.dispatchAt != null && order.driverId == null && 該 driver 不在 order.bids[] 內
   - **不過濾必要條件**（B1 拍版：全部 driver 都能看，自己判斷）
3. **Driver 喊單**：`POST /nuxt-api/driver/orders/[orderId]/bid`
   - 守則：order.status==='pending'、order.dispatchAt 存在、order.driverId 為 null、driver 不在現有 bids[] 內
   - append `{ driverId, driverDisplayName, bidAt }` 到 `order.bids[]`
4. **Driver 撤回喊單**：`DELETE /nuxt-api/driver/orders/[orderId]/bid`（B2 配套：driver 喊錯可撤）
5. **Admin 看喊單清單**：`GET /nuxt-api/admin/orders/[orderId]/bids`
   - 回每個 bid + 該 driver 的 matchCount + completedOrders + verifiedAt
6. **Admin 指派司機**：`POST /nuxt-api/admin/orders/[orderId]/assign`
   - body: `{ driverId }`
   - 守則：order.status==='pending'、driverId 必須在 order.bids[] 內
   - 寫入 `driverId`、`status='confirmed'`、`assignedAt`、`assignedBy`
   - 觸發 2 個 LINE push（passenger / 中選 driver）

### Match count 計算（admin 看 bids 用）

```
preferenceTagIds = order.preferences.tagIds（乘客勾選）
driverOwnedTagIds = driver.vehicleProfile.tags + driver.tags（driver-scope）
matchCount = |preferenceTagIds ∩ driverOwnedTagIds|
matchedNames = 對應的中文名 list（給 admin 看「命中哪幾個」）
```

注意：preference 是 vehicle-scope，driver-scope 標籤即使乘客沒勾，也計入 matchCount 加分（因為英文司機是 nice-to-have，乘客可能勾了「商務接待」司機端有則命中）。
**最簡單：交集就是交集**，不分 scope。

### 訂單需求單 LINE 推播

- 對象：所有 `drivers/{lineUid}` doc `approved===true` 的司機
- Flex template：訂單時段、上下車、人數、preferences chip list、預估金額、「查看詳情」CTA → 開 `/driver/dispatched/[orderId]`
- 本 phase **不**寫進 `notification_templates`（P38 編輯器），用 hard-coded helper（後續若要 admin 編輯化可在 Phase 2 補）

### LINE 推播（assign 後 2 則）

- Passenger：「您的訂單已配對成功，車牌 / 司機 / 上車時間」+ 連到車輛公開檔案頁 `/vehicles/{driverId}` (1C)
- Driver：「您已中選訂單 XXX，請於 上車時間 前準時抵達」

## 18 個決策

| # | 議題 | 拍版 |
|---|---|---|
| 1 | 訂單狀態 enum | 不加 `bidding`，全部 in `pending` |
| 2 | 發單對象 | 推給全部 active driver（B1 拍版） |
| 3 | 看板過濾 | 不過濾（B1 拍版延伸） |
| 4 | 喊單時限 | 不設硬時限（B2 拍版） |
| 5 | 超時無人喊單 | Admin 介入手動（B2 拍版） |
| 6 | Admin 挑選依據 | 司機名 + 標籤命中 + 過往訂單數（B3 拍版） |
| 7 | Driver 喊單入口 | Driver web 端看詳情後喊單（D1 拍版）；LINE 推播只是提示 |
| 8 | 司機可用時段 | 不檢查（D2 拍版） |
| 9 | bid 結構 | `{ driverId, driverDisplayName, bidAt }`；matchCount 不存進 bid，admin 看的時候即時算 |
| 10 | 中選後其他 bid | 留在 `order.bids[]` 不刪（給 admin 看 history） |
| 11 | Driver 撤回 bid | 支援（pending && !assigned）|
| 12 | 多 driver 同時喊單 race | Firestore transaction 處理 |
| 13 | LINE template | hard-coded（不進 notification_templates） |
| 14 | passenger 通知 | 配對成功通知 + 公開頁連結 |
| 15 | driver 未中選通知 | 不發（避免騷擾） |
| 16 | i18n | passenger 三語；admin/driver 繁中 |
| 17 | 訂單列表標示 | admin 列表頁顯示「已派發 N 喊單」徽章 |
| 18 | 取消訂單 | pending 可由 passenger / admin 取消；觸發 LINE 通知所有已 bid driver |

## Impact

### Affected code (Phase 1E only)

| 檔案 | 動作 |
|---|---|
| `shared/orderDispatch.ts` | 🆕 計算 matchCount / matchedTagNames 純函式 + spec |
| `shared/orderDispatch.spec.ts` | 🆕 |
| `server/utils/order-dispatch.ts` | 🆕 active driver list / bid 寫入 / assign transaction helpers |
| `server/utils/line-dispatch-push.ts` | 🆕 訂單需求單推播 + assign 雙向推播 |
| `server/routes/nuxt-api/admin/orders/[orderId]/dispatch.post.ts` | 🆕 |
| `server/routes/nuxt-api/admin/orders/[orderId]/bids.get.ts` | 🆕 |
| `server/routes/nuxt-api/admin/orders/[orderId]/assign.post.ts` | 🆕 |
| `server/routes/nuxt-api/driver/dispatched-orders/index.get.ts` | 🆕 |
| `server/routes/nuxt-api/driver/orders/[orderId]/bid.post.ts` | 🆕 |
| `server/routes/nuxt-api/driver/orders/[orderId]/bid.delete.ts` | 🆕 |
| `app/protocol/fetch-api/api/admin/order-dispatch/{index.ts,type.d.ts}` | 🆕 |
| `app/protocol/fetch-api/api/driver/order-bid/{index.ts,type.d.ts}` | 🆕 |
| `app/pages/admin/orders/[id].vue` | 改：加「發出需求單」按鈕 + 喊單清單 section + 指派按鈕 |
| `app/pages/admin/orders/index.vue` | 改：列表加「已派發 N 喊單」徽章 |
| `app/pages/driver/dispatched/index.vue` | 🆕 接單看板 |
| `app/pages/driver/dispatched/[orderId].vue` | 🆕 訂單詳情 + 喊單按鈕 |
| `app/components/admin/OrderBidList.vue` | 🆕 喊單清單元件 |
| `app/components/driver/DispatchedOrderCard.vue` | 🆕 |
| `server/utils/audit-log.ts` | 改：`AuditAction` 加 `order.dispatch` / `order.assign` / `order.cancel` |
| `i18n/locales/{zh,en,ja}.js` | 加 passenger 三語 `notification.assigned.*`、`notification.dispatched.*` |

### 不影響

- 1A tags / 1B driver vehicle profile / 1C public page / 1D booking preferences 既有結構
- 折扣碼 / fare V2 / referral / 公告 既有功能
- firestore.rules（無新 collection，orders write 仍 false 經 server）

## 驗收標準（高層級，細節見 design.md）

- [ ] Admin 訂單詳情顯示「發出需求單」按鈕 → 點下後 dispatchAt 寫入、按鈕變「等待喊單」
- [ ] driver 收 LINE 推播 → 點 CTA 進接單看板
- [ ] driver 接單看板列出 dispatched 訂單，未自己 bid 過的可見
- [ ] driver 點某單詳情 → 「我要接這單」按鈕 → 成功後該單變「等待 admin 指派」
- [ ] driver 可在 admin 還沒指派前撤回 bid
- [ ] admin 訂單詳情看到喊單清單（含每個 driver 的 matchCount / completedOrders / 名字）
- [ ] admin 點某 bid「指派」按鈕 → order.driverId 寫入、status → confirmed
- [ ] 中選 driver 收 LINE 通知
- [ ] passenger 收 LINE 通知 + 連到車輛公開頁
- [ ] Race condition：兩個 driver 同時 bid 同一 order → 都成功（append-only）
- [ ] Race condition：admin 同時 assign 兩個 driver → 第二個 fail（status 已非 pending）
- [ ] `pnpm lint` / `pnpm test` / `pnpm build` 全綠
