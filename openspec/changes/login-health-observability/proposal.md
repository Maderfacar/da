# Login Health Observability — 讓登入壞掉時系統先叫（承諾 2）

> Brain AI（架構師）2026-08-20 裁示：三條承諾中**先做承諾 2**，並將 `line-exchange` 跨 channel 死檢查一併修。
> 交付形態：**4 個 Phase（A 埋點 / B 判定 / C 排程 / D 地雷）**，A→B→C 有嚴格相依，D 可獨立上 prod、可獨立 rollback。

## Why

2026-08-19 手機瀏覽器 LINE 登入 100% 失敗（`4ce6071` 已修根因）。但真正的問題不是那顆 bug，是它**躲了 5 天、最後由使用者回報**：

1. **告警是 allow-list**。[auth-health-alert.ts](../../../server/utils/auth-health-alert.ts) 用 `switch` 列舉四個事件名，其餘 `default: break` 略過。四個名字全是 2026-08-01「看似登出」那次事故的症狀。`auth.line-login.callback.fail` 是後來才加的埋點，**不在名單裡** → 11 筆連續失敗在告警系統眼中是 `0`，cron 每天照跑照回報健康。
2. **沒有任何一個指標是成功率**。四個門檻全是「錯誤筆數 ≥ N」（3–5 筆）。手機瀏覽器登入 5 天只有 11 次嘗試，**100% 全滅卻永遠打不到筆數門檻**。低流量路徑徹底壞掉在筆數型監控下是結構性隱形的——而新上線的入口恰好流量最低。
3. **LIFF 主登入路徑零埋點**。[line-exchange.post.ts](../../../server/routes/nuxt-api/auth/line-exchange.post.ts) 全檔沒有任何 `writeAuthErrorLog` 呼叫。它是三端最大宗的登入入口，**目前無法計算成功率，因為根本沒有資料**。

**根因一句話：偵測層採白名單制，只認得已經發生過的故障；每修一次事故就加一個事件名進名單，於是下一個新故障的偵測值永遠是零。**

歷史佐證：2026-05-01 起 146 個 auth commit、33 個 fix、18 個日期。「開機時序 / 導向守衛 / session-token」三類已真的關閉，但**每次根治新蓋的東西又打開一個沒有防線的新類別**——本次是「外部整合設定」，由上一輪根治新蓋的 server OAuth 路徑帶進來。

## What Changes

### 終態：從「列舉已知錯誤」翻轉為「盯成功率 + 沒見過的也要叫」

- **成功率為第一指標**：每條登入路徑（`liff` / `browser-oauth`）各自統計 `ok` vs `fail`。成功率 0（且達最小樣本）→ **critical 立即告警**，完全不看筆數門檻。
- **deny-by-default**：非「已知良性事件」清單內、且 `severity` 為 `error`/`warn` 的事件型別出現 → 告警。方向與現況相反：漏掉一項只會多叫一次，**不會少叫一次**。
- **埋點統一**：兩條登入路徑都寫同一組事件（`auth.login.ok` / `auth.login.fail`）+ `metadata.route`，成功率才可計算。

### 已鎖定的決策（不需再拍板）

| 項目 | 決策 | 理由 |
|------|------|------|
| 登入結果事件 | 統一 `auth.login.ok` / `auth.login.fail`，`metadata.route` 區分路徑 | 成功率需要同一組事件；舊 `auth.line-login.callback.*` 改名收斂，歷史查詢斷點記於 memory |
| 成功率門檻 | `attempts >= 3` 且 `successRate === 0` → critical；`attempts >= 10` 且 `< 50%` → warn | 低流量路徑必須能觸發；3 次全滅已足夠確信 |
| deny-by-default 清單 | 維護「已知良性事件」白名單（反向），非清單內的 error/warn 事件即告警 | 漏列只會多叫，不會漏叫 |
| 排程 | **擴充既有 `/api/cron/alert-auth-health` 端點內容**，不新增 Vercel cron 條目 | Vercel Hobby cron 上限 2 條已用滿 |
| 提高頻率 | GitHub Actions schedule 每小時打同一端點 | 免費、無條數限制，專案已有 workflow 基礎 |
| 通報管道 | 沿用既有 `notifyAdmins` | 不新增基礎設施 |
| 跨 channel 檢查 | **先觀測模式**（不符只記錄 + 告警，不擋），prod 資料確認後才翻 enforce | 直接 enforce 有砍掉 LIFF 主登入路徑的風險 |

### 驗收標準（唯一的成敗判準）

> **把 2026-08-15 那次故障重播一次，系統必須在當天發出告警，而不是等到 8/19 由使用者回報。**

## Non-goals

- **不做真登入 canary**：需存放真實 LINE 測試帳號憑證，且 OAuth 同意頁自動化極度脆弱，會變成經常紅、然後被忽略的測試——比沒有更糟。改由「設定不變量健檢（承諾 1）」+「成功率告警（本變更）」覆蓋。
- **不做承諾 1（設定啟動時驗證）與承諾 3（換標準 OIDC 函式庫）**：Brain AI 裁示順序為 2 → 1 → 3，本變更只做 2。
- **不改登入流程本身**：本變更對登入行為零影響，只加觀測與告警（D 的觀測模式亦然）。
