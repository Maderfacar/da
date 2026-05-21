# Hand-off：Phase 1F Soft Match 確認 + 重新配對流程

## 狀態

- **實作 100% 完成**：lint / test / build 三項全綠
- 一支 commit（**不 push**）；firestore rules 本 phase **不動**（無新 collection；所有新欄位都掛 `orders/{orderId}` doc 內，server-only 寫入規則已 cover）
- 等 Brain AI 真機驗收 → 點「進 1G」

## 實作摘要

### shared 層（純函式 + Vitest）
- [shared/orderDispatch.ts](../../../shared/orderDispatch.ts) ✏️ — 新 `isSoftMatch(preferenceTagIds, match)` 純函式（0 偏好 → false、matchCount < preferenceCount → true）
- [shared/orderDispatch.spec.ts](../../../shared/orderDispatch.spec.ts) ✏️ — 加 5 個 case（preferenceCount=0、完全命中、部分命中、0 命中也算 soft、matchCount > preferenceCount edge case），全綠

### server 層（utils + 3 endpoints + assign 改寫 + postback prefix handler）
- [server/utils/order-soft-match.ts](../../../server/utils/order-soft-match.ts) 🆕 — 4 個 export：
  - `rematchOrder(db, orderId, reason, adminUid?)` — transaction 守 `status='confirmed'` 且 `assignedDriverId` 存在；把當前 `{ bids }` snapshot 到 `bidHistory[]`，清掉 driverId/assignedAt/assignedBy/bids/passengerConfirmationStatus，dispatchAt=serverTimestamp、reMatchRound++、status='pending'；回 `prevDriverLineUid` + `reMatchRound`
  - `acceptSoftMatch(db, orderId)` — 守 `confirmed + confirmationStatus='pending'` → 寫 `passengerConfirmationStatus='accepted'`
  - `declineSoftMatch(db, orderId, cancelReason)` — 守同上 → `status='cancelled'`、`passengerConfirmationStatus='declined'`、`cancelReason`、`statusHistory.cancelledAt`
  - `decideConfirmationStatus(preferenceTagIds, match)` — 給 admin assign 用，判 isSoft 並回對應 `confirmationStatus`
  - re-export `isSoftMatch`
- [server/utils/line-soft-match-push.ts](../../../server/utils/line-soft-match-push.ts) 🆕 — 3 個 helper：
  - `pushSoftMatchToPassenger(lineUid, payload, env, lang)` — 3-button postback Flex（三語：zh_tw / en / ja），buttons data = `passenger.softMatch.{accept,wait,cancel}?orderId=<id>`
  - `pushPassengerRematch(lineUid, payload, lang)` — 「正在重新為您配對」三語 Flex
  - `pushDriverDeselected(driverLineUserId, payload)` — 原中選 driver deselect 文字通知（繁中）
- [server/utils/audit-log.ts](../../../server/utils/audit-log.ts) ✏️ — `AuditAction` 加 2 個：`order.rematch` / `order.soft_match_response`
- [server/utils/line-postback-handlers.ts](../../../server/utils/line-postback-handlers.ts) ✏️ — 加 prefix-based `PREFIX_HANDLERS`（與 exact-match whitelist 並存），實作 `passenger.softMatch.*` postback：parse `?orderId=` → owner check → 守 `confirmationStatus='pending'` → 直接呼 utility（不走 HTTP self-call，避免 cookie / auth 問題）→ 三分支 accept / wait / cancel 各自寫 audit + 推對應通知；`findPostbackHandler` 先比 exact whitelist、再試 prefix
- [server/routes/nuxt-api/admin/orders/[orderId]/assign.post.ts](../../../server/routes/nuxt-api/admin/orders/%5BorderId%5D/assign.post.ts) ✏️ — 改寫：
  - assign 成功後 read order + driver + tags，computeDriverMatch → decideConfirmationStatus
  - 寫 `passengerConfirmationStatus = 'auto' | 'pending'`（非 transaction patch，assign 已落定可安全寫）
  - **fire-and-forget**：driver 推 1E 既有 `pushOrderAssignedToDriver`；passenger 依 `isSoft` 分流：
    - `isSoft=true` → `pushSoftMatchToPassenger`（3-button postback Flex）
    - `isSoft=false` → 1E 既有 `pushOrderAssignedToPassenger`（配對成功 Flex）
  - audit payload 加 `confirmationStatus / matchCount / preferenceCount`
  - response 增加 `passengerConfirmationStatus / matchCount / preferenceCount` 欄位
