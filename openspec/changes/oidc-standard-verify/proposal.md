# OIDC Standard Verify — 縮小手寫驗證面積（承諾 3）

> 承諾順序 2 → 1 → 3。承諾 2（`login-health-observability`）與承諾 1（`config-contract-gate`）
> 皆已上 prod，偵測與設定防線就位，本變更為最後一項。

## Why

2026-08-19 手機瀏覽器登入 100% 失敗，炸點是**我們自己寫的那一行比對**：

```ts
if (!verified?.sub || verified.iss !== 'https://access.line.me' || verified.aud !== channelId)
```

根因雖是型別（destr 把 channel id 轉成 number），但更上一層的問題是：**id_token 的驗證是手刻的**。
專案的相依清單裡沒有任何 OIDC / JWT 函式庫，token 交換、驗證、簽發者與對象比對每一步都是自己寫的。
自己寫的每一行，就是自己可能寫錯的一行——承諾 1 的靜態掃描能擋住「同一種」錯誤，但擋不住下一種。

現況還有兩個次要缺點：

1. **驗證依賴一次額外網路往返**：呼叫 LINE 的 `/oauth2/v2.1/verify` 端點代驗，登入熱路徑多一次外部相依。
2. **沒有真正驗簽**：我們信任 verify 端點的回應，而不是自己驗證 id_token 的簽章。

## What Changes

用 `jose` 在本地驗證 id_token，取代「呼叫 verify 端點 + 自己比對 aud/iss」。

已查證的 LINE OIDC 事實（取自 discovery 與 JWKS，非推測）：

| 項目 | 值 |
|---|---|
| issuer | `https://access.line.me` |
| jwks_uri | `https://api.line.me/oauth2/v2.1/certs` |
| id_token 簽章演算法 | **僅 `ES256`** |
| JWKS 金鑰數 | 20 把（EC / P-256）→ **金鑰會輪替** |

一次呼叫完成簽章 + `iss` + `aud` + `exp` 驗證：

```ts
const { payload } = await jwtVerify(idToken, LINE_JWKS, {
  issuer: 'https://access.line.me',
  audience: channelId,
  algorithms: ['ES256'],
});
```

`aud` / `iss` 的比對由函式庫負責，**今晚那行程式碼不再存在**。

### 已鎖定的決策

| 項目 | 決策 | 理由 |
|------|------|------|
| 函式庫 | `jose`（直接相依，非沿用 firebase-admin 的傳遞相依） | 傳遞相依會隨上游改版消失；驗證是安全關鍵路徑，必須自己聲明 |
| 範圍 | **只換驗證那一段** | state / nonce 的 Firestore 一次性設計是好的，且與 CSRF 防護綁定，不動 |
| 不採 `openid-client` | 完整 OIDC client 會重寫剛穩定下來的整條登入路徑，多出來的能力（discovery / 多 provider / PKCE 協商）我們用不到 | 風險與價值不成比例 |
| JWKS 取得 | `createRemoteJWKSet`（模組層建立，跨 invocation 快取） | 20 把金鑰在輪替，必須能依 `kid` 查找並在未知 kid 時自動刷新；自行抓一次存著會在輪替後全面失效 |
| nonce | 仍自行比對（`payload.nonce === nonce`） | jose 不驗 nonce。但兩邊的值都源自我方 Firestore state，無外部型別風險 |
| 網路往返 | 淨減少一次 | 移除 verify 端點呼叫，新增 JWKS 取得（冷啟一次，之後快取） |

### 驗收標準

> **登入行為完全不變**（三端皆可登入），而 `aud` / `iss` 的手寫比對從程式碼中消失。
> 故意傳入 aud 不符的 id_token 時，驗證必須失敗。

## Non-goals

- **不改 state / nonce 機制**：Firestore 一次性消費的設計是 CSRF 防護核心，運作正常。
- **不改 LIFF 路徑（`line-exchange`）**：它驗的是 access token 而非 id_token，不適用 JWT 驗簽。
- **不引入 `openid-client` 或改寫授權流程**：見上方決策表。
