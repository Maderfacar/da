# Config Contract Gate — Tasks

> 慣例：跑 `pnpm lint && pnpm test && pnpm build` 全綠才 commit + push origin main（直推 prod）。

## Phase A：契約與純函式驗證

- [x] **A.0** OpenSpec change 四份 artifact ✅ 本次
- [x] **A.1** `shared/env-contract.mjs`（新）
  - [x] `ENV_CONTRACTS` — 每項含 `env` / `path` / `kind` / `importance` / `pattern` / `note`
  - [x] `kind`：`json` / `numeric-id` / `hex64` / `url` / `secret` / `text`
  - [x] `validateEnvValues(env)` → `EnvIssue[]`（缺失 + 格式，純函式）
  - [x] `DESTR_HAZARD_CONTRACTS` — `kind === 'numeric-id'` 者，供靜態掃描與執行期檢查共用
  - [x] `validateRuntimeConfigTypes(config)` → 執行期檢查實際型別（build 期看不到 destr 後的樣子）
- [x] **A.2** 單元測試 `shared/env-contract.spec.ts`
  - [x] **迴歸**：`NUXT_LINE_LOGIN_CHANNEL_ID` 經 destr 變成 number → `validateRuntimeConfigTypes` 必須回報
  - [x] 必要缺失 / 格式錯誤 / 正常值三種情境
  - [x] 契約本身自檢：`env` 不重複、`path` 不重複

## Phase B：build gate

- [x] **B.1** `scripts/check-env-contract.mjs`（新）
  - [x] 環境值來源：Vercel（`process.env`）／本機（合併 `.env.dev`，不存在則印提示並放行，不擋新 clone）
  - [x] 硬擋：格式錯誤、核心必要缺失
  - [x] 警告不擋：非核心缺失（`.env.dev` 非 prod 可靠鏡像，見 proposal）
  - [x] **靜態掃描**：`numeric-id` 設定凡直接 `config.<key>` 讀取而未經 `configStr()` 包裹 → 硬擋
  - [x] 輸出只印設定名稱與問題，**永不印值**
- [x] **B.2** `package.json` — `build` 前置執行 gate
- [x] **B.3** 反向驗證（三項皆實測通過）：格式改壞 → 紅；核心設定刪除 → 紅；拿掉 `configStr()` → 紅；還原 → 綠
- [x] **B.4** gate 首次執行即命中一顆真實同類危害：`app/stores/5.store-auth.ts` 把 `firebaseMessagingSenderId`（純數字，destr 後為 number）直接餵給 Firebase `initializeApp`，而 `FirebaseOptions` 要求 string。已修
- [x] **B.5** `configStr` 由 `server/utils/` 移至 `shared/config-str.ts` —— client 端（store）也需要它；`server/utils/runtime-config.ts` 保留為轉出入口，既有 import 不受影響

## Phase C：執行期健檢端點

- [x] **C.1** `server/routes/nuxt-api/_health/config.get.ts`（新）
  - [x] `CRON_SECRET` Bearer 保護（與 cron 端點同範式）
  - [x] 跑 `validateEnvValues` + `validateRuntimeConfigTypes` 於**實際 runtimeConfig**
  - [x] 回傳只含名稱 / 狀態 / 問題種類，**永不回值**
- [x] **C.2** `.github/workflows/login-health.yml` 加一步呼叫健檢端點，有 error 則 workflow 紅
- [x] **C.3** lint / test / build 全綠 → commit + push

## 驗收（Brain AI）

- [x] **V.1** ✅ 已完成：workflow 手動觸發 success（9s），健檢回報 error=0 / warn=3（全為 type-hazard）
- [x] **V.2** ✅ 已完成：健檢端點回報 prod 缺項 = 0 → 10 項 `recommended` 全數升級為 `required`（共 21 項）。
  同時把「必要項缺失」的硬擋範圍收斂為**僅 production build**（Vercel Preview 與本機降級為警告，
  因 .env.dev 合理地不含 prod 專屬機密）；格式錯誤與 destr 靜態掃描不受影響，任何環境都硬擋。
- [x] **V.3** ✅ 已完成：Brain AI 已設定，跨 channel 檢查進入觀測模式運作中

## 2026-08-22 持續驗證

- [x] prod 設定實況仍為 `ok:true` / error 0 / warn 3（三個 destr type-hazard，讀取端均已走
  `configStr`，屬設計預期）。曾缺的 `CRON_SECRET` / `NUXT_LINE_CHANNEL_ID` /
  `NUXT_PUBLIC_SITE_URL` 全部已設。
- [x] 每小時漂移偵測連續 46 次綠（僅 08-19 最早 3 次紅＝設 secret 之前）。
- [x] **查法（可複用，不需 CRON_SECRET）**：健檢端點要 Bearer，但 workflow 第二步會把完整回應
  印進 Actions log（回應刻意不含值，可安全外印）：
  `gh run view <id> --log | grep -o '{"data".*}' | tail -1`。
  逐一回翻不同時間的 run，還能**回推某個環境變數是何時被設進去的** —— 本次即靠此把跨 channel
  防護的生效起點釘在 ≤ 2026-08-19T23:33Z。
- [x] **type-hazard 的第二個用途（本次才發現）**：它同時是「該值存在」的證明（只有值存在且被
  destr 轉型才會產生），因此可用來證明「設定為空就靜默短路」型的防護確實在執行。
  `login-health-observability` 的 V.4 即以此為翻開強制模式的第一依據。
- [x] 另一個副產物：`_health/config` 未設 secret 回 **503**、設了但憑證錯回 **401**
  ⇒ 無憑證 curl 的回應碼即可判斷 secret 有沒有設，不必知道值。

> **archive 前提未變**：「設定寫錯擋下部署」至今只在模擬中驗證過，尚未在真實 Vercel
> production build 觸發。上述皆為「gate 通過」的證據，不是「gate 會擋」的證據。

## 留待後續

- 承諾 3：登入驗證改用標準 OIDC 函式庫，縮小手寫面積 —— ✅ 已完成（change `oidc-standard-verify`）
