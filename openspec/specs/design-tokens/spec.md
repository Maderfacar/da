# 設計 Token

## Purpose

全站的色彩、字族與尺度只有一個定義點。以 CSS custom properties 為真相來源，SCSS 別名層只做轉指，
元件不得自行宣告色碼或字體堆疊。目的是讓「換色票」與「換字體」各只需改一處，
而不是改一千多個地方並祈禱沒改漏。

實作分三階段完成：

- **階段 0（2026-08-26）** —— 色票換為精品調（縞黑 `#1A1917` / 骨白 `#EAE7E0` /
  古銅 `#7E6330`），字體換為 Cormorant Garamond + Jost。尺度類 token 定義先行、未套用。
- **階段 1（2026-08-27）** —— 語意狀態色、疊色階梯、Element Plus 橋接、A 類 `!important` 清除。
- **階段 2（2026-08-27 ~ 08-28）** —— 玻璃退場與表面 token 化、尺度與排版 token 實際替換、
  後台色票編輯、乘客端深色模式（含每套主題各帶一組深色盤）、乘客端首頁版面重排。

尺度 token 至階段 2 **已完成替換**，不再是「定義而未套用」。

## Requirements

### Requirement: 設計 token 單一真相來源
系統 SHALL 以單一檔案 `app/assets/styles/css-class/_design-tokens.css` 宣告全站設計 token（色彩語意別名、語意狀態色、疊色階梯、字族、圓角、陰影、z-index、動效、斷點、觸控高度），並以 CSS custom properties 為真相來源。SCSS 別名層 `app/assets/styles/scss-tool/tokens.scss` MUST 只做轉指，不得自帶字面值。

專案 MUST NOT 存在第二處色彩定義來源，唯一例外是 Element Plus 的 `$colors` map（Sass 需編譯期常數推導色階），且該例外 MUST 由守衛比對其與 token 一致。

元件 MUST NOT 硬編色碼，包含 `#RRGGBB` 與 `rgba()` 兩種寫法 —— 階段 0 的守衛只掃 `--da-*` 與 `$font-*`，因而漏掉了 202 處 `rgba()` 形式的舊主色與整份 EP `$colors` map；守衛範圍 SHALL 擴及此二者。

#### Scenario: 收斂成果有常態守衛
- **WHEN** 日後有人在元件內重新宣告 `$font-*`、內嵌字體堆疊、復活樣板遺留色變數、把已下架字族加回 `fonts.families`、硬編舊色票或狀態色，或使 EP `$colors` map 與 token 漂移
- **THEN** `shared/design-token-guards.spec.ts` SHALL 失敗
- **AND** 該守衛的每一條 MUST 於加入時以注入違規的方式證明它確實會紅

#### Scenario: token 只有一個定義點
- **WHEN** 開發者搜尋任一設計 token 的字面值（如 `#1A1917`）
- **THEN** 該字面值只出現在 `_design-tokens.css`、`_theme-colors.css` 或 EP `$colors` map 其一
- **AND** `tokens.scss` 內所有 SCSS 變數的值皆為 `var(--*)` 形式

#### Scenario: 死碼移除
- **WHEN** 檢視 `_theme-colors.css`
- **THEN** `:root.dark` 區塊不存在（其內容原與 `:root` 完全相同）

### Requirement: 語意狀態色 token
系統 SHALL 於 `_design-tokens.css` 定義四組語意狀態色（`good` / `wait` / `note` / `stop`），每組三階（base / `-lit` / `-wash`），共 12 個 token。元件 MUST NOT 自行挑選狀態色碼。

四組色值 SHALL 於瓷白（`#F5F3EE`）與骨白（`#EAE7E0`）底上皆達 WCAG AA 文字標準（≥ 4.5:1），`-lit` 階 SHALL 於縞黑（`#1A1917`）底上達 ≥ 4.5:1，`-wash` 階作為底色時與同組 base 的組合 SHALL 達 ≥ 4.5:1。

