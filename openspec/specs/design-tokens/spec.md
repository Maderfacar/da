# 設計 Token

## Purpose

全站的色彩、字族與尺度只有一個定義點。以 CSS custom properties 為真相來源，SCSS 別名層只做轉指，
元件不得自行宣告色碼或字體堆疊。目的是讓「換色票」與「換字體」各只需改一處，
而不是改一千多個地方並祈禱沒改漏。

實作於 2026-08-26 完成（階段 0）：色票換為精品調（縞黑 `#1A1917` / 骨白 `#EAE7E0` /
古銅 `#7E6330`），字體換為 Cormorant Garamond + Jost。尺度類 token（圓角 / 陰影 /
z-index / 動效 / 斷點 / 觸控高度）**已定義但尚未取代既有字面值**，那屬後續階段。

## Requirements

### Requirement: 設計 token 單一真相來源
系統 SHALL 以單一檔案 `app/assets/styles/css-class/_design-tokens.css` 宣告全站設計 token（色彩語意別名、字族、圓角、陰影、z-index、動效、斷點、觸控高度），並以 CSS custom properties 為真相來源。SCSS 別名層 `app/assets/styles/scss-tool/tokens.scss` MUST 只做轉指，不得自帶字面值。

專案 MUST NOT 存在第二處色彩定義來源。`app/assets/styles/scss-tool/colors.scss` 的樣板遺留變數（`--demo` `--primary` `--secondary` `--tertiary` `--gray` `--err` `--font` `--bg` `--white`）SHALL 被收斂，且 `_theme-colors.css` 中指示「要記得去 scss/_colors.scss 添加」的註解 SHALL 移除。

收斂後 `colors.scss` 已無內容，SHALL 整檔刪除並自 `nuxt.config.ts` 的 vite `additionalData` 移除。其中唯一具業務語意的 `--err` SHALL 改名 `--danger` 並移入 `_design-tokens.css`，值維持 `#EE5151` 不變 —— 語意色的判讀門檻不屬色票換裝的範圍，其對比度債（瓷白上 3.28:1）歸「語意色三件套」階段。

#### Scenario: 收斂成果有常態守衛
- **WHEN** 日後有人在元件內重新宣告 `$font-*`、內嵌字體堆疊、復活樣板遺留色變數，或把已下架字族加回 `fonts.families`
- **THEN** `shared/design-token-guards.spec.ts` SHALL 失敗
- **AND** 該守衛的每一條 MUST 於加入時以注入違規的方式證明它確實會紅

#### Scenario: token 只有一個定義點
- **WHEN** 開發者搜尋任一設計 token 的字面值（如 `#1A1917`）
- **THEN** 該字面值只出現在 `_design-tokens.css` 或 `_theme-colors.css` 其一
- **AND** `tokens.scss` 內所有 SCSS 變數的值皆為 `var(--*)` 形式

#### Scenario: 死碼移除
- **WHEN** 檢視 `_theme-colors.css`
- **THEN** `:root.dark` 區塊不存在（其內容原與 `:root` 完全相同）

### Requirement: 精品調色票換裝
`_theme-colors.css` 的 12 個 `--da-*` token SHALL 換為精品調色值（骨白 `#EAE7E0` / 瓷白 `#F5F3EE` / 縞黑 `#1A1917` / 古銅 `#9C7C3C` / 亮銅 `#C9A961` 等）。token **名稱 MUST NOT 變更**，以確保既有 940 處 `var(--da-*)` 引用與主題引擎白名單 `DA_THEME_TOKEN_KEYS` 不受影響。

系統 SHALL 另提供語意別名層（`--surface-ground` `--ink` `--accent` 等），且每個別名的值 MUST 為 `var(--da-*)` 形式，不得寫死色值。

#### Scenario: 已 token 化的頁面自動變色
- **WHEN** 色票換裝完成且未修改任何 `.vue` 檔的色彩宣告
- **THEN** 全站 940 處 `var(--da-*)` 引用點皆呈現新色值

#### Scenario: 語意別名可被主題覆寫
- **WHEN** 主題引擎於 `[data-da-theme]` 覆寫 `--da-amber`
- **THEN** `--accent` 解析後的值隨之改變（因其定義為 `var(--da-amber)`）

### Requirement: 主題引擎色票同步
`shared/site-theme.ts` 的 `DEFAULT_TOKENS` SHALL 與 `_theme-colors.css` 的 `--da-*` 完全一致。三套節日主題包（`christmas` / `lunar-new-year` / `summer`）的色值 SHALL 依新底色重新校準。

系統 SHALL 提供 migration，將 prod Firestore `site_themes/{themeId}.tokens` 更新為新色票。

#### Scenario: 乘客端不被舊色蓋回
- **WHEN** 色票換裝已上 prod 且 migration 已執行
- **THEN** 乘客端（掛 `data-da-theme` 的 `front-desk` / `marketing` layout）呈現新色票
- **AND** `GET /nuxt-api/config/theme` 回傳的 `tokens` 與 `_theme-colors.css` 一致

#### Scenario: migration 未執行時可被偵測
- **WHEN** 程式碼已換色但 Firestore 仍為舊色
- **THEN** 乘客端顯示舊色而 admin / driver 端顯示新色（此不一致 SHALL 於驗收清單中被明確檢查）