- [server/routes/nuxt-api/admin/orders/[orderId]/rematch.post.ts](../../../server/routes/nuxt-api/admin/orders/%5BorderId%5D/rematch.post.ts) 🆕 — admin 強制重新配對：
  - auth admin + `canManageOrders`
  - body `{ reason?: string }`
  - 呼 `rematchOrder(reason='rematched_by_admin', adminUid)` → 3 個 fire-and-forget push（deselect 原 driver / multicast 新需求單 / passenger rematch 通知）+ audit `order.rematch`
- [server/routes/nuxt-api/passenger/orders/[orderId]/soft-match-decision.post.ts](../../../server/routes/nuxt-api/passenger/orders/%5BorderId%5D/soft-match-decision.post.ts) 🆕 — passenger web fallback（主流走 LINE postback）：
  - body `{ decision: 'accept' | 'wait' | 'cancel' }`
  - owner check（auth.lineUid match userId / lineUserId）
  - 三分支動作對齊 postback handler 邏輯；每支寫 `order.soft_match_response` audit
- [server/routes/nuxt-api/admin/orders/index.get.ts](../../../server/routes/nuxt-api/admin/orders/index.get.ts) ✏️ — list 每筆 echo 3 個新欄位：`passengerConfirmationStatus / reMatchRound / bidHistory[]`（bidHistory.endedAt 兼容 Date 與 Timestamp）
- [server/routes/nuxt-api/orders/assigned.get.ts](../../../server/routes/nuxt-api/orders/assigned.get.ts) ✏️ — driver 看自己被指派的訂單回 `passengerConfirmationStatus`（driver/trip 顯示「等待乘客確認」橫幅用）

### protocol 層
- [app/protocol/fetch-api/api/admin/order-dispatch.ts](../../../app/protocol/fetch-api/api/admin/order-dispatch.ts) ✏️：
  - `AssignDriverFromBids` response 加 `passengerConfirmationStatus / matchCount / preferenceCount`
  - 加 `ForceRematchOrder(orderId, body)` 與 `PostSoftMatchDecision(orderId, body)` 兩 API
- [app/protocol/fetch-api/api/admin/index.ts](../../../app/protocol/fetch-api/api/admin/index.ts) ✏️ — 加 `PassengerConfirmationStatus / AdminOrderBidHistoryEndReason / AdminOrderBidHistoryEntry` types；`AdminOrder` 加 `passengerConfirmationStatus / reMatchRound / bidHistory` 3 個 optional field
- [app/protocol/fetch-api/api/order/type.d.ts](../../../app/protocol/fetch-api/api/order/type.d.ts) ✏️ — `AssignedOrder` 加 `passengerConfirmationStatus` optional field

### Admin UI
- [app/pages/admin/orders/index.vue](../../../app/pages/admin/orders/index.vue) ✏️：
  - 列表 dispatch badge 旁加「重派 N 次」徽章（紫色，`reMatchRound > 0` 顯示）
  - modal 在 confirmed 訂單 + assignedDriverId 存在時加新 section：
    - 乘客確認狀態 tag（auto / pending / accepted / declined 對應 success / warning / success / danger 樣式）
    - 「🔄 強制重新配對」按鈕（橙警示色）+ 說明文字
  - bidHistory section（v-if `length > 0`）：列每輪 round / endReason / endedAt + 該輪 bid 列表（撤回的 bid 灰掉劃線）
  - 加「強制重新配對 sub-modal」：textarea 填理由（200 字內）+ warn hint + 確認 / 取消按鈕
  - 加 SCSS：`__action.is-warn`（橙色變體）+ `__bid-history` / `__history-{row,head,round,reason,time,bids,bid,empty}` + `__rematch-{actions,hint}` + dispatch-badge `&.is-rematch`

### Driver UI
- [app/pages/driver/trip/index.vue](../../../app/pages/driver/trip/index.vue) ✏️：
  - 列表卡片底部加「⏳ 等待乘客確認」chip（confirmationStatus='pending' 時）
  - 任務 modal 加 pending banner（icon + title + 文案說明「您與此訂單偏好部分相符，乘客正在確認」）
  - 對應 SCSS（橙色基調對齊 pending 警示）

