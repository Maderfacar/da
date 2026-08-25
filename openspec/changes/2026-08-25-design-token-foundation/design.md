# Design Token Foundation — Design

## 現況實測（2026-08-25，全數為實際 grep 結果）

| 指標 | 數值 |
|------|------|
| `.vue` 檔數 / 總行數 | 134 / 54,733 |
| `<style>` 區行數 | 26,593（**佔 49%**） |
| `var(--da-*)` 使用 | 940 |
| 硬編 hex | 537（admin 323 / driver 57 / passenger 36 / ui 16 / common 7 / layouts 6） |
| `rgba(` | 1,672 |
| 內嵌 `font-family` | 441 行 |
| `$font-*` 本地宣告 | 124 行，散在 **46 個檔** |
| `border-radius` | 656 次，12 種值 |
| `box-shadow` | 81 次 |
| `z-index` | 72 次，13+ 種值 |
| `!important` | 57 |
| `@import` | 6 |
| `var(--da-glass-*)` / `backdrop-filter` | 86 / 65 |
| 樣板遺留 token（`--demo` `--primary` 等 9 個） | 共 20 處使用 |
| `min-height: 44px` | 全站 2 處 |

## 決策

### D1 — 保留 `--da-*` 名稱，只換值；語意別名指回它

**不重命名。** 940 處使用零風險，且主題引擎的 `DA_THEME_TOKEN_KEYS` 白名單不必改。

```
:root {
  /* 真相來源（可被主題引擎覆寫） */
  --da-cream:   #EAE7E0;   /* 骨白 · 頁面底 */
  --da-off-white:#F5F3EE;  /* 瓷白 · 卡片表面 */
  --da-gray-pale:#D6D1C7;  /* 髮絲線 */
  --da-dark:    #1A1917;   /* 縞黑 · 主文字／品牌面 */
  --da-dark-mid:#26241F;
  --da-gray:    #6D6A62;   /* 次要文字 */
  --da-gray-light:#A6A198; /* 三級文字 */
  --da-amber:   #9C7C3C;   /* 古銅 · 主色 */
  --da-amber-light:#C9A961;/* 亮銅（深底上用） */
  --da-amber-pale:#F0E8D6;
  --da-stripe-yellow: …    /* 見 D6 */
  --da-stripe-dark:   …

  /* 語意別名（新程式碼用這組；透過 --da-* 解析，仍可被主題覆寫） */
  --surface-ground:  var(--da-cream);
  --surface-raised:  var(--da-off-white);
  --hairline:        var(--da-gray-pale);
  --ink:             var(--da-dark);
  --ink-soft:        var(--da-gray);
  --ink-mute:        var(--da-gray-light);
  --accent:          var(--da-amber);
  --accent-lit:      var(--da-amber-light);
  --accent-wash:     var(--da-amber-pale);
}
```

別名**必須**指向 `--da-*` 而非直接寫死色值 —— 否則主題引擎覆寫 `--da-*` 時別名不會跟著變，換膚又「切一半」。

**已知命名債**：`--da-amber` 實際存的是古銅、`--da-stripe-*` 在新方向裡語意消失。接受此債，重命名另開變更。

### D2 — 四處同步 + prod migration（地雷）

已實測確認：prod Firestore `site_themes/default.tokens` 存著 2026-07-30 seed 的舊 12 色，`resolveTheme()` 會把它注入 `[data-da-theme]`（掛在 `front-desk` / `marketing` layout）。

**只改 CSS → 乘客端會被舊色蓋回去。** 因此必須同步：

1. `_theme-colors.css` 的 `:root`
2. `shared/site-theme.ts` 的 `DEFAULT_TOKENS`（`DEFAULT_SITE_THEMES.default.tokens` 展開自它）
3. prod Firestore `site_themes/default.tokens` — **需要 migration script**
4. `tests/e2e/auth/fixtures.ts` 的 `/nuxt-api/config/theme` mock — **W0a 實作時才發現的第四處**。
   它硬編了同一組 12 色。不同步的話乘客端 e2e 與視覺基線會拍到舊色、admin/driver 拍到新色，
   是 fixture 造成的假象而非真破圖。

驗收條件包含「prod 乘客端目視為新色」，不能只驗 admin/driver（那兩端不掛 `data-da-theme`，改 CSS 就會變，會給人錯誤的成功訊號）。

**順序陷阱**：視覺基線必須在**四處皆為舊色**時拍。若先改 fixture 再拍基線，乘客端會拍到新舊混合的狀態，基線本身就是壞的。

### D3 — 節日包色值重新校準

三套節日包（christmas / lunar-new-year / summer）當初是配著舊底色（`#F5F2EC` 米白 + `#D4860A` 琥珀）定的。底色換成骨白後，那些紅／金／綠會失衡。

