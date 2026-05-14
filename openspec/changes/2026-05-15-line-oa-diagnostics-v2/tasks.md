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
- [ ] 0.6 commit + push origin HEAD:main
- [ ] 0.7 **等 Brain AI 拍板 Q1-Q8** → 任一改 default 則 spec 重寫
- [ ] 0.8 拍板後 design.md §7 補拍板紀錄 → commit + push → 進 Phase 1

---

## Phase 1：Event Log（0.5 天）

> **前置**：Q1 + Q4 拍板。

### 1.1 Util + Schema

- [ ] 新建 `server/utils/line-event-log.ts`
  - `writeLineEventLog(input)` fire-and-forget（Q4=4a）或 await（4b）
  - `EventType` / `HandlerResult` 列舉與 schema 對齊
- [ ] 確認 schema 與 design.md §1.1 一致（Q1=1a 簡單版或 1b 含 rawPayload）

### 1.2 接 webhook entry

- [ ] [server/utils/line-channel.ts](server/utils/line-channel.ts) `handleLineWebhook` 每個 ev 處理結束前呼 writeLineEventLog
  - follow → result='replied'（成功）/ 'no_handler'（無 accessToken）
  - message+text → 'replied' / 'no_handler'
  - postback → 看 handlePostbackEvent 回傳：null=no_handler，replyMessages=replied，throw=handler_failed
  - 其他 event type → 'ignored'

### 1.3 Endpoint + Rules + Index

- [ ] `GET /nuxt-api/admin/line-event-logs?channel=&eventType=&handlerResult=&limit=50`
- [ ] `firestore.rules` 加 `line_event_logs`（admin read，server-only write）
- [ ] `firestore.indexes.json` 加 composite index（channel/eventType/handlerResult × createdAt DESC）
- [ ] firebase deploy rules + indexes（Claude 自跑）

### 1.4 Protocol

- [ ] `app/protocol/fetch-api/api/admin/line-event-log/`（GetLineEventLogs + types）
- [ ] admin/index.ts wire export

### 1.5 Stage Gate

- [ ] G1.1 lint + build pass
- [ ] G1.2 commit + push origin HEAD:main

---

## Phase 2：Error Log（0.25 天）

> **前置**：Q2 拍板。

### 2.1 Util + Schema

- [ ] 新建 `server/utils/line-api-error-log.ts`
  - `writeLineApiError(input)` await
  - schema 對齊 design.md §2.1

### 2.2 散播到 catch 點

- [ ] [line-richmenu.ts](server/utils/line-richmenu.ts) `_lineFetch` retry 後 throw 前呼 writeLineApiError
  - 從 url 取 api path 後綴（如 `https://api.line.me/v2/bot/richmenu/create` → `richmenu/create`）
- [ ] [line-push.ts](server/utils/line-push.ts) sendLinePush catch 內呼
- [ ] [line-channel.ts](server/utils/line-channel.ts) `_reply` catch 內呼

### 2.3 Endpoint + Rules + Index

- [ ] `GET /nuxt-api/admin/line-api-errors?channel=&api=&limit=50`
- [ ] `firestore.rules` 加 `line_api_errors`
- [ ] `firestore.indexes.json` 加 composite index
- [ ] firebase deploy rules + indexes（與 Phase 1 一併或分開；Claude 自跑）

### 2.4 Protocol

- [ ] `app/protocol/fetch-api/api/admin/line-api-error/`（GetLineApiErrors + types）
- [ ] admin/index.ts wire export

### 2.5 Stage Gate

- [ ] G2.1 lint + build pass
- [ ] G2.2 commit + push origin HEAD:main

---

## Phase 3：Diagnostics UI（0.5 天）

> **前置**：Q5 + Q6 + Q7 + Q8 拍板。

### 3.1 Sub-tab 結構

- [ ] [/admin/line-management/index.vue](app/pages/admin/line-management/index.vue) Diagnostics tab 加 sub-tab：
  - Sync Overview（既有 P40，predefault）
  - Event Log
  - Error Log
- [ ] sub-tab 切換 lazy load（避免進頁同時打三組 API）

### 3.2 Event Log sub-tab

- [ ] state（events / loading / filters）
- [ ] filter UI（channel / eventType / handlerResult）
- [ ] list 顯示（time / channel / type / uid / detail / result）
- [ ] expand row 看完整資料
- [ ] limit 50 提示（Q8=8a）

### 3.3 Error Log sub-tab

- [ ] state + filter UI（channel / api）
- [ ] list 顯示（time / channel / api / method / status / message）
- [ ] expand row 看 errorDetails / context

### 3.4 Time Series Chart（依 Q6 範圍）

- [ ] Q6=6a：跳過
- [ ] Q6=6b：加 24h heatmap chart（chart.js）+ aggregate endpoint
- [ ] Q6=6c：3 chart 完整 dashboard + 多 aggregate endpoint（估時 +0.5d）

### 3.5 Stage Gate

- [ ] G3.1 lint + build pass
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
