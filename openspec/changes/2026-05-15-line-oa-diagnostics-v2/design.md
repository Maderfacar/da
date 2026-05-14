# Design — P43 LINE OA Diagnostics 完整版

> 對應 [proposal.md](proposal.md)。以**推 spec 預設**（Q1=1a / Q2=2a / Q3=3c / Q4=4a / Q5=5a / Q6=6a / Q7=7c / Q8=8a）展開設計。

## 1. Event Log（Q1=1a 簡單 schema）

### 1.1 Firestore Schema

新 collection `line_event_logs/{autoId}`：

```typescript
{
  channel: 'passenger' | 'driver',
  eventType: 'follow' | 'unfollow' | 'message' | 'postback' | 'beacon' | 'memberJoined' | 'memberLeft' | 'unknown',
  lineUid: string | null,         // event.source.userId（admin only 可看，不 mask — Q7=7c）
  // Q1=1a 簡單 schema：只記三項 key info，不存 raw payload
  postbackData: string | null,    // eventType='postback' 時填 event.postback.data；否則 null
  messageText: string | null,     // eventType='message' && type='text' 時填（trim 100）；否則 null
  handlerResult: 'replied' | 'ignored' | 'handler_failed' | 'no_handler',
  createdAt: Timestamp,           // server timestamp
}
```

**Q1=1b 替代**：加 `rawPayload: object`（含 event source.type / 完整 postback.params / message.id 等）；JSON 序列化儲存，遞迴 depth ≤ 5。

### 1.2 寫入策略（Q4=4a fire-and-forget）

`writeLineEventLog(input)`：fire-and-forget（不 await），底層用 `db.collection('line_event_logs').add(...)`。

```typescript
export function writeLineEventLog(input: WriteEventLogInput): void {
  void (async () => {
    try {
      const { firebaseServiceAccountJson } = useRuntimeConfig();
      if (!firebaseServiceAccountJson) return;
      const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
      await db.collection('line_event_logs').add({
        ...input,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.warn('[line-event-log] write failed (silent):', err);
    }
  })();
}
```

