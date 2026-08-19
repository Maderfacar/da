# Login Health Observability — Tasks

> 慣例：每個 Phase 跑 `pnpm lint && pnpm test && pnpm build` 全綠才 commit + push origin main（直推 prod）。
> A→B→C 有嚴格相依（沒有埋點就沒有資料，沒有資料就無從判定）；D 可獨立上 prod、可獨立 rollback。

## Phase A：埋點地基（沒資料就沒成功率）

- [x] **A.0** OpenSpec change 四份 artifact（proposal / design / tasks / spec）✅ 本次
- [x] **A.1** `server/utils/login-outcome.ts`（新）
  - [x] `LOGIN_ROUTES = ['liff', 'browser-oauth']` + `LoginRoute` 型別
  - [x] `LOGIN_EVENT_OK = 'auth.login.ok'` / `LOGIN_EVENT_FAIL = 'auth.login.fail'`
  - [x] `writeLoginOutcome(db, input)` — 包 `writeAuthErrorLog`，成功寫 `info`、失敗寫 `warn`，`metadata.route` 必填
- [x] **A.2** `auth/line/callback.get.ts`（改）— 所有 return 點改走 `writeLoginOutcome`，`route='browser-oauth'`，保留既有 `stage` / `reason` metadata
- [x] **A.3** `auth/line-exchange.post.ts`（改）— **補齊全部成敗埋點**（現況零埋點），`route='liff'`
  - [x] 成功路徑寫 ok（含 lineUserId）
  - [x] 各失敗 return 點寫 fail（stage：`verify` / `userinfo` / `provision` / `session` / `ratelimit`）
  - [x] 埋點失敗不得阻斷登入（helper 內已 try-catch，永不 throw）
- [x] **A.4** 單元測試 `server/utils/login-outcome.spec.ts`（event 名、severity 對應、route 必填、metadata 完整）
- [x] **A.5** lint / test / build 全綠 → commit + push

## Phase B：判定邏輯（純函式）

- [x] **B.1** `server/utils/login-health.ts`（新）
  - [x] `tallyLoginOutcomes(logs)` → 依 `metadata.route` 分組計 ok / fail / attempts / successRate
  - [x] `evaluateLoginSuccessRate(tally)` → critical：`attempts>=3 && successRate===0`；warn：`attempts>=10 && successRate<0.5`；`attempts===0` 不判定
  - [x] `KNOWN_BENIGN_EVENTS` 初始清單 + `detectUnknownEvents(logs)` → error/warn 且不在清單內
- [x] **B.2** 單元測試 `server/utils/login-health.spec.ts`
  - [x] **迴歸案例（最重要）**：餵入本次故障的實際形狀（`browser-oauth` ok=0 / fail=11）→ **必須回 critical**
  - [x] `attempts===0` 不告警；混合路徑分別判定；未知事件偵測含/不含清單
- [x] **B.3** `auth-health-alert.ts` 保持原樣（四項規則並存，不刪不改）
- [x] **B.4** lint / test 全綠 → commit + push

## Phase C：排程與告警

- [x] **C.1** `server/api/cron/alert-auth-health.get.ts`（改）
  - [x] 查詢視窗改為可由 `?hours=` 指定（預設 24，上限 24）
  - [x] 三組規則並行：既有四項 + 登入成功率 + 未知事件
  - [x] 任一組越界 → `notifyAdmins`；全數未越界 → 不發訊息（免噪音）
- [x] **C.2** 告警訊息組裝（純函式 + 測試）— 分段列出越界項目、路徑成功率、未知事件名與筆數
- [x] **C.3** `.github/workflows/login-health.yml`（新）— `schedule: cron` 每小時 + `workflow_dispatch`，帶 `CRON_SECRET` 打 `?hours=3`
- [x] **C.4** lint / test / build 全綠 → commit + push
- [ ] **C.5** ⚠️ **需 Brain AI 操作**：GitHub repo 設定 `CRON_SECRET` secret（值與 Vercel 環境變數相同）

## Phase D：地雷修復（跨 channel 檢查，觀測模式）

- [x] **D.1** `nuxt.config.ts`（改）— runtimeConfig 補宣告 `lineChannelId: ''`（`NUXT_LINE_CHANNEL_ID`）
- [x] **D.2** `auth/line-exchange.post.ts`（改）— `configStr(config.lineChannelId)` 讀取；不符時寫 `auth.login.channel-mismatch`（`severity='error'`）**但放行**
- [x] **D.3** `LOGIN_CHANNEL_ENFORCE = false` 常數 + 註解說明翻開條件與步驟
- [x] **D.4** 單元測試（相符放行、不符觀測模式放行並記錄、enforce 模式擋下）
- [x] **D.5** lint / test / build 全綠 → commit + push
- [ ] **D.6** ⚠️ **需 Brain AI 操作**：Vercel 環境變數設 `NUXT_LINE_CHANNEL_ID=2009509209`。**未設定則檢查仍然是關的**（空字串短路），本 Phase 等同只做了型別修正

## 驗收（Brain AI）

- [ ] **V.1** 手機瀏覽器實機登入一次 → prod log 出現 `auth.login.ok`（`route='browser-oauth'`）
- [ ] **V.2** LINE 內建瀏覽器登入一次 → 出現 `auth.login.ok`（`route='liff'`）
- [ ] **V.3** 手動觸發 GitHub Actions workflow → 無越界時不發訊息、有越界時收到 LINE 告警
- [ ] **V.4** 觀察數日 `auth.login.channel-mismatch` 是否為 0 → 若是，翻 `LOGIN_CHANNEL_ENFORCE = true`
- [ ] **V.5** deny-by-default 噪音評估 → 依實際告警內容補 `KNOWN_BENIGN_EVENTS`

## 留待後續（不在本變更）

- 承諾 1：設定值啟動時 schema 驗證（讓設定寫錯的部署直接紅）
- 承諾 3：登入驗證改用標準 OIDC 函式庫，縮小手寫面積
