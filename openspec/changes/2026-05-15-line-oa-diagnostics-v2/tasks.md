# Tasks — P43 LINE OA Diagnostics 完整版

> **總時程**：≈ 1.0-1.5 工作天 / 3-4 Phase。
> **決策依據**：Brain AI 拍板 [design.md §6](design.md#6-開放問題待-brain-ai-拍板) Q1-Q8（必拍才能進 Phase 1）。
> **推 spec 預設**：Q1=1a / Q2=2a / Q3=3c / Q4=4a / Q5=5a / Q6=6a / Q7=7c / Q8=8a

---

## Phase 0：Spec + Brain AI 拍板（0.25 天）

- [x] 0.1 P40 完工 audit（commits 2ce7f76..fdf1305 全 push main + firebase deploy rules 完成）
- [x] 0.2 範圍盤點（event log + error log + TTL + UI sub-tab + chart 範圍）
- [x] 0.3 撰寫 [proposal.md](proposal.md)
- [x] 0.4 撰寫 [design.md](design.md)
- [x] 0.5 撰寫 [tasks.md](tasks.md)（本檔）
- [x] 0.6 commit + push origin HEAD:main（commit `d4052f8`）
- [x] 0.7 **Brain AI 拍板 Q1-Q8**（2026-05-15 全採推 spec 預設：1a/2a/3c/4a/5a/6a/7c/8a）
- [x] 0.8 design.md §7 補拍板紀錄 → commit + push → 進 Phase 1

---

## Phase 1：Event Log（0.5 天）

> **前置**：Q1 + Q4 拍板。

### 1.1 Util + Schema

- [x] 新建 `server/utils/line-event-log.ts` — `writeLineEventLog(input): void` fire-and-forget（Q4=4a）+ EventType / HandlerResult 列舉
- [x] schema 與 design.md §1.1 一致（Q1=1a 簡單版：不存 rawPayload；messageText trim 100 字）

### 1.2 接 webhook entry

- [x] [server/utils/line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook` 每個 ev 處理結束前呼 writeLineEventLog
  - follow / message+text：accessToken 有 → 'replied'；無 → 'no_handler'
  - postback：handler 回 replyMessages → 'replied'；null → 'no_handler'；throw → 'handler_failed'
  - 其他 event type（beacon / memberJoined 等）→ 'ignored'
  - `_normalizeEventType` 把未知 type → 'unknown'

### 1.3 Endpoint + Rules + Index

- [x] `GET /nuxt-api/admin/line-event-logs?channel=&eventType=&handlerResult=&limit=50`（channel server filter + 其餘 client-side post-filter，避免 composite index 爆炸）
- [x] `firestore.rules` 加 `line_event_logs`（admin read，server-only write）
- [x] `firestore.indexes.json` 加 composite index（channel ASC + createdAt DESC）
- [x] firebase deploy rules + indexes 成功（Claude 自跑：`npx firebase-tools deploy --only firestore:rules,firestore:indexes`）

### 1.4 Protocol

- [x] `app/protocol/fetch-api/api/admin/line-event-log/`（GetLineEventLogs + types）
- [x] admin/index.ts wire export

### 1.5 Stage Gate

- [x] G1.1 lint + build pass
- [ ] G1.2 commit + push origin HEAD:main

---

## Phase 2：Error Log（0.25 天）

> **前置**：Q2 拍板。

### 2.1 Util + Schema

- [x] 新建 `server/utils/line-api-error-log.ts` — `writeLineApiError(input): Promise<void>` await + `extractApiPath(url)` helper（去 v2/bot prefix + 去 id-like 段，避免 path explosion）
- [x] schema 對齊 design.md §2.1（Q2=2a 基本版：errorDetails / errorMessage 各 trim 500 字；不存 requestBody）

### 2.2 散播到 catch 點

- [x] [line-richmenu.ts](server/utils/line-richmenu.ts) `_lineFetch` 加 errorContext 參數；throw 前內部 `_logError` 呼 writeLineApiError（404 在 getDefaultRichmenuId / getRichmenuDetail 視為正常 skip log）；9 個 public helper 全傳 errorContext
- [x] [line-push.ts](server/utils/line-push.ts) sendLinePush + sendLineMulticast catch 內 await writeLineApiError（不 rethrow，維持 silent fail 契約）
- [x] [line-channel.ts](server/utils/line-channel.ts) `_reply` 加 ctx 參數；catch 內 await writeLineApiError；3 處 caller 全傳 ctx

### 2.3 Endpoint + Rules + Index

- [x] `GET /nuxt-api/admin/line-api-errors?channel=&api=&limit=50`（channel server filter + api client substring post-filter）
- [x] `firestore.rules` 加 `line_api_errors`
- [x] `firestore.indexes.json` 加 channel ASC + createdAt DESC composite index
- [x] firebase deploy rules + indexes 成功（Claude 自跑）

### 2.4 Protocol

- [x] `app/protocol/fetch-api/api/admin/line-api-error/`（GetLineApiErrors + types）
- [x] admin/index.ts wire export

### 2.5 Stage Gate

- [x] G2.1 lint + build pass
- [ ] G2.2 commit + push origin HEAD:main

---

## Phase 3：Diagnostics UI（0.5 天）

> **前置**：Q5 + Q6 + Q7 + Q8 拍板。

### 3.1 Sub-tab 結構

- [x] [/admin/line-management/index.vue](app/pages/admin/line-management/index.vue) Diagnostics tab 加 sub-tab switcher（DIAG_SUB_TABS = 3 個 entry）
  - Sync Overview（既有 P40，predefault）
  - Event Log
  - Error Log
- [x] sub-tab 切換 lazy load（首次切到時才 fetch；watch activeDiagSubTab）

### 3.2 Event Log sub-tab

- [x] state（eventLogs / eventLogsLoading / 3 filters）
- [x] filter UI（channel select + eventType select + handlerResult select + 重新整理按鈕）
- [x] list 顯示（6 col grid：time / channel / type / uid / detail / result）
- [x] expand row 看完整資料（Full UID / Postback Data / Message Text / Created）
- [x] handler_failed row 紅底 + result column 依狀態著色（綠/紅/橘/灰）

### 3.3 Error Log sub-tab

- [x] state + filter UI（channel select + api substring text input + 重新整理）
- [x] list 顯示（6 col grid：time / channel / api / method / status / message）
- [x] expand row 看 errorDetails / context（Target UID / RichMenu ID）
- [x] status column 依 4xx/5xx 著色（橘/紅）

### 3.4 Time Series Chart（Q6=6a 不做）

- [x] Q6=6a 跳過（spec 預設）

### 3.5 Stage Gate

- [x] G3.1 lint + build pass
- [ ] G3.2 commit + push origin HEAD:main

---

## Phase 4：e2e + Archive（0.25 天）

### 4.1 e2e checklist

- [ ] Event log：手動觸發各 event type（follow / message / postback）→ Diagnostics tab 看到對應 log
- [ ] Error log：故意送錯誤 LINE API（如 admin test-bind 假 uid）→ Error log 看到 4xx 紀錄
- [ ] Filter：channel + type 組合過濾正常
- [ ] Expand row 看完整 payload / errorDetails 正常

### 4.2 文件 + Archive

- [ ] [version.ts](version.ts) bump v0.3.23 → v0.3.24
- [ ] [HANDOFF.md](HANDOFF.md) 撰寫（沿用 P40 archive 格式）
- [ ] `openspec/changes/2026-05-15-line-oa-diagnostics-v2/` mv 至 `archive/`
- [ ] memory `project-p43-diagnostics-v2.md` 新增；MEMORY 索引同步

### 4.3 Stage Gate

- [ ] G4.1 lint + build pass
- [ ] G4.2 Brain AI 真機驗收
- [ ] G4.3 commit + push origin HEAD:main（含 archive mv）

---

## 完成後解鎖

- **P42**：richmenu 多語版本（per-user 依 users.lang 自動切；獨立視窗）
- **P44**：richmenu 圖層合成器 + area editor 拖拉互動 + resize handle（獨立視窗）
- **P50+**：LINE quota dashboard / 異常告警 / event log 進階分析（heatmap / 全文搜尋）