webhook 入口（[line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook`）：每個 ev 處理結束前呼一次 writeLineEventLog；用 helper 統一決定 handlerResult。

**Q4=4b 替代**：寫入用 await，webhook 200 回應時間 +100-200ms；保證寫得到。實務上 webhook 不阻塞建議 4a。

### 1.3 GET endpoint

`GET /nuxt-api/admin/line-event-logs?channel=&eventType=&handlerResult=&limit=50`

權限：canBroadcast（與 richmenu 對齊）。
回 `{ items: EventLogDto[] }`，items 依 createdAt desc，預設 limit=50（Q8=8a）。

```typescript
interface EventLogDto {
  id: string;
  channel: 'passenger' | 'driver';
  eventType: string;
  lineUid: string | null;
  postbackData: string | null;
  messageText: string | null;
  handlerResult: string;
  createdAt: string;  // ISO
}
```

Firestore index：`channel ASC, createdAt DESC` + `eventType ASC, createdAt DESC`（依 query 組合決定）。

## 2. Error Log（Q2=2a 基本 schema）

### 2.1 Firestore Schema

新 collection `line_api_errors/{autoId}`：

```typescript
{
  channel: 'passenger' | 'driver' | 'unknown',
  api: string,                  // 'richmenu/create' / 'message/push' / 'message/reply' / 'user/all/richmenu' / ...
  method: 'GET' | 'POST' | 'DELETE',
  statusCode: number,            // LINE API HTTP status；網路錯為 599
  errorMessage: string,          // err.message
  // Q2=2a：errorDetails 只存最多 500 字 trim（避免大 payload）
  errorDetails: string | null,   // JSON.stringify(details).slice(0, 500)
  context: {
    targetUid: string | null,
    richMenuId: string | null,
    // 不存 request body（避免敏感資料外洩，accessToken 已被 audit-log mask 邏輯處理）
  },
  createdAt: Timestamp,
}
```

**Q2=2b 替代**：context 加 `requestBody: object`（mask sensitive keys 後存）+ `responseHeaders` snapshot。

### 2.2 寫入策略

`writeLineApiError(input)`：**await**（與 audit-log 同策略 — Vercel serverless 砍 promise 風險高）。

```typescript
export async function writeLineApiError(input: WriteErrorLogInput): Promise<void> {
  try {
    const { firebaseServiceAccountJson } = useRuntimeConfig();
    if (!firebaseServiceAccountJson) return;
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await db.collection('line_api_errors').add({
      ...input,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[line-api-error-log] write failed (silent):', err);
  }
}
```

### 2.3 散播點

下列 catch 內呼叫 writeLineApiError：

| File | Catch 位置 | api 標記 |
|---|---|---|
| [line-richmenu.ts](server/utils/line-richmenu.ts) | `_lineFetch` retry 後 throw 前 | 動態（從 url 取 path 後綴） |
| [line-push.ts](server/utils/line-push.ts) | sendLinePush catch | `message/push` |
| [line-channel.ts](server/utils/line-channel.ts) | `_reply` catch | `message/reply` |
| 個別 admin endpoint（publish / unpublish / cleanup-orphan）| catch LineApiError 時 | （目前已包在 _lineFetch 內，重複寫不需再加）|

### 2.4 GET endpoint

`GET /nuxt-api/admin/line-api-errors?channel=&api=&limit=50`

權限：canBroadcast。回 `{ items: ApiErrorDto[] }`。

Firestore index：`channel ASC, createdAt DESC` + `api ASC, createdAt DESC`。

## 3. TTL（Q3=3c 先不做）

第一版**不設 TTL**，目的：
- 觀察 1-2 週實際寫入量
- 確認 schema 穩定（避免 TTL field 後續還要 migration）
- Firestore TTL 設定後刪除為「最終一致」（可能延遲數天），先不設可手動清

跑 1 週後若 line_event_logs > 5000 doc 或月成本 > US$2 → 補做 Q3=3a Firestore TTL policy（加 `expiresAt: createdAt + 7d` field + Firebase Console 設 TTL）。

**Q3=3a 替代**：寫入時直接補 `expiresAt = new Date(Date.now() + 7*24*3600*1000)`；Firebase Console / firebase.json TTL config 設定該 field。

**Q3=3b 替代**：Vercel cron daily 觸發 `POST /api/internal/cleanup-line-logs`（internal token），delete where createdAt < (now - 7d) — 但需 batch（500 doc / batch）+ 處理迴圈。

## 4. Diagnostics tab UI（Q5=5a sub-tab）

### 4.1 結構

[/admin/line-management](app/pages/admin/line-management/index.vue) Diagnostics tab 內結構：

```
Diagnostics
├── [Sub-tab] Sync Overview  ← P40 既有，預設開啟
├── [Sub-tab] Event Log
└── [Sub-tab] Error Log
```

每 sub-tab 各自管 state；切 tab 時 lazy load。

### 4.2 Event Log Sub-tab UI

```
[Channel filter: 全部 / 乘客 OA / 司機 OA] [Event Type: 全部 / follow / message / postback / ...] [Handler Result: 全部 / replied / ignored / handler_failed / no_handler] [重新整理]

────────────────────────
| 時間 | Channel | Type | UID | Detail | Result |
| --- | --- | --- | --- | --- | --- |
| 05/15 14:32 | 乘客 | postback | Uabc...123 | data=OPEN_BOOKING | replied |
| 05/15 14:31 | 乘客 | follow | Uxyz...456 | — | replied |
| 05/15 14:30 | 司機 | message | Udef...789 | text="HI" | replied |
────────────────────────

Limit 50 (Q8=8a，超過請至 Firestore Console)
```

每 row 點開可看 lineUid 全字 + postbackData / messageText 完整（trim 前）。

### 4.3 Error Log Sub-tab UI

```
[Channel filter: 全部 / 乘客 / 司機] [API: 全部 / message/push / message/reply / richmenu/create / ...] [重新整理]

────────────────────────
| 時間 | Channel | API | Method | Status | Message |
| --- | --- | --- | --- | --- | --- |
| 05/15 14:35 | 乘客 | message/push | POST | 429 | Too Many Requests |
| 05/15 13:20 | 司機 | richmenu/create | POST | 400 | Invalid size |
| 05/15 12:15 | 乘客 | message/reply | POST | 599 | Network failure |
────────────────────────
```

每 row 點開可看 errorDetails / context（targetUid / richMenuId）。

## 5. Time Series Chart（Q6=6a 不做）

第一版不加 chart：raw list 已涵蓋 admin 95% 查詢場景。

**Q6=6b 替代**：加單 24h chart（柱狀），每小時 event 數；用既有 chart.js（admin/TrafficChart.client.vue 為參考）；data source 為 GET `/admin/line-event-logs/aggregate?channel=&hours=24` 新 endpoint，server 端 group by hour。

**Q6=6c 替代**：3 個 chart（24h event 數 / 7d daily / event type stacked），開頂層 stats card；估時 +0.5d。

## 6. 開放問題（待 Brain AI 拍板）

### Q1 — Event log payload 詳盡度

| 選項 | 描述 | 利 | 弊 |
|---|---|---|---|
| **1a 推 spec 預設**：簡單（type / uid / postbackData / messageText / handlerResult） | doc size 小、Firestore 成本低 | 部分 event 細節缺（如 message.id / postback.params） |
| 1b 完整：加 rawPayload object | 100% 重現 | doc size 大、Firestore 寫入成本 ~2x |

### Q2 — Error log context 詳盡度

| 選項 | 描述 |
|---|---|
| **2a 推 spec 預設**：基本（api/status/message/errorDetails trim 500/context.{targetUid,richMenuId}） |
| 2b 完整：加 requestBody snapshot（mask sensitive keys） — 偵錯時更有幫助但 doc 大 |

### Q3 — TTL 機制

| 選項 | 描述 |
|---|---|
| 3a Firestore TTL policy（原生）— 需 expiresAt field 寫入 + Firebase Console 設定 |
| 3b Vercel cron — daily 清 7d 前 doc |
| **3c 推 spec 預設**：先不做；1-2 週後看實際 data 量再加 |

### Q4 — Webhook event log 寫入策略

| 選項 | 描述 | 風險 |
|---|---|---|
| **4a 推 spec 預設**：fire-and-forget（不 await） | webhook 200 回應快 | log 偶爾掉（Vercel serverless 砍 promise） |
| 4b await | 保證寫得到 | webhook 回應 +100-200ms |

### Q5 — Diagnostics 分頁設計

| 選項 | 描述 |
|---|---|
| **5a 推 spec 預設**：sub-tab（Diagnostics tab 內三 sub-tab） |
| 5b 獨立子頁 `/admin/line-management/logs`（route 多一層；Logs 與 Diagnostics 拆開） |

### Q6 — Time Series Chart 範圍

| 選項 | 描述 | 估時 |
|---|---|---|
| **6a 推 spec 預設**：不做（raw list only） | +0d |
| 6b 簡單 24h heatmap（單 chart） | +0.25d |
| 6c 完整 dashboard（3 chart） | +0.5d |

### Q7 — userId 顯示

| 選項 | 描述 |
|---|---|
| 7a mask（U12345...EFGH 前 8 後 4） |
| 7b hash（SHA256） |
| **7c 推 spec 預設**：不 mask（admin 已高權限，與 audit-log 同策略） |

### Q8 — Pagination

| 選項 | 描述 |
|---|---|
| **8a 推 spec 預設**：固定 last 50（無 paging；要查舊紀錄請至 Firestore Console） |
| 8b 載入更多 / 無限滾動（用 startAfter cursor） |

## 7. 決策紀錄（保留結構）

> Brain AI 拍板後填入。

### 7.1 Q1 拍板（待填）

### 7.2 Q2 拍板（待填）

…（Q3-Q8 同）
