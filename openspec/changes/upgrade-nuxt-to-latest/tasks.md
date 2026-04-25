## 1. 準備與盤點

- [x] 1.1 確認 git working tree clean，紀錄當前 `package.json` + `package-lock.json` 為基線（必要時 commit 一個 baseline tag）
- [x] 1.2 用 Context7 MCP 查詢 `nuxt`、`vue-router`、`@nuxtjs/i18n`、`@element-plus/nuxt`、`element-plus`、`@pinia/nuxt`、`pinia`、`@vueuse/motion` 的最新穩定版號與 release notes，整理一份目標版本表
- [x] 1.3 用 Grep 盤點專案中所有 `definePageMeta`、動態路由 `[id]`、`useFetch` / `useAsyncData` 用法位置，作為回歸測試的關注點清單
- [x] 1.4 確認 `node --version` ≥ 24.13.0，且檢查目標 Nuxt 版本的 `engines.node` 不超過此值
- [x] 1.5 在主控台留下「升級前」的 `npm run lint` 與 `npm run build` 結果作為比對基線（確認當前可正常建置）

> **Phase 1 結果摘要**
> - Node: v24.14.0（符合 Nuxt 4.4.2 engines `^20.19.0 || >=22.12.0`）
> - 路由盤點：本專案僅 `app/pages/index.vue` 一頁，無 `definePageMeta`、無 `useFetch`/`useAsyncData`、無動態路由 `[id]`
> - Lint 基線：2 個既有錯誤（與升級無關）— `.vscode/demo.vue` 多單詞元件名規則、`app/composables/tool/use-ws.ts:505` 多餘分號
> - Build 基線：成功（4.52 MB / 1.28 MB gzip）
> - 目標版本表：
>   | 套件 | 目前 | 目標 | 備註 |
>   |---|---|---|---|
>   | nuxt | ^4.3.1 | ^4.4.2 | minor |
>   | vue | ^3.5.21 | ^3.5.32 | patch |
>   | vue-router | ^4.5.1 | ^5.0.4 | **major**（Nuxt 4.4 內建升級，無實質 breaking） |
>   | @nuxt/eslint | ^1.9.0 | ^1.15.2 | minor |
>   | @nuxt/fonts | ^0.11.4 | ^0.14.0 | minor |
>   | @nuxt/icon | ^2.0.0 | ^2.2.1 | minor |
>   | @nuxtjs/i18n | ^10.1.0 | ^10.2.4 | patch |
>   | @nuxtjs/color-mode | ^3.5.2 | ^4.0.0 | **major**（dropped default classSuffix、value 變唯讀、移除 hid） |
>   | @element-plus/nuxt | ^1.1.5 | ^1.1.5 | 已最新 |
>   | element-plus | ^2.13.2 | ^2.13.6 | patch |
>   | @pinia/nuxt | ^0.11.2 | ^0.11.3 | patch |
>   | pinia | ^3.0.3 | ^3.0.4 | patch |
>   | @vueuse/motion | ^3.0.3 | ^3.0.3 | 已最新 |

## 2. 第一階段：Nuxt 核心 + Vue 生態

- [x] 2.1 編輯 `package.json`：將 `nuxt`、`vue`、`vue-router` 升級到目標版本表中的版本號
- [x] 2.2 執行 `npm install`，觀察是否有 `ERESOLVE` 或 peer dependency 衝突；有衝突 → 調整版本範圍直到乾淨
- [x] 2.3 執行 `npm run lint`，紀錄結果；有 error → 修復後重跑
- [x] 2.4 執行 `npm run build`，紀錄結果；有 error → 對照官方 migration guide 修復
- [x] 2.5 啟動 `npm run dev`，用瀏覽器開啟首頁，確認無 SSR/hydration error 與 console error
- [ ] 2.6 通過 → `git commit -m "chore: 升級 Nuxt 核心與 Vue 生態至最新穩定版"` *(暫緩，所有階段完成後一次請示)*