### i18n（zh / en / ja 完整三語）
- [i18n/locales/zh.js](../../../i18n/locales/zh.js) / [en.js](../../../i18n/locales/en.js) / [ja.js](../../../i18n/locales/ja.js) — 加 `notification.softMatch.*`（17 keys）+ `notification.rematch.*`（4 keys）共 21 個 key × 3 語系（**真翻譯**，非 fallback）

## 規格細節決策

| 議題 | 拍板 | 出處 |
|---|---|---|
| 不引入新 status enum | rematch 把 status 從 confirmed 重置回 pending；新增 `reMatchRound: number` 計數 + `passengerConfirmationStatus` 標記 | proposal #1 |
| Soft Match 判定 | `matchCount < preferenceCount`（含 0 命中算 soft） | #2 / #3 |
| preferenceCount=0（乘客沒勾偏好）| 強制 `auto`（沒勾就沒得不滿意；`isSoftMatch` 回 false） | #4 |
| Passenger 3 選 1 入口 | LINE Flex postback button（與 1E driver 通知架構一致；無 web fallback 但提供 `PostSoftMatchDecision` API 給後續擴充） | #5 |
| 重新配對清 bids | 移到 `bidHistory[]`（保留 audit；read-then-write 模式不用 arrayUnion） | #6 |
| reMatchRound 上限 | 無上限（admin 自掌） | #7 |
| 取消（全額退款）| 後付 → 無實際退款；訂單 `status='cancelled'` + `passengerConfirmationStatus='declined'` + `cancelReason='passenger_soft_match_declined'` | #8 |
| 中選 driver 在 rematch 時 | LINE 文字通知「訂單已重新分派，本次未繼續由您接單」（繁中） | #9 |
| Passenger 不回應 LINE | confirmationStatus 停在 'pending'；admin 在 UI 看得到並可手動 force rematch 救 | #10 |
| i18n | passenger 三語完整（21 key × 3 語系）；admin / driver UI 文字繁中硬寫 | #11 |
| **Postback 處理機制** | 加 prefix-based `PREFIX_HANDLERS`，與 exact whitelist 並存；soft-match 走 prefix（owner check 在 handler 內，比對 source.userId 對 order.userId/lineUserId） | 新增（design.md §3.4） |
| **postback handler 不走 HTTP self-call** | server self-call 無法帶 auth cookie；改在 handler 內直接呼 utility（守則由 transaction 內把關） | 既有 server 架構限制 |
| **bidHistory.endedAt 型別** | 用 `new Date()`（不可用 serverTimestamp，因 array element 內 serverTimestamp 不被 Firestore 接受；對齊 1E `appendBid` 慣例） | Firestore transaction 限制 |
| **bidHistory 寫入** | read-then-write `[...prevHistory, historyEntry]`（同 1E appendBid 慣例；避免 arrayUnion 對複雜物件相等比對風險） | 對齊 1E 慣例 |
| **driver UI confirmation banner 放在 /driver/trip** | spec 提到 `/driver/dispatched/[orderId]`，但 1F 中選 driver 訂單已 confirmed，dispatched-orders 不再回傳；改放 /driver/trip（assigned-orders 列表）由 GET assigned 帶 `passengerConfirmationStatus` 欄位 | 配合既有 driver 端任務頁面 |
| **assign 時 confirmationStatus 寫入策略** | assignDriver transaction 內**不**寫 confirmationStatus（保持 1E util 邏輯不動）；改在 assign endpoint 外圍計算 isSoft 後 `update()` patch；assign 已透過 transaction 落定，後續寫單一 field 不需再 transaction | 簡化 1E util 不動 |
| **passenger soft-match-decision endpoint vs LINE postback 重疊** | 兩者共用同一組 utility（acceptSoftMatch / rematchOrder / declineSoftMatch）；endpoint 走 server auth、postback 走 LINE source.userId owner check；audit 都寫 `order.soft_match_response` 但 payload.source 差異化 | 設計權衡 |
| **postback prefix-handler audit 用低權限直寫** | 不走 `writeAuditLog`（需 H3Event + AuthOk），直接 `audit_logs.add()` 寫 actorUid=lineUid + actorLevel='passenger' + payload.source='line_postback' | 既有 audit 架構限制 |

## 驗證結果