本變更**一併重定三套色值**，並於 admin `/admin/settings` 逐套切換目視驗收。

### D4 — token 層位置與注入

沿用既有 `scss-tool/` 先例（`typography.scss` 已是 font-size token 且有明文紀律）。

- `css-class/_design-tokens.css`（新）— **真相來源**，純 CSS custom properties
- `scss-tool/tokens.scss`（新）— SCSS 別名（`$ff-display: var(--ff-display)` 之類），供既有 SCSS 語法沿用
- `nuxt.config.ts` 的 vite `additionalData` 加入 `tokens.scss`
- `_design-tokens.css` 由 `css-class/index.css` 匯入

字族 token 用 **CSS custom properties 而非純 SCSS 變數** —— 成本相同，但保留了「將來後台可切字體」的可能性。

### D5 — 字族 token

```
--ff-display: 'Cormorant Garamond', 'Noto Sans TC', Georgia, serif;
--ff-ui:      'Jost', 'Noto Sans TC', -apple-system, 'PingFang TC', sans-serif;
--ff-label:   var(--ff-ui);
--ff-data:    var(--ff-ui);   /* 識別碼／金額，搭配 lining-nums tabular-nums */
```

**中文不加襯線。** 拉丁展示字走 Cormorant、中文標題落回 Noto Sans TC 700。理由：Noto Serif TC 是完整 CJK 字重，payload 代價高，而 mockup 上的視覺差異不足以justify。若 Brain 目視後仍要襯線，另開 task 先量 payload。

**識別碼規則**（來自 mockup 驗收）：車牌、訂單號、航班、電話、金額、時間一律 `--ff-data` + `font-variant-numeric: lining-nums tabular-nums`；襯線只給人名與標題。本階段**只定義 token 與 utility class**，實際套用在後續階段。

### D6 — 斜紋 token 的處置

`--da-stripe-yellow` / `--da-stripe-dark` 全站僅 16 處使用，且新方向讓斜紋退場。本階段**不刪**（刪了那 16 處會破圖），改為指定精品調的替代值（暗銅 / 縞黑），視覺上自然弱化。實際移除歸屬「玻璃與斜紋退場」階段。

### D7 — 只定義不替換的維度

以下 token 本階段**只在 `_design-tokens.css` 宣告**，既有程式碼不動：

| 維度 | 收斂目標 | 現況 |
|------|---------|------|
| 圓角 | 5 個（`--r-pill` `--r-round` `--r-tile` `--r-card` `--r-sm`） | 656 次、12 種值（`100px` 與 `999px` 同義、`50%` 為圓形） |
| 陰影 | 3 階（`--shadow-soft` `--shadow-lift` `--shadow-none`） | 81 次 |
| z-index | 6 層語意（`--z-base` `--z-sticky` `--z-header` `--z-overlay` `--z-modal` `--z-toast`） | 72 次、13+ 種值（含 `9999` `1200` `1000`） |
| 動效 | 3 階 + 1 easing（`--dur-fast` 150ms / `--dur-base` 200ms / `--dur-slow` 300ms / `--ease-out`） | `0.15s`×245、`0.2s`×56、`0.3s`×25、`0.1s`×27… |
| 斷點 | 4 個（`--bp-sm` 480 / `--bp-md` 768 / `--bp-lg` 1024 / `--bp-xl` 1280） | 9 種混用（320/360/480/560/600/640/720/768/900） |
| 觸控 | `--tap: 44px` | 全站僅 2 處 |

理由：一個視窗塞太多替換會讓破圖無法歸因。定義是零成本，替換排進後續階段順路做。

### D7b — `@nuxt/fonts` 看不到 CSS 變數裡的字體名（W0.1 實測擋下）

字族改由 `--ff-display` 等 CSS custom property 持有後，`@nuxt/fonts@0.14.0` 預設**只掃 `font-family:` 屬性**，看不到寫在 custom property 裡的字體名 → 不產生 `@font-face`、不下載字檔、畫面靜默 fallback 到系統字。

實測：`_design-tokens.css` 確實進了 `entry.css`（`--ff-display:"Cormorant Garamond",…` 在產物裡），但全產物找不到對應的 `@font-face`，而既有的 Bebas Neue 有（因為它是被 `font-family:` 直接宣告的）。

**解**：`fonts.experimental.processCSSVariables: true`。

這一點對後續階段同樣關鍵 —— W0b 把 441 行改成 `font-family: var(--ff-display)` 之後，靜態掃描一樣解析不出 `var()` 指向哪支字體，只有這個開關能救。**若此選項在未來版本移除或失效，備案是在 `_design-tokens.css` 保留一段字面宣告供掃描器辨識。**

### D7d — `Noto Sans TC` 從來沒有被自架（W0b 驗產物時發現）

