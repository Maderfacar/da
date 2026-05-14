# HANDOFF — P43 LINE OA Diagnostics 完整版（2026-05-15）

> 程式碼層完工 — Phase 0-3 全綠並 push main。firestore rules + indexes 已 deploy 完成。
> Brain AI 真機 e2e 驗收（tasks.md §4.1 checklist）為唯一留尾。

## 實作摘要

| Phase | 內容 | Commit |
|---|---|---|
| 0 | spec 三件套 + Brain AI 拍板 Q1-Q8 全用推 spec 預設 | `d4052f8` + `7c63cf0` |
| 1 | Event Log（`line_event_logs` collection + webhook 入口寫入 + GET endpoint + rules/indexes deploy） | `e2e7a52` |
| 2 | Error Log（`line_api_errors` collection + `_lineFetch` errorContext 散播 + sendLinePush / _reply catch + GET endpoint） | `25e5578` |
| 3 | Diagnostics sub-tab UI（Overview / Event Log / Error Log + filter + expand row + 狀態色） | `ac833ae` |
| 4 | version v0.3.24 + HANDOFF + archive + memory | （本次 archive commit） |

## 拍板紀錄（design.md §7）

8 個 Q 全用推 spec 預設（2026-05-15「預設即可」拍板）：

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | 1a | Event log 簡單 schema（不存 rawPayload；messageText trim 100） |
| Q2 | 2a | Error log 基本 schema（不存 requestBody；errorDetails trim 500） |
| Q3 | 3c | 第一版不設 TTL；觀察 1-2 週實際 data 量再決定 |
| Q4 | 4a | Webhook event log 用 fire-and-forget（不阻擋 LINE 200 回應） |
| Q5 | 5a | Diagnostics tab 內加 3 個 sub-tab（Sync Overview / Event Log / Error Log） |
| Q6 | 6a | 不做 time series chart（raw list only） |
| Q7 | 7c | userId 不 mask（admin 已高權限，與 audit-log 同策略） |
| Q8 | 8a | Pagination 固定 last 50（要查舊紀錄請至 Firestore Console） |

## 部署狀態

✅ **已 push main**（commits `d4052f8` → 本次 archive commit）：4 個 Phase 全綠
✅ **firestore rules + indexes 已 deploy**（Phase 1 加 `line_event_logs` + Phase 2 加 `line_api_errors`；各加 1 條 composite index `channel + createdAt DESC`）

⏳ **User 行動**：僅剩 tasks.md §4.1 e2e checklist 真機驗收

## 程式碼總覽

### 新增 utility（2 個）

- [server/utils/line-event-log.ts](server/utils/line-event-log.ts) — `writeLineEventLog(input): void` fire-and-forget；EventType / HandlerResult 列舉
- [server/utils/line-api-error-log.ts](server/utils/line-api-error-log.ts) — `writeLineApiError(input): Promise<void>` await；`extractApiPath(url)` helper（去 v2/bot prefix + 去 id-like 段）

### 改動既有

- [server/utils/line-channel.ts](server/utils/line-channel.ts)：
  - `handleLineWebhook` 每個 ev 結束前呼 writeLineEventLog；postback handler 加 try/catch 區分 handler_failed
  - `_normalizeEventType` helper 把未知 event type → 'unknown'
  - `_reply` 加 ctx 參數（client + targetUid）；catch 內 await writeLineApiError
- [server/utils/line-richmenu.ts](server/utils/line-richmenu.ts)：
  - `_lineFetch` 加 errorContext 參數（client + richMenuId + targetUid）；3 個 throw 點前內部 `_logError` 呼 writeLineApiError
  - 404 在 default richmenu / detail 視為正常 skip log（`_shouldSkipLog`）
  - 9 個 public helper（createRichmenu / uploadRichmenuImage / setDefaultRichmenu / clearDefaultRichmenu / getDefaultRichmenuId / listRichmenus / getRichmenuDetail / deleteRichmenu / linkRichmenuToUser / unlinkRichmenuFromUser）全傳 errorContext
