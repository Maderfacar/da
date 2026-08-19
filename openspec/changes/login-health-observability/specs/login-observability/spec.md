## ADDED Requirements

### Requirement: 每條登入路徑都記錄成敗結果
系統 SHALL 在每一條登入路徑的每一次嘗試結束時，寫入一筆結果紀錄至 `client_error_logs`：成功寫 `auth.login.ok`（`severity='info'`），失敗寫 `auth.login.fail`（`severity='warn'`），且 `metadata.route` MUST 標明路徑（`liff` 或 `browser-oauth`）。失敗紀錄 SHALL 另帶 `metadata.stage` 指出失敗環節。埋點失敗 MUST NOT 阻斷登入流程。

#### Scenario: LIFF 路徑登入成功
- **WHEN** 使用者於 LINE 內建瀏覽器完成 `line-exchange` 登入
- **THEN** 寫入一筆 `auth.login.ok`，`metadata.route='liff'`，並帶 `lineUserId`

#### Scenario: 瀏覽器 OAuth 路徑登入失敗
- **WHEN** `line/callback` 於 `verify` 環節判定失敗
- **THEN** 寫入一筆 `auth.login.fail`，`metadata.route='browser-oauth'`、`metadata.stage='verify'`

#### Scenario: 埋點寫入失敗不影響使用者
- **WHEN** 寫入 `client_error_logs` 時 Firestore 發生錯誤
- **THEN** 登入流程照常完成，不向使用者拋出任何錯誤

### Requirement: 以成功率而非錯誤筆數判定登入健康
系統 SHALL 依 `metadata.route` 分組計算成功率（`ok ÷ (ok + fail)`），並依下列規則判定：嘗試次數 ≥ 3 且成功率為 0 SHALL 判為 critical；嘗試次數 ≥ 10 且成功率 < 50% SHALL 判為 warn；嘗試次數為 0 MUST NOT 判定為異常。判定 MUST NOT 依賴錯誤筆數門檻。

#### Scenario: 低流量路徑全數失敗仍會告警
- **WHEN** 某路徑在統計視窗內有 3 次嘗試、0 次成功
- **THEN** 判定為 critical 並告警
- **AND** 即使該筆數低於既有的任何錯誤筆數門檻，仍必須告警

#### Scenario: 無人使用不視為異常
- **WHEN** 某路徑在統計視窗內嘗試次數為 0
- **THEN** 不判定為異常、不告警

#### Scenario: 2026-08-15 故障重播
- **WHEN** 餵入該次故障的實際資料形狀（`browser-oauth` 路徑 ok=0、fail=11）
- **THEN** 判定為 critical
- **AND** 此判定 SHALL 於該故障發生當日即成立，而非累積數日後才成立

### Requirement: 未列入良性清單的錯誤事件一律告警
系統 SHALL 維護一份「已知良性事件」清單，並對統計視窗內所有 `severity` 為 `error` 或 `warn` 且**不在該清單內**的事件型別發出告警，附事件名與筆數。系統 MUST NOT 採用「列舉需告警事件」的白名單方式判定。

#### Scenario: 新增的錯誤事件未經設定即被偵測
- **WHEN** 程式碼新增一個先前不存在的錯誤事件並寫入紀錄
- **THEN** 該事件即被列入告警，不需事先將其加入任何告警設定

#### Scenario: 良性事件不觸發告警
- **WHEN** 統計視窗內只有正常導向與狀態還原等已列入良性清單的事件
- **THEN** 不告警

### Requirement: 告警排程不受 Vercel cron 條數限制
系統 SHALL 於既有的認證健康 cron 端點內執行全部判定規則，MUST NOT 新增 Vercel cron 條目。系統 SHALL 另以 GitHub Actions 排程定時呼叫同一端點以提高偵測頻率，並以既有的 `CRON_SECRET` Bearer 機制保護。端點 SHALL 接受查詢參數指定統計視窗時數，預設 24 小時。

#### Scenario: 未越界時不發送訊息
- **WHEN** 三組規則皆未越界
- **THEN** 端點回成功回應，且不推送任何告警訊息

#### Scenario: 任一組規則越界即告警
- **WHEN** 成功率、未知事件、既有四項規則中任一項越界
- **THEN** 透過既有管道推送告警，訊息中分段列出越界項目

### Requirement: 跨 channel token 檢查以觀測模式導入
系統 SHALL 修復 `line-exchange` 中因讀取未宣告設定而永不執行的跨 channel 檢查：設定值 MUST 宣告於 runtimeConfig 並經字串正規化讀取。導入初期 SHALL 採觀測模式——比對不符時記錄 `auth.login.channel-mismatch`（`severity='error'`）但**放行**，MUST NOT 擋下請求。是否改為擋下 SHALL 由程式碼常數控制。

#### Scenario: token 來源相符
- **WHEN** LINE 回傳的 `client_id` 與設定值相符
- **THEN** 登入流程照常繼續，不記錄不符事件

#### Scenario: token 來源不符（觀測模式）
- **WHEN** `client_id` 與設定值不符且觀測模式開啟
- **THEN** 記錄 `auth.login.channel-mismatch` 並**放行**
- **AND** 該事件因不在良性清單內，會被未知事件規則告警

#### Scenario: 設定值為純數字時型別正確
- **WHEN** 設定值為純數字字串並經環境變數注入而被轉為數字型別
- **THEN** 讀取後 SHALL 為字串型別，與 LINE 回傳值可正確比對
