# 2026-05-15 — P43 LINE OA Diagnostics 完整版（Event Log + Error Log + Raw List）

> **狀態**：Phase 0 spec 草案 — 等 Brain AI 拍板 Q1-Q8 後才進 Phase 1。
> **前置**：P40 完工（commits `2ce7f76`..`fdf1305` push main + firestore rules deploy + v0.3.23）。
> **規模**：中等（預估 1.0-1.5 工作天 / 3-4 Phase），P40 Diagnostics MVP 的完整版升級。

## Why

P40 Phase 3 Q4=4b 拍板做了 Diagnostics MVP — 只含 richmenu sync overview（本地 vs LINE listRichmenus 比對 + 孤兒清理）。**運維上仍有 3 個盲區**：

1. **沒有 webhook event log**：admin 想查「使用者點 richmenu area 後實際 LINE 推了什麼 event 來？」「postback handler 收到 OPEN_BOOKING 是哪個 user？」目前只有 `console.warn` 輸出到 Vercel log（混在其他 server log 內、retention 短、搜尋難），無法事後追查行為流。
2. **沒有 LINE API error log**：sendLinePush / setDefaultRichmenu / uploadRichmenuImage 等 LINE API 呼叫失敗時，目前只 `console.error`。當 LINE quota 用完 / accessToken 過期 / 5xx 連續失敗時，admin 沒有集中介面看「最近 24h 有哪些 push 失敗、失敗在哪 API、user 影響範圍」。
3. **沒有時間維度視覺化**：MVP sync overview 是「點才查 LINE listRichmenus」，看不出趨勢。webhook 流量、postback 點擊頻率、bot reply 觸發次數，admin 無從掌握「上週與本週相比 user 互動量變化」。

P40 Phase 0 spec design.md §4 原本 4a 完整版列了這三項，當時 Brain AI 拍板 4b MVP（避免一次吞太多範圍）。本案完成原 4a 範圍 + 視覺化第一版（time series chart）。

## What Changes

### 1. Event Log — webhook 入口每筆寫（核心新功能）

新 collection `line_event_logs/{autoId}`，TTL 7d。

