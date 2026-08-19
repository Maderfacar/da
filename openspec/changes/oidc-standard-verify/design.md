# OIDC Standard Verify — Design

## 現況與目標的差異

```
現況：  code ──token 端點──> id_token ──/verify 端點──> { sub, name, picture, iss, aud }
                                                          ↓
                                        自己寫：iss !== ... || aud !== channelId   ← 2026-08-19 炸點

目標：  code ──token 端點──> id_token ──jose 本地驗簽（JWKS）──> payload
                                        簽章 / iss / aud / exp 由函式庫驗
                                        只剩 nonce 一個自寫比對（兩端皆源自我方 Firestore）
```

## 為什麼 JWKS 一定要用 `createRemoteJWKSet`

實測 LINE 的 JWKS 端點目前有 **20 把 EC/P-256 金鑰**，代表金鑰處於輪替狀態。若自行抓一次快取起來，
輪替後遇到未知 `kid` 就會全面驗證失敗——那正是「低流量路徑 100% 失效」的再一次翻版。

`createRemoteJWKSet` 的行為正是需要的：依 `kid` 查找、未命中時自動重抓（內建 cooldown 防打爆），
並在模組層跨 invocation 快取。放模組層而非 handler 內，warm lambda 才不會每次重建。

## 失敗原因必須可區分

今晚查這顆 bug 的一半成本，來自「verify 端點打不通」與「payload 不符」被寫成同一句話。
新的 `verifyLineIdToken` 回傳的 `reason` 是列舉，直接餵進既有的 `auth.login.fail` metadata：

| reason | 意義 | 可能原因 |
|---|---|---|
| `fetch` | JWKS 取不到 | LINE 端異常、網路、冷啟逾時 |
| `signature` | 簽章驗證失敗 | 金鑰輪替未追上、token 遭竄改 |
| `claims` | iss / aud / exp 不符 | **設定錯（如 channel id 型別/值錯）** |
| `nonce` | nonce 不符 | replay、state 錯配 |

`claims` 正是今晚那顆會落在的分類——下次同類問題，log 直接指出方向，不必再讀原始碼推。

## 型別陷阱的雙重保險

`audience` 參數若傳入 number（destr 型別陷阱），`jose` 的比對行為不見得等同我們的預期。
因此：

1. `callback.get.ts` 仍以 `configStr(config.lineLoginChannelId)` 讀取（承諾 1 的靜態掃描強制此事）
2. `verifyLineIdToken` 內部再做一次 `String(channelId)` 正規化，並以測試釘死「傳 number 進來也不得靜默通過」

單一防線失效時仍有第二道，而且兩道都有測試守著。

## 為什麼不順便換 `openid-client`

`openid-client` 會接管 discovery、授權 URL 組裝、token 交換與驗證。我們用不到的部分（多 provider、
動態 discovery、PKCE 協商）佔了它大部分的價值，而它會重寫**今晚才剛穩定下來的整條登入路徑**。

本變更只換掉「驗證」這一段——那正是出過事的那一段，也是收益最集中的那一段。
state / nonce 的 Firestore 一次性設計是 CSRF 防護核心且運作正常，不在範圍內。

## 風險與對策

| 風險 | 對策 |
|---|---|
| 冷啟時多一次 JWKS 取得 | 同時移除了 verify 端點呼叫，網路往返淨減少 |
| JWKS 取不到導致登入失敗 | 現況 verify 端點打不通同樣會失敗，風險等價；且 `reason='fetch'` 可區分 |
| 驗證邏輯改動導致登入全滅 | 成功率告警（3 次失敗即 critical）已在線上；單一 commit 可直接 revert |
| `jose` 與 firebase-admin 的傳遞相依版本不同 | pnpm 隔離安裝，可並存；為安全關鍵路徑，直接相依取用當前穩定 major，不遷就傳遞版本 |