```
pnpm lint   ✅ 0 error / 0 warning
pnpm test   ✅ 11 test files / 198 tests passed（+5 case：isSoftMatch.spec）
pnpm build  ✅ exit 0
            - admin/orders/_orderId/rematch.post.mjs（emit ✅）
            - passenger/orders/_orderId/soft-match-decision.post.mjs（emit ✅）
            - admin/orders/_orderId/assign.post.mjs（rebuild ✅，含 Soft Match 分支）
            - admin/orders/index.get.mjs（rebuild ✅，含 bidHistory echo）
            - orders/assigned.get.mjs（rebuild ✅，含 passengerConfirmationStatus echo）
```

## 真機驗收 checklist（Brain AI）

啟動 `pnpm dev`，準備 3 種帳號（admin、driver A、driver B；乘客一個）：

### 完全命中（auto） — 不該觸發 Soft Match

- [ ] **A1** 乘客在 booking 選 0 偏好建單 → admin 派發 → driver A 喊單 → admin 指派 driver A
- [ ] **A2** 乘客 LINE 收**正常配對成功 Flex**（非 Soft Match 3 按鈕；綠色 header「🎉 配對成功」+ 「查看車輛資訊」CTA）
- [ ] **A3** admin 訂單 modal 進 confirmed → 顯示「乘客確認：自動接受」（綠 tag）

### 部分命中（Soft Match）

- [ ] **B1** 乘客在 booking 選 3 個偏好 → admin 派發 → driver A 喊單（A 只有 2 個 match）→ admin 指派 driver A
- [ ] **B2** 乘客 LINE 收**3-button Flex**（橙 header「⚠️ 配對部分符合」+ 副標「您勾選的 3 項偏好中，2 項符合」+ 「✓ 符合偏好」list + 「✗ 未符合」list + 「查看車輛」link + 3 按鈕：接受 / 等下一輪 / 取消）
- [ ] **B3** admin 訂單 modal 顯示「乘客確認：等待乘客確認」（黃 tag）
- [ ] **B4** driver A LINE 仍收**正常中選 Flex**（綠 header「✅ 您已中選」）
- [ ] **B5** driver A 進 /driver/trip → 列表卡片該訂單有「⏳ 等待乘客確認」chip；點 modal 看到上方橙色 banner「等待乘客確認」+ 說明

### Soft Match 三選一動作

- [ ] **C1**（accept）乘客點「接受此車」postback → LINE 回「✅ 已接受配對，行程即將開始」；admin modal confirmationStatus 變「已接受」（綠 tag）
- [ ] **C2**（wait）另一張 Soft Match 訂單，乘客點「等下一輪配對」→ LINE 回「🔄 已重新進入配對佇列」
  - admin 列表該訂單變「待喊單」+ 重派 1 次徽章
  - admin modal 看 bidHistory 多一行 Round 0（reason='rematched_by_passenger'）
  - 原 driver A LINE 收 deselect 通知「🔁 訂單已重新分派...」
  - 所有 active driver LINE 收新需求單 Flex
  - 乘客 LINE 收「🔄 正在重新為您配對」
- [ ] **C3**（cancel）另一張 Soft Match 訂單，乘客點「取消訂單」→ LINE 回「🚫 訂單已取消」
  - admin 列表訂單變「已取消」；modal confirmationStatus='declined'
  - 原 driver A LINE 收 deselect 通知

### Admin 強制重新配對

- [ ] **D1** admin 在 confirmed 訂單 modal 點「🔄 強制重新配對」→ sub-modal 跳出，填理由「車況變動」→ 確認
- [ ] **D2** toast「訂單已重新進入配對佇列」；訂單回 pending、reMatchRound=1（若先前無）、bidHistory 加一筆 Round=0 (reason='rematched_by_admin', endedBy=adminUid)
- [ ] **D3** 原 driver LINE 收 deselect 通知；所有 active driver 收新需求單；乘客收「🔄 正在重新為您配對」
- [ ] **D4** Firestore `audit_logs` 應有 `action='order.rematch'` doc + `payload.reason='車況變動'`

### Audit log

- [ ] **E1** Firestore `audit_logs` 應有：
  - `order.assign` doc payload 含 `confirmationStatus='pending' / matchCount / preferenceCount`
  - `order.soft_match_response` doc（accept/wait/cancel 各一筆；postback 來源 payload.source='line_postback'）
  - `order.rematch` doc 含 `triggeredBy='admin'/reason/reMatchRound`