D5 寫「中文標題落回 Noto Sans TC 700」。W0b 驗證產物時發現**這句話目前是空的** ——
`Noto Sans TC` 列在 `fonts.families` 裡，但 `.output/public/static/*.css` 的 64 個 `@font-face`
全部是 Cormorant（40）與 Jost（24），CJK 一個都沒有。

原因是 provider 的 subset 命名對不上：bunny 把 CJK 切成 `"0"` `"6"` `"7"` … 上百個數字 subset，
而 `@nuxt/fonts@0.14.0` 內建認得的 subset 只有 `cyrillic-ext / cyrillic / greek-ext / greek /
vietnamese / latin-ext / latin`。配不到就靜默跳過 —— 不報錯、不警告、build 全綠。

**這不是 W0b 造成的。** 佐證：W0.1 記錄「加入 Cormorant + Jost 後字檔 98 → 162 個」，
增量 64 正好等於 Cormorant 40 + Jost 24，也就是那 98 個全是 Bebas + Barlow + Barlow Condensed
共 9 個拉丁字重的 subset，CJK 佔 0。W0b 移除那 9 個字重後剩 64 個，與 `@font-face` 數一致。

**影響**：中文一律走使用者系統字（Mac 蘋方 / Windows 微軟正黑）。
好處是 CJK payload = 0；代價是中文字重與行高跨平台不一致，且「中文標題 700」實際拿到什麼
取決於系統有沒有那個字重。

**本階段不動**。自架 CJK 是獨立的 payload 決策（Noto Sans TC 單一字重就是數百個 subset 檔），
與「換色票與字體」不同量級，交由 Brain 判斷。

**這一條與 D7b 是同一類陷阱**：字體管線的失敗都是靜默的，`pnpm build` 綠不代表字體有下載。
凡動字體，驗收條件一律是「grep 產物的 `@font-face`」，不是「build exit 0」。

### D7c — `--da-gray-light` 提高對比（順手修既有缺陷）

實測 10 組色對，9 組過 WCAG AA，唯一未過的是三級文字 `--da-gray-light`：新值 `#A6A198` 於瓷白只有 **2.32:1**，連非文字的 3.0 都沒到。

查舊值 `#B8B3AC` 於舊瓷白是 **1.96:1** —— 這是既有缺陷，不是本次引入。既然正在換色，改用 `#868073`（瓷白 3.54:1 / 骨白 3.18:1 / 縞黑上 4.74:1，三種底皆過）。

**代價**：視覺上比舊值重一階，「輕盈感」減少。列入目視驗收項目。

### D8 — 視覺回歸基線

Playwright 已有三個 project（chromium / Pixel 5 / iPhone 14）、`testDir: ./tests/e2e`。新增 `tests/e2e/visual/` 用 `toHaveScreenshot()`。

覆蓋頁面（三端各取關鍵路徑）：

```
乘客   /  /booking  /orders  /fare  /vehicles
司機   /driver/dashboard  /driver/trip
Admin  /admin/orders  /admin/dashboard  /admin/settings
```

10 頁 × 3 project = 30 張基線。

**流程**：改動前跑一次產生基線並 commit → 換色票 → 再跑 → **逐張人工確認「變得對」**（預期全部 diff，這不是失敗）→ 接受新基線並 commit。

需處理不穩定源：動畫（`prefers-reduced-motion` 或停用動畫）、時間字串、需登入的頁（用 `NUXT_PUBLIC_TEST_MODE`）。若某頁 flaky 無法在本視窗穩定，**移出基線清單並記錄**，不阻斷。

### D9 — `!important` 只盤點不修

57 處逐一分類：

- **A 類**：宣告了色彩／字體屬性 → **會擋 token**，換色票後原地不動
- **B 類**：宣告 layout / spacing → 不影響本階段

只產出 `openspec/changes/2026-08-25-design-token-foundation/important-audit.md` 清單。修理另開變更。驗收時 A 類點位明確標示為「已知未變色」，不列為 bug。

## 遷移

```
1. 前置：確認 bunny 供 cormorant-garamond / jost（阻斷性）
2. 拍視覺基線 → commit（此時仍是舊色）
3. 建 token 層 → 換色票（CSS + shared/site-theme.ts）→ 換字體 → 收斂第二真相來源
4. 跑 migration 更新 prod site_themes（4 套主題包色票）
5. lint / test / build → 視覺 diff 人工確認 → 接受新基線
6. commit + push origin main（= prod）
7. prod 驗證：乘客端（吃主題注入）、司機端、admin 端三端目視
```

**回滾**：還原 `_theme-colors.css` + `shared/site-theme.ts` + 重跑 migration 帶舊色。token 層與視覺基線可保留（它們本身無害且有價值）。