語意狀態色 MUST NOT 列入 `DA_THEME_TOKEN_KEYS`，其值 SHALL 直接寫定，不隨主題引擎覆寫 —— 狀態色是判讀門檻，換季不得改變其語意（例如節日主題不得使「成功」變為紅色）。

原 `--danger` SHALL 改為 `var(--stop)` 的別名，站上不得同時存在兩個錯誤紅。

#### Scenario: 狀態色只有一個來源
- **WHEN** 開發者需要表示「成功」「等待」「提示」「錯誤」
- **THEN** 只能引用 `--good` / `--wait` / `--note` / `--stop` 及其 `-lit` / `-wash` 階
- **AND** 硬編既有 27 種狀態色值時 `design-token-guards.spec.ts` SHALL 失敗

#### Scenario: 深色面上的狀態色可讀
- **WHEN** 狀態色用於深色面（司機端儀表板、admin 側欄）
- **THEN** SHALL 使用 `-lit` 階，且與縞黑底的對比 ≥ 4.5:1

#### Scenario: 換季不改變狀態語意
- **WHEN** 主題引擎套用節日包並覆寫 `--da-amber`
- **THEN** `--good` / `--wait` / `--note` / `--stop` 的解析值不變

### Requirement: 疊色階梯 token
半透明的主色與墨色疊層 SHALL 從固定的 6 階階梯取值（`--accent-a06/a12/a20/a32/a50/a70`、`--ink-a06/…/a70`），高透明區間的表面疊層 SHALL 從 `--surface-a50/a72/a88/a96` 取值。元件 MUST NOT 自行宣告 `rgba()` 疊色。

疊色 token SHALL 隨主題引擎覆寫 `--da-*` 而改變。實作 SHALL 以 `@supports (color: color-mix(…))` 提供漸進增強，不支援的瀏覽器取得固定色調的 `rgba()` 後備值。

MUST NOT 以同名重複宣告（`--x: rgba(…); --x: color-mix(…);`）作為後備手段 —— CSS 自訂屬性的無效值在代入時才失敗，該寫法會使屬性退回初始值而非前一條宣告。

#### Scenario: 疊色跟著主題走
- **WHEN** 主題引擎將 `--da-amber` 覆寫為節日包的深酒紅
- **THEN** 所有 `--accent-a*` 疊層一併轉為深酒紅色調，不殘留古銅

#### Scenario: 舊瀏覽器不破圖
- **WHEN** 瀏覽器不支援 `color-mix()`
- **THEN** 疊色取得 `rgba()` 後備值並正常渲染
- **AND** 使用該 token 的屬性不得退回初始值

### Requirement: Element Plus 色彩橋接
`app/assets/styles/scss-tool/element-plus/index.scss` 的 `$colors` map SHALL 使用精品調色值，MUST NOT 保留樣板遺留色（`#354d7b` `#00ADA9` `#EB8B2D` `#808080`）。

由於 Sass 需以編譯期常數推導色階，該 map SHALL 是全站唯一容許寫色碼字面值的第二處；其值 MUST 逐一等於 `_design-tokens.css` 對應 token 的字面值，並由守衛常態比對。

`element-plus/_theme.css` SHALL 另提供 `--el-*` 對 token 的 runtime 橋接，使 Element Plus 元件隨主題引擎變色。

#### Scenario: Element Plus 元件進入精品調
- **WHEN** 檢視 admin 任一含 Element Plus 元件的頁面
- **THEN** 按鈕、開關、Tag、分頁、focus ring、表格表頭皆為精品調
- **AND** 產物 CSS 內 `#354d7b` 出現 0 次

#### Scenario: EP map 與 token 漂移會被擋下
- **WHEN** 有人只改 `_design-tokens.css` 而未同步 EP 的 `$colors` map
- **THEN** `design-token-guards.spec.ts` SHALL 失敗並指出不一致的項目

## MODIFIED Requirements

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