### 守則 / 邊界

- [ ] **F1** 重複點同一個 postback（如 wait 點兩次）→ 第二次收「⚠️ 本次選擇已逾時或已處理」（confirmationStatus 已不是 pending）
- [ ] **F2** 非 owner 用 postback URL 偽造（driver 點乘客的 postback）→ 收「⚠️ 無權操作此訂單」
- [ ] **F3** admin 對 pending（未指派）訂單按「強制重新配對」→ 按鈕 disabled（CanForceRematch 守則）
- [ ] **F4** admin 對 completed 訂單看 modal → 不顯示 confirmation section（v-if status='confirmed' && assignedDriverId）

> firestore rules 沒 deploy；本 phase **無新 collection**，所有新欄位都在 `orders/{orderId}` doc 內，既有 server-only 寫入規則已 cover。

## 留尾（不在本 phase 範圍）

- ⏳ E2E 測試 + rules deploy + prod push → Phase 1G
- ⏳ Passenger 不回應 LINE 12h 自動 rematch（SLA / cron）→ Phase 2+
- ⏳ Driver 自助「無法接此單」按鈕（assign 後反悔）→ Phase 2+；目前走 admin 手動 force rematch
- ⏳ reMatchRound 上限警告（admin 列表 ≥ 3 次顯示紅色提示）→ Phase 2+
- ⏳ 前付金流（若後續改前付，soft-match cancel 要補退款 hook）→ Phase 2+
- ⏳ Notification template editor 化（Soft Match Flex 文案 admin 可編輯）→ Phase 2+
- ⏳ bidHistory 累積太大時的 archival（reMatchRound ≥ 5 把 bidHistory 移到 sub-collection）→ Phase 2+
- ⏳ Soft Match Flex 內「查看車輛」CTA：postback button 與 uri button 視覺上稍重複（lineLiff URI link + 3 個 postback button）；UX 可微調為單按鈕 + 卡片中段直接帶 driver 圖卡 → Phase 2+

## 已知陷阱與設計權衡

1. **assign 後寫 confirmationStatus 不在 transaction 內**：1E `assignDriver` util 已落定狀態（transaction），1F endpoint 外圍 read order/driver/tags 計算 isSoft 後 `update()` patch single field。理論窗期內 confirmationStatus 短暫為 undefined（毫秒級）；admin UI 看到 undefined 時顯示「無紀錄（pre-1F 訂單）」— 不影響 1F 流程，且舊訂單也會走同 fallback。後續若要求 atomic 可重構成 transaction 內整包讀取（會多 read driver/tags 兩次）。
2. **bidHistory.endedAt 用 `new Date()` 而非 serverTimestamp**：Firestore array element 內不能含 `FieldValue.serverTimestamp()`。對齊 1E `appendBid` bidAt 慣例（client 時間，網路延遲 ≤ 1s 精度足夠）。order.dispatchAt / assignedAt 仍用 serverTimestamp（不在陣列內）。
3. **postback handler 不能走 HTTP self-call**：Nitro server self-fetch 不會自動帶 cookie，無法重用 `getAuthFromEvent`；改在 prefix handler 內直接呼 utility（owner check 在 handler 內手動做）。優點是少一跳 HTTP 開銷；缺點是兩條路徑（HTTP endpoint 與 postback handler）邏輯重複，未來改動兩處都要同步。
4. **postback 過期失效（reply token TTL 1 分鐘）**：若 passenger 30 秒後才點 postback button，replyToken 已過期 → reply 失敗（log 進 line_api_errors），但 db 狀態仍會寫入（passenger 看不到 ack 文字，但 admin 端能看到 confirmationStatus 已變）。可接受（postback 不依賴 replyToken 狀態變更才生效）。
5. **driver 在 confirmationStatus='pending' 期間的空窗風險**：driver 中選後 LINE 通知會立刻收到「✅ 您已中選」（1E 既有，未改）；passenger 此時若還沒回應、又或者選了 wait/cancel，driver 才會收到 deselect。實務上 admin 可在訂單 modal 看到 confirmationStatus 變化，必要時人工介入。本 phase 不額外加 driver 端 polling / silent waiting state，靠 banner UI 提示「等待乘客確認」即可。
6. **soft-match cancel 與既有 cancelled_by_passenger 流程的差異**：本實作的 cancel 用 `status='cancelled'` + `cancelReason='passenger_soft_match_declined'` + `passengerConfirmationStatus='declined'`，與 admin 在 orders.patch 內取消的 cancelled 用相同 enum。orders.patch 內既有 cancel hook（推 bidders、寫 audit）**不會**被 declineSoftMatch 觸發（直接走 transaction patch order doc）；因為 soft-match cancel 的訂單已是 confirmed（assignedDriverId 存在），場景上不需 bidder 通知。
7. **bidHistory schema 假設**：第一次 rematch 時 currentRound=0、reMatchRound 由 0 → 1，history 推一筆 round=0。第二次 rematch 時 currentRound=1（已 incremented from 第一次）、reMatchRound 由 1 → 2，history 再推一筆 round=1。即「history.round 是該輪結束時 reMatchRound 的舊值」。UI 顯示「Round N」就是該輪的索引。
8. **isSoft 判定即時讀 drivers doc**：assign 時讀 `drivers/{lineUid}.vehicleProfile.tags + .tags + .totalTrips + .verifiedAt`；本身已有 1E `loadBidsWithDriverInfo` 同樣 pattern，driver doc 沒被改動。若 driver 在 admin assign 那一瞬間正在改 vehicleProfile（罕見），matchCount 可能會以舊值算出 — 但這完全是預期行為（admin 看 bids 列表時也是即時讀）。
9. **postback whitelist UI 不顯示 soft-match prefix entries**：`listPostbackWhitelist` 只回 `POSTBACK_WHITELIST`（exact match），不含 PREFIX_HANDLERS。admin 在 line-management UI 無法手動把 `passenger.softMatch.accept` 設成 richmenu button — 這是預期：soft-match postback 只能由 server 端 push Flex 帶上，admin 不該編輯。
10. **rules deploy 不需要做**：所有新欄位都在 `orders/{orderId}` doc 內（top-level field + 一個 array），不開新 collection。orders 既有 server-only 寫入 rules 已 cover。

