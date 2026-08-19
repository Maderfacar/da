# Login Health Observability — Design

## 現況盤點（實測，非推論）

| 登入路徑 | 端點 | 成功埋點 | 失敗埋點 | 可算成功率 |
|---|---|---|---|---|
| LINE 內建瀏覽器（LIFF） | `auth/line-exchange.post.ts` | ❌ 無 | ❌ 無 | ❌ |
| 一般手機／PC 瀏覽器 | `auth/line/callback.get.ts` | ✅ `auth.line-login.callback.ok` | ✅ `.fail` | ⚠️ 事件名不統一 |

`line-exchange` 全檔零 `writeAuthErrorLog` 呼叫——這是 Phase A 存在的唯一理由。

## 資料模型

沿用 `client_error_logs`（`writeAuthErrorLog` 已對齊 schema，含 7 天保留 cron），不新增 collection。

```
event    : 'auth.login.ok' | 'auth.login.fail'
severity : 'info'（ok） | 'warn'（fail）
category : 'auth'
metadata : {
  route  : 'liff' | 'browser-oauth',     // 成功率的分組維度
  stage? : string,                        // fail 才有：token / verify / provision / session / cookie
  reason?: string,                        // fail 才有：機器可讀原因
}
```

**為何 `ok` 也要寫**：成功率 = ok ÷ (ok + fail)。只記錯誤永遠算不出分母，這正是現況的結構性缺陷。
`ok` 用 `severity='info'`，不會污染 deny-by-default 的 error/warn 偵測。

## 判定邏輯（純函式，全部可單測）

### 1. 分路徑成功率

```
tallyLoginOutcomes(logs) → { [route]: { ok, fail, attempts, successRate } }
evaluateLoginHealth(tally) → breaches[]
```

門檻（起步值，可調）：

| 條件 | 級別 | 理由 |
|---|---|---|
| `attempts >= 3` 且 `successRate === 0` | **critical** | 低流量路徑必須能觸發。本次故障 5 天 11 次全滅，此規則在第 3 次就會叫 |
| `attempts >= 10` 且 `successRate < 0.5` | warn | 部分使用者受影響 |
| `attempts === 0` | 不判定 | 沒人用不等於壞掉，避免半夜誤報 |

**關鍵設計**：`attempts === 0` 不告警，但 **`ok === 0 && fail >= 3` 一定告警**。這是本次故障能被抓到的直接原因。

### 2. deny-by-default 未知事件

```
KNOWN_BENIGN_EVENTS: ReadonlySet<string>   // 已知良性/已被其他規則涵蓋的事件
detectUnknownEvents(logs) → { event, count, sampleMessage }[]
```

規則：`severity ∈ {error, warn}` 且 `event ∉ KNOWN_BENIGN_EVENTS` → 列入告警。

**方向性是本設計的核心**：現況是「列舉要叫的」，改為「列舉不用叫的」。漏列一項的後果從「漏叫」變成「多叫一次」，且多叫一次就會被加進清單，系統會自我收斂。

初始 `KNOWN_BENIGN_EVENTS` 涵蓋日常高頻事件（`route.navigate`、`middleware.redirect.*` 等正常導向、`auth.resolved.snapshot`、`auth.session-cookie.seeded`），以及已被成功率規則涵蓋的 `auth.login.fail`（避免同一件事叫兩次）。

### 3. 既有四項規則保留

`tallyAuthHealthEvents` / `evaluateAuthHealth` 不刪除、不改行為，作為第三組規則並存。三組任一越界即告警。

## 排程

Vercel Hobby cron 上限 2 條已用滿（`cleanup-error-logs`、`alert-auth-health`），因此：

- **不新增 Vercel cron 條目**，改為擴充既有 `/api/cron/alert-auth-health` 端點的內容（同一支查詢、三組規則）。
- **GitHub Actions schedule 每小時**打同一支端點以提高頻率。端點已有 `CRON_SECRET` Bearer 保護，workflow 需設同名 repository secret。
- 查詢視窗：Vercel 每日觸發用 24h；GitHub Actions 每小時觸發用 **3h**（重疊容忍重複告警，寧可多叫）。視窗由 query 參數 `?hours=` 指定，預設 24。

**告警去重不做**：本變更寧可多叫。噪音收斂留待實際運行後依資料調整，不預先猜。

## Phase D：跨 channel 檢查的觀測模式

`line-exchange.post.ts:69` 的 `expectedChannelId = config.lineChannelId` 讀的是**未宣告於 runtimeConfig 的欄位** → 永遠 `undefined` → `&&` 短路 → 該防護從上線至今**一次都沒執行過**。

直接補宣告並 enforce 有兩重風險：① 立刻踩到 `4ce6071` 同款 destr 型別陷阱；② 若實際 `client_id` 與預期不符，會把 LIFF 主登入路徑整條砍掉。

因此採**兩段式**：

1. **本變更（觀測模式）**：補宣告 + 走 `configStr` + 比對不符時寫 `auth.login.channel-mismatch`（`severity='error'`，會被 deny-by-default 抓到）**但放行**。
2. **後續（enforce）**：prod 累積資料確認實際值後，改為擋下並回 `badRequestError`。一行 flag 切換。

Enforce 與否由 `LOGIN_CHANNEL_ENFORCE` 布林常數控制（程式碼常數，非 env——避免又多一個沒被驗證的環境變數）。

## 風險與對策

| 風險 | 對策 |
|---|---|
| deny-by-default 初期噪音 | 起始清單涵蓋已知高頻事件；告警訊息列出事件名與筆數，便於一次補齊清單 |
| 事件改名斷開歷史查詢 | 舊事件僅存在 5 天（保留期 7 天），影響極小；改名理由記於 memory 與本設計 |
| GitHub Actions secret 未設 | workflow 若無 secret 會失敗並在 Actions 頁面顯示紅——本身即為可見訊號；Vercel 每日 cron 仍獨立運作，不會失去覆蓋 |
| 觀測模式期間仍無實際防護 | 現況本來就沒有（死碼），觀測模式至少讓不符時**會告警**，嚴格優於現狀 |