### Requirement: 尺度 token 強制套用
系統 SHALL 於 `_design-tokens.css` 宣告圓角（7 階）、陰影（3 階）、z-index（11 層語意）、
動效時長（4 階 + 1 easing）、斷點、觸控高度、版面節奏（`--gutter` / `--space-*` /
`--space-section` / `--space-major` / `--measure` / `--shell`）token。

元件 MUST NOT 於 `<style>` 內寫入對應的字面值。既有字面值 SHALL 於階段 2 完成替換：
圓角 660 個長度值、z-index 38 處、`box-shadow` 37 處、`transition` 378 段。

圓角 SHALL 順勢收緊（原 8px 的 99 處收為 6px）—— 大圓角讀起來是消費級 App，
精品調的圓角是克制的。緩動 SHALL 統一為 expo-out（起步快、收尾慢）。

#### Scenario: 尺度值只有一個來源
- **WHEN** 開發者於元件內寫入 `border-radius: 8px`、`z-index: 9999` 或 `transition: .3s ease`
- **THEN** `design-token-guards.spec.ts` SHALL 失敗並指出應改用的 token

#### Scenario: 區域堆疊不誤觸發
- **WHEN** 元件內使用區域性的 `z-index: 5`（同一 stacking context 內的相對層序）
- **THEN** 守衛 SHALL NOT 失敗 —— 守衛要準，不是要嚴

### Requirement: 表面 token 與玻璃退場
系統 SHALL 以絕對表面 token（`--surface-deep` / `-2` / `-3`）表達深色面，
以 `--surface-a*`（11 階）與 `--ink-a*`（9 階）表達疊層與髮絲線。

玻璃質感 SHALL 全面退場：`backdrop-filter` 與玻璃 token 的**用法與定義**皆 MUST NOT 存在。
玻璃邊框 SHALL 映射為中性髮絲線而非 20% 主色 —— 每張卡都鑲一圈品牌色正是樣板感的來源。

深色面 MUST NOT 以「翻轉 `--surface-raised`」實作 —— `--surface-a06…a96` 十一階皆由它推導，
翻轉後 `--surface-a12` 變成深色疊深色，髮絲線會全站集體消失，且 build 全綠不會示警。
唯一可於深色作用域翻轉的是 `--hairline`（沒有任何 token 從它推導）。

#### Scenario: 定義與用法分開守
- **WHEN** 玻璃 token 的用法已全數清除但定義仍留在 `_theme-colors.css`
- **THEN** 守衛 SHALL 失敗 —— `TOKEN_SOURCES` 內的檔案在用法掃描時被跳過，需另有定義掃描

#### Scenario: 守衛以產物為準
- **WHEN** 新增任何色彩相關守衛
- **THEN** MUST 比對 `.output` 產物而非僅掃描原始碼
- **AND** 守衛 SHALL 採「`<style>` 內全禁字面色碼 + 具名例外」的全禁式，不得列舉寫法
  —— 同一顏色的寫法至少有七種（`rgba()` 逗號式、`rgb()` 逗號式、8 碼 hex、3 碼 hex、
  CSS 關鍵字、關鍵字寫在函式值裡、空格分隔 `rgb(0 0 0 / 60%)`），列舉必漏

### Requirement: 排版 token 化
系統 SHALL 以 `--fs-*`（11 階）/ `--lh-*`（5 階）/ `--ls-*`（8 階）表達字級、行高、字距。
階梯 SHALL 沿用 `scss-tool/typography.scss` 既有拍板（最小 12px、body 15px），不重新發明。

`typography.scss` MUST 只做轉指，不得自帶字面值。

#### Scenario: 字級不得低於階梯最小值
- **WHEN** 元件內寫入 `font-size: 11px` 或更小
- **THEN** 守衛 SHALL 失敗

#### Scenario: 相對單位不誤觸發
- **WHEN** 元件內使用 `clamp()` 或 `em` 表達字級
- **THEN** 守衛 SHALL NOT 失敗

### Requirement: 乘客端深色模式
系統 SHALL 提供乘客端深色模式三選一（淺色 / 深色 / 跟隨系統），預設 `light`。