## Commit

```
feat: Phase 1F — Soft Match + 重新配對流程
```

新增 / 改動檔案清單：

**新增**
- server/utils/order-soft-match.ts 🆕
- server/utils/line-soft-match-push.ts 🆕
- server/routes/nuxt-api/admin/orders/[orderId]/rematch.post.ts 🆕
- server/routes/nuxt-api/passenger/orders/[orderId]/soft-match-decision.post.ts 🆕
- openspec/changes/2026-05-21-soft-match-rematching/HANDOFF.md 🆕

**改動**
- shared/orderDispatch.ts ✏️（加 `isSoftMatch` 純函式）
- shared/orderDispatch.spec.ts ✏️（+5 case，198 tests 全綠）
- server/utils/audit-log.ts ✏️（`AuditAction` + 2: `order.rematch` / `order.soft_match_response`）
- server/utils/line-postback-handlers.ts ✏️（加 prefix-based PREFIX_HANDLERS + soft-match handler）
- server/routes/nuxt-api/admin/orders/[orderId]/assign.post.ts ✏️（Soft Match 分流推播 + 寫 confirmationStatus）
- server/routes/nuxt-api/admin/orders/index.get.ts ✏️（echo 3 個 1F 欄位：confirmationStatus / reMatchRound / bidHistory）
- server/routes/nuxt-api/orders/assigned.get.ts ✏️（echo passengerConfirmationStatus 給 driver UI）
- app/protocol/fetch-api/api/admin/order-dispatch.ts ✏️（assign response 加欄位 + `ForceRematchOrder` + `PostSoftMatchDecision`）
- app/protocol/fetch-api/api/admin/index.ts ✏️（types: PassengerConfirmationStatus / AdminOrderBidHistoryEntry + AdminOrder 加 3 個 optional field）
- app/protocol/fetch-api/api/order/type.d.ts ✏️（AssignedOrder 加 passengerConfirmationStatus）
- app/pages/admin/orders/index.vue ✏️（confirmation section + rematch button + rematch sub-modal + bidHistory section + list 重派次數徽章 + SCSS）
- app/pages/driver/trip/index.vue ✏️（列表 chip + modal banner + SCSS）
- i18n/locales/zh.js / en.js / ja.js ✏️（notification.softMatch.* + notification.rematch.* 共 21 keys × 3 語系）
