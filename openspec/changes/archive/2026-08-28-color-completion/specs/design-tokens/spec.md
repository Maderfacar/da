# 設計 Token（delta — 階段 1 色彩收尾）

## ADDED Requirements

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

### Requirement: `!important` 盤點
`important-audit.md` SHALL 維持全站 `!important` 的分類清單。A 類（宣告色彩或字族且硬編色值，會擋 token）SHALL 於階段 1 修理完畢並接上 token，清單中 A-1 的數量 SHALL 為 0。

B 類（版位／間距／z-index／互動）不在色彩收尾範圍。A-3（字級）於尺度 token 實際替換時處理。

#### Scenario: 不再有已知未變色點
- **WHEN** 色票或主題變更
- **THEN** 全站不存在因 `!important` 硬編色而未變色的點
- **AND** `important-audit.md` 的 A-1 清單為空