[server/utils/line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook` 入口（簽名驗證後 / 事件迴圈內），對每個 event 寫一筆 doc：

```typescript
{
  channel: 'passenger' | 'driver',
  eventType: 'follow' | 'unfollow' | 'message' | 'postback' | 'beacon' | 'memberJoined' | 'memberLeft' | 'unknown',
  lineUid: string | null,             // event.source.userId
  payload: {                          // 視 eventType 不同
    // postback: { data, params }
    // message: { type, text(trim 100), id }
    // follow / unfollow / beacon: {}
  },
  handlerResult: 'replied' | 'ignored' | 'handler_failed' | 'no_handler',
  createdAt: Timestamp,
}
```

寫入用 fire-and-forget（不阻擋 LINE 200 回應）。

### 2. Error Log — LINE API client catch 內統一寫

新 collection `line_api_errors/{autoId}`，TTL 7d。

抽 helper `writeLineApiError(ctx)` 到 [server/utils/line-api-error-log.ts](server/utils/line-api-error-log.ts)。下列地方 catch 內呼叫：
- [line-richmenu.ts](server/utils/line-richmenu.ts) `_lineFetch` 失敗 throw 前
- [line-push.ts](server/utils/line-push.ts) sendLinePush catch
- [line-channel.ts](server/utils/line-channel.ts) `_reply` catch
- 任何 admin endpoint 呼 LINE API 失敗的 catch

```typescript
{
  channel: 'passenger' | 'driver' | 'unknown',
  api: string,                        // 'richmenu/create' / 'message/push' / 'message/reply' / ...
  method: 'GET' | 'POST' | 'DELETE',
  statusCode: number,                  // LINE API HTTP status；網路錯為 599
  errorMessage: string,                // err.message
  errorDetails: object | string | null, // LINE 回傳 body / null
  context: {                          // 業務上下文
    targetUid?: string,
    richMenuId?: string,
    orderId?: string,
  },
  createdAt: Timestamp,
}
```

寫入用 await（業務流程已失敗，多 100-200ms 寫 log 可接受；與 audit-log 同策略）。

### 3. TTL 機制（Q3 拍板）

選項：
- **3a Firestore TTL policy（Firestore 原生）**：對兩 collection 各設一個 TTL field（如 `expiresAt: createdAt + 7d`），用 Firebase Console / firebase.json TTL 配置；Firestore 自動定期清；admin 不需維護
- **3b Vercel cron job**：每天觸發 `/api/internal/cleanup-line-logs`（admin internal token），刪 7d 前的 doc
- **3c 不做 TTL 第一版**：先 ship 看 cost；若 webhook QPS < 5（個位數）月寫 ~1 萬筆 doc，Firestore 成本 < US$0.5；admin 視情況決定何時加 TTL

### 4. Diagnostics tab UI（sub-tab 設計）

[/admin/line-management](app/pages/admin/line-management/index.vue) Diagnostics tab 加 sub-tab：
- **Sync Overview**（既有 P40 MVP，default 開啟）
- **Event Log**：list 最近 50 筆 webhook event（channel / type / uid / handlerResult / createdAt）
- **Error Log**：list 最近 50 筆 API error（channel / api / statusCode / message / createdAt）

每 sub-tab 含：
- channel filter（passenger / driver / 全部）
- type / api filter
- expand 看完整 payload / errorDetails
- 重新整理按鈕

### 5. Time Series Chart（Q6 拍板）

選項：
- **6a 不做**：raw list 為主；時間趨勢延後
- **6b 簡單 24h heatmap**：每小時 webhook event 數（單一 channel 切）；用既有 chart.js（admin/TrafficChart.client.vue 已 import）
- **6c 完整 dashboard**：多圖表（24h、7d、event type 堆疊 / error 比例 pie），開頂層 stats card

## Out of Scope（明確不做）

- ❌ LINE quota dashboard（剩餘 push 額度 / multicast 次數）— LINE API 不直接提供，需自 track；延後 P50+
- ❌ Webhook event 異常告警（連續 N 筆失敗 → 通知）— 第一版只 log，admin 自行查；告警系統需 cron job framework
- ❌ Permanent archive（log 超過 7d 自動清；如要長期保留需 BigQuery export，本案不做）
- ❌ Cross-channel 統計圖（passenger vs driver 分流比較）— Q6=6b 範圍只看單 channel；分流統計留 P50+
- ❌ Event log full text search / payload 篩選 — 第一版只 type / channel / status 三維過濾
- ❌ Error log auto-retry 標示（哪些已自動重試成功）— 重試邏輯由 `_lineFetch` 內 5xx retry 處理；log 不區分

## Impact

### 影響範圍

依 Q1-Q8 拍板會浮動：

- **新增 Firestore collection**：2 個（`line_event_logs` / `line_api_errors`）
- **新增 endpoint**：~3-4 個（event log GET list + error log GET list + 可選 chart aggregation GET）
- **新增 server util**：
  - `server/utils/line-event-log.ts`（封裝 writeLineEventLog + 入 line-channel webhook entry）
  - `server/utils/line-api-error-log.ts`（封裝 writeLineApiError + 散播到既有 catch）
- **改動既有**：
  - `server/utils/line-channel.ts`（webhook 入口寫 event log；現有 console.warn 補 writeLineApiError）
  - `server/utils/line-richmenu.ts`（`_lineFetch` 失敗前 writeLineApiError）
  - `server/utils/line-push.ts`（sendLinePush catch 補 writeLineApiError）
  - `firestore.rules`（加兩 collection rule + Claude 自跑 deploy）
  - `firestore.indexes.json`（依 Q1/Q2 篩選欄位設 composite index）
  - `app/pages/admin/line-management/index.vue`（Diagnostics tab 加 sub-tab + state + UI）

### 風險

| 風險 | 緩解 |
|---|---|
| Webhook event log 寫入 Firestore 燒成本 | TTL 7d 自動清；fire-and-forget；webhook QPS 個位數 → 月 < 1 萬筆 doc → 成本 < US$0.5 |
| API error log 寫入頻繁拖慢業務流程 | 業務流程本身已失敗（用 await 可接受 100-200ms 開銷）；對 reply token TTL 1min 場景仍即時 |
| `_lineFetch` 5xx retry 同一錯誤可能寫多筆 log | log 寫在 throw 前（最後一次失敗才寫），retry 中間 attempt 不寫；payload 含 attempt 標示 |
| line-channel.ts 已被多處 caller import；新增 writeLineEventLog dependency | event log 寫入用 try/catch swallow（log 失敗不阻擋 webhook 200） |
| Firestore TTL policy 設定錯誤可能誤刪 data | Q3=3a 路徑須先確認 expiresAt field 寫對；可先 Q3=3c 不設 TTL，跑 1 週看數量再決定 |
| Chart 重 render 拖慢頁面（Q6=6b/6c） | Diagnostics tab lazy load；chart.js 已在 admin/traffic 用過驗證 OK |

### 估時

| Phase | 內容 | 估時 |
|---|---|---|
| 0 | spec + Brain AI 拍板 Q1-Q8 | 0.25d |
| 1 | Event log（util + webhook 入口 + collection rule + GET list endpoint） | 0.5d |
| 2 | Error log（util + 散播到 4 個 catch 點 + GET list endpoint） | 0.25d |
| 3 | Diagnostics tab UI（sub-tab + event/error list + filter）+ chart（依 Q6 範圍）| 0.5d |
| 4 | e2e + version bump + HANDOFF + archive + memory | 0.25d |
| **總計** | | **1.0-1.5d** |

## Brain AI 拍板的關鍵決策（必須先給）

詳見 [design.md §6](design.md#6-開放問題待-brain-ai-拍板)。共 **8 個關鍵問題**：

1. **Q1**：Event log payload 詳盡度 — 1a 簡單（type/uid/handlerResult）/ 1b 完整（含原始 payload snapshot）
2. **Q2**：Error log context 詳盡度 — 2a 基本（api/status/message）/ 2b 完整（含 request body snapshot）
3. **Q3**：TTL 機制 — 3a Firestore TTL policy / 3b Vercel cron / 3c 先不做看 cost
4. **Q4**：Webhook event log 寫入策略 — 4a 入口 fire-and-forget（簡單）/ 4b 處理流程 await（保證）
5. **Q5**：Diagnostics 分頁設計 — 5a sub-tab（單頁體驗）/ 5b 獨立子頁 `/logs`
6. **Q6**：Time Series Chart 範圍 — 6a 不做（raw list only）/ 6b 簡單 24h heatmap / 6c 完整 dashboard
7. **Q7**：userId 顯示 — 7a mask（U12345...EFGH）/ 7b hash / 7c 不 mask（admin 已高權限）
8. **Q8**：Pagination — 8a 固定 last 50（無 paging，要查舊用 Firestore Console）/ 8b 載入更多 / 無限滾動

未拍板前 spec 以**推 spec 預設**（Q1=1a / Q2=2a / Q3=3c / Q4=4a / Q5=5a / Q6=6a / Q7=7c / Q8=8a）展開設計，Brain AI 改 default 後 spec 同步重寫。