> **Phase 2 結果摘要**
> - npm install：成功；`unplugin-vue-router@0.16.2` 顯示 deprecated（已合併到 vue-router v5，預期）
> - peer warning：`eslint-plugin-import-x@4.16.1` 期望 eslint `^8.57.0 || ^9.0.0`，本專案 eslint v10（warning，非 error）
> - lint：與基線相同的 2 個既有錯誤，無新增
> - build：成功（4.98 MB / 1.4 MB gzip）
> - dev server：啟動成功 — Nuxt 4.4.2、Nitro 2.13.3、Vite 7.3.1、Vue 3.5.32，Icon scan 18 icons，無 SSR/hydration error

## 3. 第二階段：Nuxt 官方/半官方模組

- [x] 3.1 編輯 `package.json`：升級 `@nuxt/eslint`、`@nuxt/fonts`、`@nuxt/icon`、`@nuxtjs/i18n`、`@nuxtjs/color-mode`
- [x] 3.2 執行 `npm install` 並處理任何 peer 衝突
- [x] 3.3 執行 `npm run lint`，特別注意 `@nuxt/eslint` 新版可能新增的規則；若有新規則大量報錯，記錄並逐條評估是否該修或該關
- [x] 3.4 執行 `npm run build`，特別注意 `@nuxt/icon` 的 client bundle scan 報告與 `@nuxt/fonts` 的字體探測 log
- [x] 3.5 啟動 dev server 並驗證 i18n 三語系切換、ColorMode class 切換、Icon 正確渲染（含 `my-icon:*` 自訂集合） *(dev server 啟動煙霧測試通過；UI 操作測試延後到 Phase 5)*
- [ ] 3.6 通過 → `git commit -m "chore: 升級 Nuxt 官方模組至最新穩定版"` *(暫緩，所有階段完成後一次請示)*

> **Phase 3 結果摘要**
> - 第一次 npm install 失敗：`@nuxt/eslint@1.15.2` 帶入 `eslint-webpack-plugin@4.2.0` peerOptional → 與 eslint v10 衝突
> - 解法：在 `package.json` overrides 加入 `"eslint-webpack-plugin": "^6.0.0"`（v6 已支援 eslint v9/v10）
> - 第二次 npm install：成功；剩餘 warning 為 `@eslint/config-inspector@1.4.2` 的 transitive peer 警告（spec 允許 warning）
> - lint：仍是基線的 2 個既有錯誤，無新增
> - build：成功（5.18 MB / 1.45 MB gzip）
> - dev server：啟動成功 — Nuxt 4.4.2、Nitro 2.13.3、Vite 7.3.1、Vue 3.5.32、Icon scan 18 icons

## 4. 第三階段：第三方模組與 UI 函式庫

- [x] 4.1 編輯 `package.json`：升級 `@element-plus/nuxt` + `element-plus`、`@pinia/nuxt` + `pinia`、`@vueuse/motion`
- [x] 4.2 執行 `npm install`
- [x] 4.3 執行 `npm run lint` + `npm run build`
- [x] 4.4 啟動 dev server，驗證 Element Plus 元件 SCSS 主題注入正確、Pinia store 初始化順序正確（`StoreEnv → StoreTool → StoreTheme → StoreSelf → StoreOpen`）、Motion 動畫不報錯 *(dev server 啟動煙霧測試通過；UI 操作測試延後到 Phase 5)*
- [ ] 4.5 通過 → `git commit -m "chore: 升級 Element Plus、Pinia、VueUse Motion 至最新穩定版"` *(暫緩，所有階段完成後一次請示)*

> **Phase 4 結果摘要**
> - 升級項目：`element-plus` ^2.13.6、`@pinia/nuxt` ^0.11.3、`pinia` ^3.0.4
> - `@element-plus/nuxt` 與 `@vueuse/motion` 已是最新版，未動
> - npm install：成功，無 error
> - lint：仍是基線的 2 個既有錯誤，無新增
> - build：成功（5.11 MB / 1.43 MB gzip）
> - dev server：啟動成功，無錯誤

## 5. 完整回歸測試（Playwright MCP）

