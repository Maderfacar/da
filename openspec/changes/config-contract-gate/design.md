# Config Contract Gate — Design

## 為什麼契約檔是 `.mjs` 而不是 `.ts`

build gate 必須在 **Nuxt 編譯之前**執行（編譯後才發現設定錯誤就失去意義），因此只能是純 node
可直接執行的檔案。同時執行期健檢端點也要用同一份契約——**兩份契約會漂移，而契約漂移正是這類
bug 的來源**。`.mjs` + JSDoc 型別是唯一能同時滿足兩邊、且不需要編譯步驟的形式。

放在 `shared/` 而非 `scripts/`：它是前後端共用的規格，不是工具腳本。

## 三道關卡的分工

```
build gate（部署前）          執行期健檢（部署後）         CI 定時（每小時）
─────────────────────        ─────────────────────       ─────────────────
格式錯誤          硬擋        實際 runtimeConfig 型別      呼叫健檢端點
核心必要缺失      硬擋        prod 究竟設了什麼            有 error → workflow 紅
destr 靜態掃描    硬擋        （build 期看不到）           偵測設定漂移
非核心缺失        警告
```

**build 期看不到 destr 之後的樣子**：`process.env` 永遠是字串。要驗「注入 runtimeConfig 之後
是不是還是字串」只能在執行期做——這正是健檢端點存在的理由，不是重複建設。

## destr 靜態掃描的判準

對每個 `kind === 'numeric-id'` 的契約（channel id、sender id 等純數字但語意是字串者）：

```
掃描 server/**/*.ts、app/**/*.{ts,vue}
找出 config.<key> / runtimeConfig.<key> 的讀取
該行未包含 configStr( → 硬擋，並指出檔案與行號
```

行級啟發式（本專案風格中設定讀取都在同一行）。誤判的後果是 build 紅 + 明確訊息，
把讀取包成 `configStr()` 即可解除——**誤判方向是安全的**。

已知豁免：`shared/env-contract.mjs` 與 `scripts/check-env-contract.mjs` 自身（它們談論這些 key 而非讀取）。

## required 的定線與風險

**風險**：把某項標為必要、而它其實沒設在 prod（但站台照常運作）→ 下一次部署直接失敗。

**證據限制**：`.env.dev` 只有 23 個 key，缺 P29 雙 channel 那組（`NUXT_LINE_CHANNEL_SECRET_PASSENGER`
等）、`CRON_SECRET`、`NUXT_PUBLIC_SITE_URL` 等。P29 已上線運作，代表 prod 一定有這些值——
**所以 `.env.dev` 缺少某項不能推論 prod 也缺**，反之亦然。既然無法查證，就不猜。

**定線規則**：只有「缺了站台本來就是壞的」才標 `required`，其餘一律 `recommended`（警告不擋）。

| 項目 | 判定 | 理由 |
|---|---|---|
| `NUXT_FIREBASE_SERVICE_ACCOUNT_JSON` | required | 缺了所有 server 端功能皆不可用 |
| `NUXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,APP_ID}` | required | 缺了 client 端完全無法認證 |
| `NUXT_LINE_LOGIN_CHANNEL_{ID,SECRET}` | required | 缺了瀏覽器登入整條死 |
| `NUXT_PUBLIC_LINE_LIFF_ID_{PASSENGER,DRIVER}` | required | 缺了 LIFF 進站死 |
| `NUXT_GOOGLE_MAPS_API_KEY` | required | 缺了訂車流程算不出路線 |
| `NUXT_TOTP_ENC_KEY` | required | 缺了 admin 2FA 無法解密，後台全鎖 |
| P29 雙 channel、`CRON_SECRET`、`NUXT_LINE_CHANNEL_ID`、其餘 API key | recommended | 無法查證 prod 狀態；由健檢端點回報後再升級 |

以上 required 項目若真的缺失，站台現在就是壞的——**硬擋它們不可能擋掉一個本來正常的部署**。

## 健檢端點的輸出形狀

```
{ ok, checkedAt, issues: [{ env, path, level, kind, problem }], summary: { error, warn, ok } }
```

`problem` 為列舉（`missing` / `format` / `type-hazard`），**不含實際值**。設定值多為憑證，
端點雖有 Bearer 保護，仍不放值——一旦保護失效，洩漏的是憑證本身。

## 為什麼不做啟動時 crash

Nitro plugin 在啟動時 throw 會讓整站 500，包含不需要那項設定的公開行銷頁。
一個設定錯誤造成全站不可用，比原問題更糟。擋在部署前（build gate）+ 部署後回報（健檢端點）
已完整覆蓋「設定寫錯的上不了線」，且失效模式安全得多。