深色作用域 MUST 為 `.dark [data-da-theme]`，MUST NOT 為 `:root.dark` —— 理由有二：
① `--surface-deep` 定義為 `var(--da-dark)`，深色模式將其反轉為淺色，寫在 `:root` 會把
admin 與司機端翻掉；② 主題引擎注入於 `[data-da-theme]`（`:root` 子孫），
子孫宣告直接蓋掉繼承值，特異度不參與比較。

CSS 自訂屬性的別名寫在 `:root` 即當場定案，子孫作用域再覆寫來源變數亦追不回 ——
每個會覆寫 `--da-*` 的作用域 MUST 將整層語意別名重新宣告一次。

`[data-surface]` 標記 MUST 標在「表面實際是什麼顏色」的節點上，MUST NOT 標在
「這一端大致是深色」的節點上（前例：admin 是 7 深 7 淺混用，標在 layout 根節點
使 7 個淺色頁的主色掉到 1.82:1）。

#### Scenario: 浮層跟隨深色
- **WHEN** 於深色模式開啟 `$open` 彈窗、`UseAsk` 確認框或抽屜
- **THEN** 該浮層 SHALL 呈現深色 —— 這些節點 Teleport 至 `body`，MUST 自行標記 `data-da-theme`

### Requirement: 每套主題各帶深色配色
`SiteTheme` SHALL 具備 `tokensDark` 欄位，四套 seed 主題各帶一組深色盤，
主色對深色頁底的對比 SHALL ≥ 4.5:1。

深色盤 MUST NOT 由淺色盤推導 —— `--da-dark` 在兩個模式下語意皆為「主文字色」而值相反，
「語意相同、值相反」無法以公式表達。

色票同步點 SHALL 為 8 處（`_theme-colors.css` / `shared/site-theme.ts` /
`scripts/migrate-site-themes.mjs` / `tests/e2e/auth/fixtures.ts`，
每處各有 `tokens` 與 `tokensDark` 兩組），並由 `site-theme-sync.spec.ts` 常態比對。

#### Scenario: migration 未執行時退回單一深色盤
- **WHEN** 程式碼已上線但 `pnpm migrate:site-themes` 尚未執行
- **THEN** `resolveTheme` SHALL 沿 active → default → `DEFAULT_TOKENS_DARK` 合併，
  四套主題的深色呈現一致，不得破圖

#### Scenario: 後台編輯器不得依賴 Firestore 有無資料
- **WHEN** admin 開啟色票編輯器的深色分頁而該主題尚無 `tokensDark`
- **THEN** 編輯器 SHALL 以內建深色盤為保底值
- **AND** MUST NOT 顯示 `#000000` —— admin 端點回傳的是 Firestore 原始 doc、
  不經 `resolveTheme` 合併，「runtime 有 fallback」不等於「後台編輯器有 fallback」

#### Scenario: 回傳結構變更需考慮快取窗口
- **WHEN** `GET /nuxt-api/config/theme` 的回傳結構新增欄位
- **THEN** 消費端 SHALL 對舊格式回應提供保底值 —— 該端點有 30 秒 TTL 快取，
  部署當下新版 client 可能收到舊格式；而 `buildThemeCss` 位於 `useHead` 的 computed 內，
  一拋 TypeError 即整個 layout 的 head 計算失敗，症狀是白畫面而非顏色異常

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
`important-audit.md` SHALL 維持全站 `!important` 的分類清單。A 類（宣告色彩或字族且硬編色值，會擋 token）SHALL 於階段 1 修理完畢並接上 token，清單中 A-1 的數量 SHALL 為 0。

B 類（版位／間距／z-index／互動）不在色彩收尾範圍。A-3（字級）於尺度 token 實際替換時處理。

#### Scenario: 不再有已知未變色點
- **WHEN** 色票或主題變更
- **THEN** 全站不存在因 `!important` 硬編色而未變色的點
- **AND** `important-audit.md` 的 A-1 清單為空

