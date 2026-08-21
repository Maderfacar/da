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
- [x] **C.5** ✅ 2026-08-20 完成：Brain AI 已於 Vercel + GitHub 兩邊設定同值。手動觸發 workflow **success（9s）**，步驟一取得完整遙測 → 證明兩邊 secret 一致（不一致會回 401）。

## Phase D：地雷修復（跨 channel 檢查，觀測模式）

- [x] **D.1** `nuxt.config.ts`（改）— runtimeConfig 補宣告 `lineChannelId: ''`（`NUXT_LINE_CHANNEL_ID`）
- [x] **D.2** `auth/line-exchange.post.ts`（改）— `configStr(config.lineChannelId)` 讀取；不符時寫 `auth.login.channel-mismatch`（`severity='error'`）**但放行**
- [x] **D.3** `LOGIN_CHANNEL_ENFORCE` 常數 + 註解說明翻開條件與步驟（2026-08-22 已翻為 `true`，見 V.4）
- [x] **D.4** 單元測試（相符放行、不符觀測模式放行並記錄、enforce 模式擋下）
- [x] **D.5** lint / test / build 全綠 → commit + push
- [x] **D.6** ✅ 2026-08-20 完成：健檢端點確認 prod 已設定（回報為 type-hazard 而非 missing）→ 跨 channel 檢查已進入觀測模式實際運作。

## 驗收（Brain AI）

- [x] **V.1** ✅ 2026-08-20 05:22:03 實測：`auth.login.ok` `{route:'browser-oauth', roles:[passenger,admin,driver]}`
- [x] **V.2** ✅ 2026-08-20 11:41:28 實測：`auth.login.ok` `{route:'liff', roles:[passenger,driver], approved:true}`
- [x] **V.3** ✅ 2026-08-20 實測：手動觸發 success；未越界時 `notified:false` 不發訊息。06:36 與 09:48 兩次真實告警皆正確送達 LINE。
- [x] **V.4** ✅ 2026-08-22 已翻 `LOGIN_CHANNEL_ENFORCE = true`（commit **129adb5**）。依據三項，缺一不可：
  - [x] **① 先證明防護真的在跑**（最關鍵、最容易漏）：`expectedChannelId` 為空時整道檢查靜默短路，
        **「0 筆不符」與「防護根本沒跑」無法區分** —— 即 4ce6071 與 allow-list 告警的同一形狀。
        證據：健檢回報 `NUXT_LINE_CHANNEL_ID` 為 **type-hazard**，而 type-hazard 只在
        「值存在且被 destr 轉成 number」時產生 ⇒ 值必然存在 ⇒ 短路條件已解除。
  - [x] **② 實測 0 不符**：防護生效（≤ 2026-08-19T23:33Z，由 workflow 歷史 run 回推）後
        3 次 LIFF 登入，`auth.login.channel-mismatch` 全窗 0 筆。
  - [x] **③ 結構上必然相符（不依賴樣本數）**：兩個 LIFF ID `2009509209-5TaNYcF5` /
        `2009509209-2hGUMoYt` 的前綴即 Login channel id，與 `NUXT_LINE_CHANNEL_ID` 同值
        ⇒ `/verify` 回傳的 client_id 必為該值。三項中唯一不怕流量稀疏的依據。
  - [x] 殘餘缺口已點名並確認有人守：設定被清掉 → 靜默短路，但該 env 在契約中為 `required`，
        缺失即 error → production build 擋下 + 每小時漂移偵測轉紅。已寫進呼叫點註解。
- [ ] **V.5** deny-by-default 噪音評估（進行中）
  - [x] 06:36 首次告警 3 種事件逐一判讀：2 種是真 bug（已修於 775135d），1 種是真訊號
  - [x] **三種都未加入 `KNOWN_BENIGN_EVENTS`** —— 讓告警安靜的正確方式是修好問題
  - [x] 09:48 第二次告警驗證修復有效：`window.unhandledrejection` 與 `auth.init.timeout` 皆歸零
  - [ ] `auth.liff.init.failed` 續觀察 —— **2026-08-22 盤點：零復發但樣本不足，維持觀察、不入良性清單**。
        44 筆全部 ≤ 2026-08-19T23:45Z。易誤判處：之後確實有 LIFF 流量，且 **LIFF 登入成功本身
        即證明 `liff.init` 成功**（line-exchange 需要 LIFF access token）⇒ 是 3/3 成功而非 0 流量。
        但 n=3 撐不起「已修」的結論。
  - [x] `auth.init.timeout` **判定已修（2026-08-22）**：20 筆全部早於 775135d 上線
        （2026-08-19T22:55Z），且同場景已重放 —— 08-20T03:41Z 司機自 LIFF 進
        `/driver/dispatched` → `/dashboard` → `/trip`，零 timeout；最後一筆 timeout 的
        context 正是同一使用者、同一路徑。不是「沒流量所以沒告警」。

## 留待後續（不在本變更）

- 承諾 1：設定值啟動時 schema 驗證（讓設定寫錯的部署直接紅）
- 承諾 3：登入驗證改用標準 OIDC 函式庫，縮小手寫面積