- [server/utils/line-push.ts](server/utils/line-push.ts)：
  - sendLinePush catch 內 await writeLineApiError（api='message/push'）
  - sendLineMulticast 每 batch catch 內 await writeLineApiError（api='message/multicast'；batch size 標示）
  - 兩處皆維持 silent fail 契約（不 rethrow）
- [firestore.rules](firestore.rules)：加 `line_event_logs` + `line_api_errors` 兩 match block
- [firestore.indexes.json](firestore.indexes.json)：加兩 collection 各一個 `channel ASC + createdAt DESC` composite index

### 新增 endpoint（2 個）

- `GET /admin/line-event-logs?channel=&eventType=&handlerResult=&limit=50`（channel server filter + 其餘 client post-filter，預撈 2x limit）
- `GET /admin/line-api-errors?channel=&api=&limit=50`（channel server filter + api substring post-filter）

### 新增 protocol module（2 個）

- [app/protocol/fetch-api/api/admin/line-event-log/](app/protocol/fetch-api/api/admin/line-event-log/index.ts) — GetLineEventLogs + types
- [app/protocol/fetch-api/api/admin/line-api-error/](app/protocol/fetch-api/api/admin/line-api-error/index.ts) — GetLineApiErrors + types

### 整合 admin UI

- [app/pages/admin/line-management/index.vue](app/pages/admin/line-management/index.vue)：
  - Diagnostics tab 加 sub-tab switcher（DIAG_SUB_TABS = 3 個 entry）+ activeDiagSubTab ref
  - Event Log panel：3 filter（channel / eventType / handlerResult）+ 6 col grid + expand row（Full UID / Postback Data / Message Text / Created）
  - Error Log panel：2 filter（channel / api 字串）+ 6 col grid + expand row（Full Message / Details / Target UID / RichMenu ID）
  - 狀態色：handler_failed row 紅底；result 4 種色（replied 綠 / handler_failed 紅 / no_handler 橘 / ignored 灰）；statusCode 4xx 橘 / 5xx 紅
  - lazy load：watch activeDiagSubTab；切到 event-log / error-log 首次才 fetch

## 留尾（後續 Wave）

- **P42**：richmenu 多語版本（per-user 依 users.lang 自動切；獨立新視窗）
- **P44**：richmenu 圖層合成器 + area editor 拖拉互動 + resize handle（獨立新視窗）
- **P50+**：
  - LINE quota dashboard（剩餘 push 額度 / multicast 次數）
  - Webhook event 異常告警（連續 N 筆失敗 → 通知）
  - Time series chart（Q6=6b/6c 完整 dashboard）
  - Event log permanent archive（BigQuery export）
  - Cross-channel 統計圖（passenger vs driver 分流比較）
- **P43-FU**（若觀察 1-2 週後 line_event_logs 寫入量過大）：補 Firestore TTL policy（Q3=3a），加 `expiresAt = createdAt + 7d` field + Firebase Console 設定

## 已知留尾（非阻塞）

- writeLineEventLog 用 fire-and-forget（Vercel serverless 偶爾砍 promise），event log 可能掉幾筆；admin 視為 best-effort（不可作為財務 / 法務 audit 依據）
- userId 不 mask（Q7=7c）— 與 audit-log 同策略；admin 介面已加 row hover/click 才顯示完整 UID
- Error log `_shouldSkipLog` 內 404 視為「正常的沒有」不寫 log（getDefaultRichmenuId / getRichmenuDetail caller 已處理 null）
- Diagnostics sub-tab 切換是 lazy load 但不 force refresh；admin 切回某 sub-tab 看到舊 data，需手動點「重新整理」
- 不設 TTL，Phase 4 archive 後 1-2 週 admin 需手動觀察 Firestore Usage tab；若兩 collection 各 > 5000 doc / 月需補 TTL

## 版本

v0.3.24（[version.ts](version.ts)）— bump from v0.3.23（P40 archive）