### Requirement: 字族 token 化
系統 SHALL 以 `--ff-display` / `--ff-ui` / `--ff-label` / `--ff-data` / `--ff-mono` 五個 token 定義全站字族。所有 `.vue` 檔 MUST NOT 內嵌字體名稱字串，亦 MUST NOT 於檔案內自行宣告 `$font-*` SCSS 變數。

> `--ff-mono` 為實作時新增（原規格列四個）。全站有 27 處等寬用途散在四種堆疊（`monospace` / `Menlo, Consolas` / `'JetBrains Mono'` / `'Fira Code'`），皆為 admin 的 JSON payload、log、Firestore uid 呈現 —— 與 `--ff-data`（識別碼／金額，需 tabular-nums）語意不同，不收斂就是漏網的第二真相來源。

`nuxt.config.ts` 的 `fonts.families` SHALL 只包含實際被 token 引用的字族。字族 token 的值 MUST NOT 含任何非系統字族名，除非該字族已列入 `fonts.families` —— `@nuxt/fonts` 的 `processCSSVariables` 會把 token 裡出現的字族名視為自架目標並下載。

#### Scenario: 產物必須含 `@font-face`，build 綠不算數
- **WHEN** 字體換裝完成且 `pnpm build` exit 0
- **THEN** MUST 檢查 `.output/public/static/*.css` 確實含對應字族的 `@font-face`
- **AND** 若為 0，表示字體未下載、畫面靜默 fallback 到系統字 —— 此情況 build 一樣全綠，無法由建置結果偵測

#### Scenario: 字族 token 不得夾帶非自架字族名
- **WHEN** 於 `--ff-*` 任一 token 的值中寫入未列入 `fonts.families` 的字族名（如 `'JetBrains Mono'`）
- **THEN** `@nuxt/fonts` 會為它產生 `@font-face` 並下載字檔，造成非預期的 payload 增加
- **AND** 等寬與其他純系統堆疊 SHALL 只使用系統字族名（`ui-monospace` / `Menlo` / `Consolas` 等）

#### Scenario: 換字體只需改一處
- **WHEN** 修改 `_design-tokens.css` 的 `--ff-display`
- **THEN** 全站展示字體隨之改變，無需修改任何 `.vue` 檔

#### Scenario: 無殘留字體引用
- **WHEN** 字體換裝完成
- **THEN** 全專案搜尋 `Bebas Neue`、`Barlow Condensed`、`'Barlow'` 的結果為 0
- **AND** 該三個字族已自 `nuxt.config.ts` 的 `fonts.families` 移除

#### Scenario: 字體來源可用性為阻斷前置
- **WHEN** 開始任何換裝工作之前
- **THEN** MUST 先確認 provider `bunny` 可提供 Cormorant Garamond 與 Jost
- **AND** MUST 先確認 `pnpm build` 通過
- **AND** 若任一不成立，SHALL 停止並回報，不得改以 `google` provider（前例：gstatic 對 CJK woff2 回 404 導致 Vercel 部署失敗）

### Requirement: 尺度 token 定義
系統 SHALL 於 `_design-tokens.css` 宣告圓角（5 個）、陰影（3 階）、z-index（6 層語意）、動效時長（3 階 + 1 easing）、斷點（4 個）、觸控高度（`--tap: 44px`）token。

本變更 SHALL NOT 替換既有程式碼中的對應字面值 —— 定義先行，替換歸屬後續階段。

#### Scenario: token 已定義但未強制套用
- **WHEN** 本變更完成
- **THEN** `_design-tokens.css` 含上述所有 token 宣告
- **AND** 既有 656 處 `border-radius`、72 處 `z-index` 等字面值維持原狀，不造成視覺變動

### Requirement: 視覺回歸基線
系統 SHALL 於 `tests/e2e/visual/` 建立截圖基線，覆蓋三端關鍵頁（乘客 `/` `/booking` `/orders` `/fare` `/vehicles`；司機 `/driver/dashboard` `/driver/trip`；Admin `/admin/orders` `/admin/dashboard` `/admin/settings`），於既有三個 Playwright project 執行。

基線 MUST 於色票換裝**之前**產生並提交。

#### Scenario: 基線先於變更
- **WHEN** 色票尚未換裝
- **THEN** 基線截圖已產生並 commit，內容為舊色

#### Scenario: 變更後逐張人工確認
- **WHEN** 色票換裝完成後重跑視覺測試
- **THEN** 預期所有截圖產生 diff（此非失敗）
- **AND** MUST 逐張人工確認「變化符合預期」後才接受為新基線

#### Scenario: 不穩定頁面不阻斷
- **WHEN** 某頁因動畫、時間字串或登入態導致截圖 flaky 且無法於本變更內穩定
- **THEN** 該頁自基線清單移除並記錄原因，不阻斷本變更

### Requirement: `!important` 盤點
系統 SHALL 產出 `important-audit.md`，將全站 57 處 `!important` 分為「宣告色彩／字體屬性（會擋 token）」與「其他」兩類。

本變更 SHALL NOT 修改任何 `!important`。

#### Scenario: 已知未變色點可被解釋
- **WHEN** 驗收時發現某處未隨色票變色
- **THEN** 該處 SHALL 可於 `important-audit.md` 的 A 類清單中查到
- **AND** 此類點位不列為缺陷
