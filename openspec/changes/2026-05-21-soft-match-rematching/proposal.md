# Phase 1F — Soft Match 確認 + 重新配對流程（2026-05-21）

> 整體計畫第 6 phase。前置：1A~1E 已完成（含 1E 的 dispatch / bid / assign 流程）。
> **本 phase 補上「配對不完美 / 配對後變動」兩種異常路徑**，乘客可拒絕、admin 可重派。

## Why

1E 完成「正常配對成功」路徑。但實務上會碰到：
1. **Soft Match**：admin 從喊單清單挑了一個司機，但這 driver 標籤命中率不滿 100%（如乘客勾 3 個偏好，driver 只有 2 個符合）。乘客**應有否決權**（拍版 #B4）。
2. **車況變動**：driver 中選後車輛標籤 / vehicleProfile 變動（航空椅損壞送修等）→ admin 應能觸發**重新配對**，讓另一個 driver 來接。
3. **司機反悔**：driver assigned 後不接 → admin 取消該 assignment 並重新派發。

本 phase 把這三個異常路徑收乾淨，**並接上付款政策（後付，全額退款 = 取消訂單）**。

## What Changes

### 機制總覽

#### Soft Match 詢問

當 admin 在 1E `/assign` 動作時，server 端比對 `matchCount` vs `preferenceCount`：
- `matchCount >= preferenceCount` → 完全命中，`passengerConfirmationStatus = 'auto'`，正常通知配對成功
- `matchCount < preferenceCount` → Soft Match，`passengerConfirmationStatus = 'pending'`，**LINE 推播改為 3 選 1 Flex**

乘客 3 選 1：
- **接受**：`passengerConfirmationStatus = 'accepted'`；訂單繼續執行
- **等下一輪**：訂單觸發**重新配對**（清 driverId / bids / 重簽 dispatchAt）；passenger 留在 order，繼續等
- **全額退款**：因後付（拍版 #12），無金額需退；訂單直接 `cancelled_by_passenger`

#### 重新配對 trigger

**3 個觸發點**：
1. 乘客 Soft Match 選「等下一輪」
2. Admin 訂單詳情頁點「強制重新配對」按鈕（理由：車況變動、司機反悔）
3. 自動 trigger（車況變動 → 暫不做，留 Phase 2）

trigger 動作：
- 把 `order.driverId`、`order.assignedAt`、`order.assignedBy` 清掉
- 把 `order.bids` 整個清空（不保留，因為 driver 名單可能不同）
  - 或者把 bids[] move 到 `order.bidHistory[][]`（保留歷史）—— 本期**移到 history**（保留 audit trail）
- 重簽 `dispatchAt = now`、`reMatchRound = (現有 + 1)`
- 觸發 LINE push 給全部 active driver（同 1E）
- 觸發 LINE 通知 passenger「正在重新為您配對」

#### 訂單狀態 (`status`) 在 re_matching 期間

依拍版 #1（不要新狀態），re_matching 走 pending status：
- driverId 為 null + dispatchAt 為新值 + reMatchRound > 0 = 「重新配對中」
- 但 spec proposal.md 1A 提到的 state machine 有 `re_matching` state — **本 phase 改為走 status='pending' 加 `reMatchRound` 計數**，避免再加新 enum

修訂後 state machine：

```
pending ──[admin dispatch]──► pending(dispatchAt set, reMatchRound=0)
        ──[admin assign]────► confirmed (passengerConfirmationStatus='auto'|'pending')
                          │
                          ├──[passenger soft match accept]──► confirmed('accepted')
                          ├──[passenger soft match wait]────► pending(reMatchRound++) ◄─ 重新配對
                          ├──[passenger soft match cancel]──► cancelled_by_passenger
                          ├──[admin force rematch]──────────► pending(reMatchRound++) ◄─ 重新配對
                          ├──[start trip]───────────────────► in_progress ──► completed
                          └──[cancel]───────────────────────► cancelled_*
```

## 11 個決策

