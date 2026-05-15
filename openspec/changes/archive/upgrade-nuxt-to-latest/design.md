## Context

`nuxt4-base` 是企業級 Nuxt 4 前端框架樣板，目前以下列關鍵套件構成：

| 類別 | 套件 | 現況版本 |
|---|---|---|
| 核心 | `nuxt` | `^4.3.1` |
| 核心 | `vue` | `^3.5.21` |
| 核心 | `vue-router` | `^4.5.1` |
| 官方模組 | `@nuxt/eslint` | `^1.9.0` |
| 官方模組 | `@nuxt/fonts` | `^0.11.4` |
| 官方模組 | `@nuxt/icon` | `^2.0.0` |
| 官方模組 | `@nuxtjs/color-mode` | `^3.5.2` |
| 官方模組 | `@nuxtjs/i18n` | `^10.1.0` |
| 第三方 | `@element-plus/nuxt` | `^1.1.5` |
| 第三方 | `element-plus` | `^2.13.2` |
| 第三方 | `@pinia/nuxt` | `^0.11.2` |
| 第三方 | `pinia` | `^3.0.3` |
| 第三方 | `@vueuse/motion` | `^3.0.3` |
| 工具 | `eslint` | `^10.0.0` |
| 工具 | `sass` | `^1.92.1` |

`nuxt.config.ts` 設定 `compatibilityDate: '2025-07-15'`，已啟用 Pug 模板、SCSS 自動注入、Element Plus SCSS 主題、`@nuxtjs/i18n` `prefix_except_default` 路由策略、`@nuxt/icon` 自訂集合 + clientBundle 掃描、`@nuxt/fonts` 自動探測。

升級的觸發情境：使用者要求把 Nuxt 升到最新版以同步社群進度與安全修補。經與使用者確認：

- 專案無資料庫，原需求中「資料結構同步與修復」議題不適用
- 升級範圍涵蓋 Nuxt 核心 + 官方模組 + 第三方模組 + Vue 生態（vue/vue-router）
- 採完整回歸測試（Playwright MCP）驗證
- 遇到無法在合理工時內修復的 breaking change → 採保守降版策略

## Goals / Non-Goals

**Goals:**

- 將 `nuxt` 升到最新 4.x 穩定版（預期 `4.4.x` 系列），同時讓所有相依模組與 Vue 生態升至彼此相容的最新穩定版
- 維持 `nuxt.config.ts` 的所有現有行為（i18n 策略、Element Plus SCSS、Icon 自訂集合、Pug、SCSS 自動注入、Pinia、ColorMode、Motion）不發生語意變化
- 確保 `npm run lint` 與 `npm run build` 通過
- 透過 Playwright MCP 對核心使用者旅程做完整回歸測試並通過
- 為「Nuxt 平台版本基線」建立 OpenSpec 規格（`nuxt-platform-version`），讓未來升級有可追溯依據
- 變更對開發者體感無感（除路徑別名、自動匯入、SCSS 工具、`$api` / `$open` / `$dayjs` 全域工具的行為均保留）

**Non-Goals:**

- 不升級到 Nuxt 5（即使透過 `future.compatibilityVersion: 5` 預覽也排除在外）
- 不重構業務程式碼、不調整 `app/` 下的頁面或元件結構
- 不變更 i18n 翻譯內容、不調整路由結構
- 不導入新的開發工具鏈（不換 vitest、不換 build tool、不換 package manager）
- 不處理任何資料同步、資料庫遷移、後端 API schema 變更
- 不調整 Dockerfile 或部署流程（除非升級後 Node 版本下限變動）

## Decisions

### 決策 1：採「核心 → 模組 → 應用」三階段升級，而非一次性 `npm update`

**選擇**：先升 `nuxt` + `vue` + `vue-router`，編譯通過後再升官方模組，最後升第三方模組與 UI 函式庫。

**理由**：
- 任何套件出錯時，知道是誰的鍋
- Nuxt 核心 + Vue 是地基，地基不穩升上層模組只會堆錯
- 每階段都跑一次 `lint` + `build` + 手動煙霧測試，可立即定位問題
- 配合「保守降版」策略，可以只回退出錯的那一階段，不必整批回滾

**Alternatives considered**：
- 一次性 `npm update`：時間最短但故障定位困難，不符合保守策略
- 鎖定每個套件的精確版本逐個升：太慢且 lockfile 噪音大