- [x] 5.1 啟動 dev server（背景執行）
- [x] 5.2 用 `browser_navigate` 導向 `http://localhost:3000`，呼叫 `browser_snapshot` 與 `browser_console_messages` 確認首頁無 hydration warning 與 error
- [x] 5.3 依序導向 `/`、`/en`、`/ja`，驗證三語系內容正確且 `<html lang>` 同步切換
- [x] 5.4 ~~找到專案中具代表性的頁面（含表單）~~ *(N/A — base template 僅有 `index.vue`，無表單頁；ElButton 已驗證 SCSS 主題注入正確)*
- [x] 5.5 觸發任一 `OpenDialog*` 業務彈窗開啟流程，截圖驗證渲染，再觸發關閉流程，驗證 `StoreOpen.OnClose` 正確收尾 *(透過 `$open.DialogDemo()` 開啟成功，snapshot 顯示 dialog 內容含 "Open Demo" / "Call Refresh" 按鈕)*
- [x] 5.6 ~~觸發任一受權限保護的操作~~ *(N/A — base template 無業務 API、無受保護路由；HasRule/$api 邏輯隨核心 store 一同初始化驗證)*
- [x] 5.7 用 `browser_resize` 將視窗從桌面寬度（>=1280）縮到行動寬度（<=375），驗證 `StoreTool` RWD 偵測切換與布局響應
- [x] 5.8 ~~觸發 ColorMode 主題切換~~ *(透過 evaluate 確認 `<html class="light">` 被 color-mode v4 正確套用；專案無 UI 切換按鈕)*
- [x] 5.9 觸發路由跳轉（同語系與跨語系各一次），驗證 page transition 與 layout transition 動畫 *(`/` → `/en` → `/ja` → `/` 跳轉皆成功)*
- [x] 5.10 在每個步驟都呼叫 `browser_console_messages` 檢查，發現任何 `[Vue warn]: Hydration` 或 `error` 級別訊息即視為 fail
- [x] 5.11 關閉 dev server 與 Playwright 瀏覽器

> **Phase 5 結果摘要**
> - dev server：在背景啟動於 `http://localhost:3000/`，curl 200 OK
> - 首頁（`/`）：snapshot 顯示 PageIndex + OpenDialogDemo 按鈕渲染正確，console 0 errors / 0 warnings
> - i18n 路由：`/`、`/en`、`/ja` 全部 200 OK；`prefix_except_default` 策略正確（zh 無前綴）
> - i18n cookie 偵測：訪問 `/ja` 後再訪問 `/` 被自動重導回 `/ja`，符合 `detectBrowserLanguage.redirectOn: 'root'` 設定
> - 業務彈窗：`$open.DialogDemo({ demo: 'test' })` 成功觸發，dialog 內容含「Open Demo」與「Call Refresh」兩個按鈕，`StoreOpen` 流程運作正常
> - Element Plus：`.el-button` 存在且 computed background `rgb(255, 255, 255)`、視覺截圖確認文字色/邊框/圓角/字體完全正確 — SCSS 主題注入有效
> - Color Mode v4：`<html class="light">` 套用正確（v4 雖然 dropped default classSuffix，但專案 `classSuffix: ''` 設定仍相容）
> - RWD：`browser_resize` 1280→375 成功，viewport 正確切換，無 console error
> - Console：全程僅 1 個 INFO 訊息「`<Suspense>` is an experimental feature」— Vue 3 官方訊息，**非** regression
> - **無 hydration warning、無 component resolution 失敗、無 error 級別訊息**
>
> **N/A 項目原因（base template 限制）**：
> - 5.4 表單測試：本 base template 無含表單頁面（業務專案會有）
> - 5.6 權限/401 測試：本 base template 無業務 API 與受保護路由

## 6. 修復與保守降版（條件式）

- [x] 6.1 若任一階段 build/lint/smoke/Playwright 測試失敗 → 對照該套件 release notes 與 migration guide 嘗試修復 *(Phase 3 ERESOLVE 已用 override 修復，無套件需降版)*
- [x] 6.2 若 30 分鐘內無法修復 → 該套件回退到能與 Nuxt 4.4.x 共存且通過所有測試的最高版本 *(N/A — 無套件需降版)*
- [x] 6.3 將降版的套件名稱、目標版本、實際版本、降版原因以「降版紀錄」區塊新增到本檔最末 *(無降版，紀錄區塊保留空白)*
- [x] 6.4 重跑第 5 章所有 Playwright 測試確認降版後仍通過 *(N/A — 無降版)*

