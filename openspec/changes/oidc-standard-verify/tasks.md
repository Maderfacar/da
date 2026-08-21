# OIDC Standard Verify — Tasks

> 慣例：`pnpm lint && pnpm test && pnpm build` 全綠才 commit + push origin main（直推 prod）。
> ⚠️ 本變更動的是登入熱路徑。合併後**必須實機驗一次手機瀏覽器登入**才算完成。

## ⚠️ 第一版事故與教訓（2026-08-22，已回滾 f2a15f7 後重做）

**發生什麼**：第一版寫死 `algorithms: ['ES256']` → 瀏覽器登入 100% 失敗、使用者卡在無限登入畫面。

**根因**：查了 LINE 的 discovery 端點，看到 `id_token_signing_alg_values_supported: ['ES256']`
就照著寫死。但官方文件（developers.line.biz/en/docs/line-login/verify-id-token/）明確區分：

| 用戶端型態 | 演算法 | 驗簽金鑰 |
|---|---|---|
| **web login（我們這條瀏覽器 OAuth 流程）** | **HS256** | **channel secret** |
| native app / LINE SDK / LIFF | ES256 | JWK 端點公鑰 |

discovery 宣告的 ES256 講的是後者，不是我們。

**三條教訓（都寫進程式碼，不是只寫註解）**：

1. **查錯了東西**。查了「文件怎麼描述」而非「實際是什麼」。決定性證據應該是**解開一枚
   真實 id_token 的 header**，而我從未做過。「我查證過」不等於「我查證了對的來源」。

2. **測試把我的假設當成事實**。第一版 21 個測試裡的 token 全是我自己用 ES256 簽的，因為
   我相信 LINE 用 ES256 —— 測試驗證的是「程式碼符合我的假設」，**結構上不可能證偽那個假設**，
   所以全綠然後上線就炸。
   → 現版 fixture 依官方文件記載的形狀建（**HS256 + channel secret 為主要案例**），
     並加一條斷言鎖住「必須同時支援兩種演算法」。

3. **不要賭在單一假設上**。現版**依 token 實際的 `alg` header 選金鑰**，兩條記載的路徑都支援；
   即使文件再錯一次也不會整條掛掉。演算法白名單仍嚴格限定這兩種（另有測試擋 RS256）。

**附帶修正**：第一版的錯誤訊息只寫「僅接受 ES256」，**沒寫實際收到什麼**，害排查得用推的。
現版失敗結果一律附 `observedAlg` 並寫進告警 metadata。
→ 通則：**錯誤訊息要說「實際看到什麼」，不能只說「我期望什麼」。**

**告警表現（唯一做對的事）**：
- 失敗原因列舉把定位時間從一小時多壓到 30 秒 —— log 直接寫 `reason:"signature"` +「演算法不被允許」
- 承諾 2 的成功率規則在 **第 4 次失敗** 就發出 critical（`browser-oauth 成功率 0% (0/4)`）。
  對照 2026-08-19 同樣的 100% 全滅，當時撐了 5 天、最後靠使用者回報。

## Phase A：驗證抽成純函式 + 測試

- [x] **A.0** OpenSpec change 四份 artifact
- [x] **A.1** `pnpm add jose`（直接相依）→ `pnpm build` 綠
- [x] **A.2** `server/utils/line-id-token.ts`
  - [x] `LINE_ISSUER` / `LINE_JWKS_URL` / **`LINE_ID_TOKEN_ALGS = ['HS256','ES256']`**
  - [x] **依 token 實際 alg 選金鑰**：HS256 → channel secret；ES256 → 遠端 JWKS
  - [x] 模組層 `createRemoteJWKSet`（跨 invocation 快取；JWKS 20 把金鑰輪替，需依 kid 自動刷新）
  - [x] `verifyLineIdToken({ idToken, channelId, channelSecret, nonce })` → 結構化結果
  - [x] `reason` 列舉（`fetch` / `signature` / `claims` / `nonce` / `internal`）+ `observedAlg`
- [x] **A.3** 單元測試 `server/utils/line-id-token.spec.ts`（25 個）
  - [x] 可注入 `keyResolver` 參數 —— 單測能以本地金鑰驗**完整流程**而不打網路
  - [x] **迴歸：HS256 + channel secret 必須通過**（2026-08-22 炸的就是這個）
  - [x] ES256 路徑；錯誤 secret / 錯誤公鑰 → signature
  - [x] `aud` / `iss` / `exp` 不符 → claims；nonce 不符 / 缺失 → nonce
  - [x] channelId 傳 number（destr 型別陷阱）→ 與字串版 `toEqual` 完全一致
  - [x] RS256 即使簽章有效也必須拒絕（演算法白名單）
  - [x] 失敗結果附 `observedAlg`、且不含 token 內容

## Phase B：接線

- [x] **B.1** `callback.get.ts` 改用 `verifyLineIdToken`（傳入 channelSecret），移除 `LINE_VERIFY_URL`
- [x] **B.2** 失敗埋點沿用 `auth.login.fail`，`stage='verify'`、`reason` 列舉、metadata 帶 `observedAlg`
- [x] **B.3** `configStr` 仍套用於 channelId（承諾 1 的靜態掃描強制）
- [x] **B.4** lint 乾淨 / 870 tests 綠 / build 綠 → commit + push

## 驗收（Brain AI）

- [ ] **V.0** 先確認回滾版已恢復登入（基準線）—— 未確認前不推第二版
- [ ] **V.1** ⚠️ **手機瀏覽器無痕實機登入一次** —— 唯一的真實驗收
- [ ] **V.2** LINE 內（LIFF）開一次，確認未受影響
- [ ] **V.3** prod log 出現 `auth.login.ok` + `route='browser-oauth'`，且 `alg` 應為 `HS256`

## 回滾

單一 commit、範圍限於驗證那一段。異常時 `git revert` 即回到呼叫 LINE `/verify` 端點的版本
（該版本 2026-08-20 05:22 實測可用）。成功率告警在 3 次失敗內發出 critical。