### 決策 2：以 Context7 / 官方 release notes 為相容性事實來源，而非盲信 `^` semver

**選擇**：每個套件升級前，先用 Context7 MCP 或 WebFetch 查詢官方 release notes 與 migration guide，確認與當前 Nuxt 4.4.x 的相容版本後再寫入 `package.json`。

**理由**：
- `^` 範圍可能跨越 breaking change（套件作者不一定嚴守 semver）
- `@nuxtjs/i18n` 從 v9 → v10 曾出現過行為變化，該模組對版本敏感
- `element-plus` 與 `@element-plus/nuxt` 必須匹配，盲升可能踩到 SCSS 主題注入問題
- 比起出錯後降版，事前確認成本更低

### 決策 3：保留 `compatibilityDate` 不立刻推進到最新

**選擇**：先升套件版本，`compatibilityDate` 維持 `2025-07-15` 不動；除非升級後 Nuxt 警告 compatibilityDate 過舊或某個新行為必須靠新日期觸發，否則不變動。

**理由**：
- `compatibilityDate` 是 Nitro / Nuxt 為了跨版本相容性新增的「行為快照」機制，貿然推進可能改變預設行為（例如 fetch 行為、storage driver、route resolver）
- 維持原日期可降低升級風險，把「版本變動」與「行為變動」分離成兩個獨立的可回滾步驟
- 若後續確認新日期下行為穩定，可在另一個變更中單獨推進

### 決策 4：完整回歸測試以「核心使用者旅程」為單位，由 Playwright MCP 自動化

**選擇**：使用 Playwright MCP 跑下列流程，並用 `browser_snapshot` 與 `browser_console_messages` 做雙重驗證（DOM + console error）：

1. 啟動 dev server，導向首頁，驗證無 SSR/hydration error
2. 切換語系（zh ↔ en ↔ ja），驗證 URL 前綴策略 `prefix_except_default` 仍正確
3. 切換主題色（color-mode），驗證 class 切換與 SCSS 變數
4. 開啟一個 `OpenDialog*` 業務彈窗，驗證 `$open` 工具鏈
5. 觸發一個 Element Plus 表單（含 `ElInput` + `ElSelect` + 驗證），確認 `value-on-clear` / `maxlength` 行為
6. 觸發一個 `$api.*` 呼叫，驗證 401 自動跳轉與 token 注入
7. 模擬權限角色，驗證 `HasRule()` 行為
8. 改變視窗寬度測試 RWD（透過 `browser_resize`）
9. 觸發路由跳轉（同語系 + 跨語系），驗證 page transition 與 layout transition

**理由**：
- 直接覆蓋「使用者實際看到的東西」，比單元測試更能抓到 Vue Router v5 / unrouting / i18n v10+ 的整合性 regression
- Playwright MCP 已內建於本環境，無需新增依賴或設定
- `browser_console_messages` 可同時抓 hydration warning 與 deprecated API warning，這是 Nuxt 升級最常見的回歸點

**Alternatives considered**：
- 加 vitest 單元測試：本次升級不該擴大範圍引入新測試框架
- 純手動點擊：易漏、不可重現

### 決策 5：所有版本變動 commit 拆分，至少分成「nuxt 核心」「官方模組」「第三方模組」三個 commit

**選擇**：每階段升級成功後立即 commit，commit message 用 `chore: 升級 nuxt 核心至 4.4.x`、`chore: 升級 nuxt 官方模組` 等。

**理由**：
- git bisect 友善
- 若降版回退，可單獨 revert 一個 commit 而非整批
- 符合專案 CLAUDE.md 的 Conventional Commits 規範

## Risks / Trade-offs