| # | 議題 | 拍版 |
|---|---|---|
| 1 | 不引入新 status enum | 走 pending 重置 + reMatchRound 計數 |
| 2 | Soft Match 判斷 | `matchCount < preferenceCount`（match preferenceTagIds 部分命中）|
| 3 | matchCount = 0 算 Soft Match 嗎 | 是（顯式告訴乘客「無命中」也要乘客同意） |
| 4 | preferenceCount = 0（乘客沒勾偏好）算啥 | 強制 auto（沒勾就沒得不滿意） |
| 5 | Passenger 3 選 1 入口 | LINE Flex postback button（無 web fallback；driver postback 既有架構 |
| 6 | 重新配對清 bids | 移到 `bidHistory[]`（保留 audit） |
| 7 | reMatchRound 上限 | 無上限（admin 自己掌握；過多次代表訂單不可滿足，admin 手動取消） |
| 8 | 取消（全額退款） | 因後付，無實際退款；訂單 → `cancelled_by_passenger` |
| 9 | 中選 driver 在 rematch 時 | LINE 通知「您原本中選的訂單已重新配對，本次不再為您指派」 |
| 10 | Soft match LINE postback 失效 | passenger 不點任何按鈕 → 訂單停在 `confirmed(pending)`；admin 可手動 force rematch 救 |
| 11 | i18n | passenger 三語完整 |

## Impact

### Affected code (Phase 1F only)

| 檔案 | 動作 |
|---|---|
| `server/utils/order-dispatch.ts` | 改：加 `reMatchOrder(db, orderId, reason, adminUid?)` helper（轉 bids → bidHistory + 清 driverId 等） |
| `server/utils/order-soft-match.ts` | 🆕 判定 isSoftMatch / 組 LINE Flex 3 選 1 |
| `server/utils/line-soft-match-push.ts` | 🆕 |
| `server/routes/nuxt-api/admin/orders/[orderId]/assign.post.ts` | 改：assign 後判斷 isSoftMatch → 走不同 LINE push 分支；寫 `passengerConfirmationStatus` |
| `server/routes/nuxt-api/admin/orders/[orderId]/rematch.post.ts` | 🆕 admin 強制重新配對 |
| `server/routes/nuxt-api/passenger/orders/[orderId]/soft-match-decision.post.ts` | 🆕 passenger 3 選 1（可從 LINE postback 走 webhook 或直接 web 上） |
| `server/routes/api/line/webhook.post.ts` 或既有 line-channel 內 postback 處理 | 改：加 `passenger.softMatch.{accept,wait,cancel}` postback handler |
| `server/utils/audit-log.ts` | 改：`AuditAction` 加 `order.rematch` / `order.soft_match_response` |
| `app/pages/admin/orders/[id].vue` | 改：confirmed 訂單顯示「強制重新配對」按鈕（理由 textarea） |
| `app/pages/admin/orders/[id].vue` | 改：confirmed 訂單顯示 passenger confirmation status |
| `i18n/locales/{zh,en,ja}.js` | 加 `notification.softMatch.*` 三語 |

### 不影響

- 1A~1E 核心 schema
- 1D pricing 計算
- 折扣碼 / fare V2 / referral

## 驗收標準

- [ ] admin 指派 100% 命中 driver → passenger 收正常配對成功 push（無 3 選 1）
- [ ] admin 指派部分命中 driver → passenger 收 3 按鈕 Flex
- [ ] passenger 點「接受」→ confirmationStatus 變 accepted；訂單繼續
- [ ] passenger 點「等下一輪」→ 訂單回 pending、reMatchRound +1、原 bids 移到 bidHistory、全部 driver 收新需求單推播
- [ ] passenger 點「全額退款」→ 訂單 cancelled_by_passenger，無實際扣款動作
- [ ] admin 訂單詳情顯示 passengerConfirmationStatus
- [ ] admin 在 confirmed 訂單點「強制重新配對」→ 同樣流程觸發
- [ ] 原中選 driver 在 rematch 時收 LINE 通知「您本次未繼續中選」
- [ ] reMatchRound > 0 的訂單在 admin 看板有標示（如「重派 2 次」）
- [ ] `pnpm lint` / `pnpm test` / `pnpm build` 全綠