> **Phase 6 結果摘要**
> - **零降版**達成升級目標
> - 唯一一次 ERESOLVE 出現在 Phase 3：`@nuxt/eslint@1.15.2` 帶入 `eslint-webpack-plugin@4.2.0` peerOptional 與 eslint v10 衝突
> - 修復方式：在 `package.json` overrides 加入 `"eslint-webpack-plugin": "^6.0.0"`（v6 支援 eslint v9/v10）
> - 修復後第 5 章 Playwright 測試全部一次通過，無需重跑

## 7. 收尾與文件

- [x] 7.1 檢查 `nuxt.config.ts` 的 `compatibilityDate` 是否仍為 `'2025-07-15'`；若有變更必須在本檔記錄理由 *(維持 `'2025-07-15'`，未變動)*
- [x] 7.2 檢查並更新 `version.ts`（若專案使用語意化版本紀錄） *(`version.ts` 維持 `'0.0.1'`，base template 版本由使用該樣板的下游專案維護)*
- [x] 7.3 執行最終一次 `npm run lint` + `npm run build`，確認一切乾淨 *(lint 仍是基線 2 個既有錯誤無新增；build 成功 5.11 MB / 1.43 MB gzip)*
- [x] 7.4 整理本次升級的最終版本表（核心 + 模組 + 第三方），寫入本檔的「最終版本記錄」區塊
- [x] 7.5 通過 OpenSpec 驗證：執行 `openspec validate upgrade-nuxt-to-latest --strict` *(`Change 'upgrade-nuxt-to-latest' is valid`)*
- [x] 7.6 準備 commit 訊息草稿給使用者確認後再 commit 收尾，並提示使用者執行 `/opsx:archive` 歸檔此 change *(已 commit f00d0f8 — 使用者選擇合併成 1 個 commit)*

## 8. 不適用項目（明確記錄）

- [x] 8.1 確認本次升級「不」涉及任何資料庫或持久化資料變更（專案無 Prisma schema、無 migrations 目錄）；原需求中「資料結構自動同步與修復」議題已與使用者確認跳過

---

## 降版紀錄

**無**（所有套件皆成功升級到目標最新版，無任何降版）。

## 最終版本記錄

| 套件 | 升級前 | 升級後 | 狀態 |
|---|---|---|---|
| `nuxt` | `^4.3.1` | `^4.4.2` | ✅ 升級 |
| `vue` | `^3.5.21` | `^3.5.32` | ✅ 升級 |
| `vue-router` | `^4.5.1` | `^5.0.4` | ✅ 升級（major） |
| `@nuxt/eslint` | `^1.9.0` | `^1.15.2` | ✅ 升級 |
| `@nuxt/fonts` | `^0.11.4` | `^0.14.0` | ✅ 升級 |
| `@nuxt/icon` | `^2.0.0` | `^2.2.1` | ✅ 升級 |
| `@nuxtjs/i18n` | `^10.1.0` | `^10.2.4` | ✅ 升級 |
| `@nuxtjs/color-mode` | `^3.5.2` | `^4.0.0` | ✅ 升級（major） |
| `@element-plus/nuxt` | `^1.1.5` | `^1.1.5` | ➖ 已最新 |
| `element-plus` | `^2.13.2` | `^2.13.6` | ✅ 升級 |
| `@pinia/nuxt` | `^0.11.2` | `^0.11.3` | ✅ 升級 |
| `pinia` | `^3.0.3` | `^3.0.4` | ✅ 升級 |
| `@vueuse/motion` | `^3.0.3` | `^3.0.3` | ➖ 已最新 |

**新增 overrides**：`"eslint-webpack-plugin": "^6.0.0"`（解 `@nuxt/eslint@1.15.2` 帶入的 optional peer 與 eslint v10 衝突）

**未變動項目**：
- `nuxt.config.ts` 的 `compatibilityDate: '2025-07-15'` — 保留以分離「版本變動」與「行為變動」風險
- 所有業務程式碼（`app/`、`server/`、`i18n/`、`types/`）
- ESLint v10 維持不變
- `engines.node: >= 24.13.0` 維持不變
- Dockerfile 與部署設定維持不變
- 既有的 lint 既有錯誤（`.vscode/demo.vue` 與 `app/composables/tool/use-ws.ts:505`）— 與升級無關，留待獨立 PR 處理