| 風險 | 緩解 |
|---|---|
| `@nuxtjs/i18n` 升級導致 `prefix_except_default` 行為變化或 `redirectOn: 'root'` 偵測邏輯改變 | 升級前先讀該模組 release notes，升級後在回歸測試 step 2 用 Playwright 對 zh/en/ja 三語系全部走一遍 URL，比對結果 |
| Vue Router v5（Nuxt 4.4 內建）改變 `definePageMeta` 或動態路由解析行為 | 在 grep 階段先盤點所有 `definePageMeta` 與動態路由檔，升級後跑全路由 smoke test |
| `element-plus` 與 `@element-plus/nuxt` 版本不匹配導致 SCSS 主題注入錯亂 | 兩者必須一起升，升級後立即用 Playwright 渲染一個含主要 EP 元件的頁面，截圖比對 |
| `@nuxt/icon` clientBundle scan 在新版改變掃描規則，導致圖示 404 | 升級後執行 `npm run build`，檢查 build log 中的 icon scan 報告 |
| `pinia` 升級造成 store 初始化順序變化（本專案以數字前綴依賴順序） | 升級後手動啟動 dev，觀察 `StoreEnv → StoreTool → StoreTheme → StoreSelf → StoreOpen` 的初始化順序 |
| `eslint` v10 與新版 `@nuxt/eslint` 規則衝突 | 用 `npm run lint` 驗證，必要時調整 `eslint.config.mjs` |
| `sass` 升級造成 `silenceDeprecations: ['legacy-js-api']` 不再有效 | 觀察 build log 警告，必要時用新 deprecation key 替換 |
| Node.js 版本下限被推進，超過 `>= 24.13.0` | 檢查每個升級套件的 `engines.node`，必要時更新 `package.json` 與 Dockerfile |
| 升級後出現 hydration mismatch（最常見的隱性 regression） | Playwright `browser_console_messages` 在每個測試步驟都檢查，發現任何 `[Vue warn]: Hydration` 即視為 fail |
| `compatibilityDate` 過舊導致新版 Nuxt 警告 | 預期保持原日期；若 Nuxt 強制要求升日期，將其作為獨立子任務記錄在 tasks.md |

**根本權衡**：
- 「升到最新」與「保守不出事」本質衝突 → 採三階段升級 + 保守降版策略平衡
- 「完整回歸測試」會耗費較多 Playwright 操作時間 → 接受此成本，因為這是使用者明確的驗收條件

## Migration Plan

1. **準備階段**
   - 確認當前分支 clean，建立升級工作分支（或在 main 上直接做，視 git 流程決定）
   - 紀錄當前 `package.json` + `package-lock.json` 為基線
   - 用 Context7 / WebFetch 蒐集每個目標套件的最新穩定版號與 release notes
2. **第一階段：核心升級**
   - 升級 `nuxt` + `vue` + `vue-router`
   - 執行 `npm install` → `npm run lint` → `npm run build`
   - 啟動 dev server 跑 smoke test（首頁載入、無 console error）
   - 通過 → commit
3. **第二階段：官方模組升級**
   - 升級 `@nuxt/eslint`、`@nuxt/fonts`、`@nuxt/icon`、`@nuxtjs/i18n`、`@nuxtjs/color-mode`
   - 重複 lint + build + smoke
   - 通過 → commit
4. **第三階段：第三方模組與 UI 升級**
   - 升級 `@element-plus/nuxt` + `element-plus`、`@pinia/nuxt` + `pinia`、`@vueuse/motion`
   - 重複 lint + build + smoke
   - 通過 → commit
5. **完整回歸測試階段**
   - 啟動 dev server
   - 用 Playwright MCP 依決策 4 的清單跑完所有流程
   - 任何步驟失敗 → 進入降版分支（見 Rollback）
6. **收尾**
   - 更新 `version.ts`（如果專案使用語意化版本）
   - 寫入 `nuxt-platform-version` spec
   - 最終 commit

**Rollback 策略**：

- 若某階段 build/lint/smoke 失敗，且 30 分鐘內無法修復 → 把該階段對應套件版本降回前一個 minor 版（保留升級到能工作的最高版本）
- 若整個升級無法達成穩定 → revert 所有升級 commit，回到 `^4.3.1` 基線，並在 tasks.md 標註失敗原因
- 因為每階段都是獨立 commit，rollback 只需要 `git revert <commit>`

## Open Questions

- 是否要在 `nuxt.config.ts` 啟用 `experimental.appManifest` 等 Nuxt 4.4 引入的新 opt-in 行為？→ 預設不啟用，本次升級只做版本對齊
- 若 `@vueuse/motion` 在新版有破壞性 API 變動（v3 → v4 可能性低，但需確認），是否要降版？→ 套用保守策略，降到能工作的最高版本
- 是否需要為這次升級寫 CHANGELOG 條目？→ 視專案是否維護 CHANGELOG.md 而定（目前未見此檔，預設不寫）
