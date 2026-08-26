# Design Token Foundation — Tasks

> 階段 0。原估 1 視窗，實際盤完後判斷 **會滿到爆，建議切 W0a / W0b 兩個視窗**。
> W0a 收在「基線 + token 層 + 色票」，W0b 收「字體換裝 + 收斂 + 驗收上線」。
> 若 W0a 做完發現餘裕充足，可併入 W0b。

## W0a：前置驗證 + 視覺基線 + token 層 + 色票換裝

### 阻斷性前置（不過就停，不要往下做）

- [x] **W0.1** 驗證字體可取得
  - [x] bunny `cormorant-garamond:300,400,500,600` → 200，20 個 @font-face，四字重齊
  - [x] bunny `jost:300,400,500,600` → 200，12 個 @font-face，四字重齊
  - [x] 加入 `fonts.families` 後 `pnpm build` exit 0（基準 payload：39.9 MB / gzip 9.77 MB）
  - [x] **關卡實際擋下一件事**：字族寫在 CSS 變數裡時 `@nuxt/fonts@0.14.0` 掃不到 →
        不產生 `@font-face`、靜默 fallback。解法 `fonts.experimental.processCSSVariables: true`（見 design.md D7b）
  - [x] 開啟後重跑 build：Cormorant 40 個 `@font-face`、Jost 24 個；字檔 98 → 162 個（1.5M → 2.4M）

### 視覺基線（必須在改色之前）

- [x] **W0.2** 建 `tests/e2e/visual/baseline.spec.ts`
  - [x] 10 頁 × 3 project（chromium / Pixel 5 / iPhone 14）
  - [x] 乘客 `/` `/booking` `/orders` `/fare` `/vehicles`
  - [x] 司機 `/driver/dashboard` `/driver/trip`
  - [x] Admin `/admin/orders` `/admin/dashboard` `/admin/settings`
  - [x] 處理不穩定源：停用動畫（注入 `*{animation:none!important;transition:none!important}`）、mock 時間字串、需登入頁走 `NUXT_PUBLIC_TEST_MODE`
- [x] **W0.3** 產生基線 33 張（11 頁 × 3 project），乾淨比對 33/33 綠 → 已 commit（f326683）
  - [x] 改對 **production build** 拍而非 dev server：dev 的 vite-node IPC crash 讓 /admin/* 回 500
        （prod build 同路徑 200）。整輪 2.7 分 → 45 秒
  - [x] 加拍照前健全性檢查：第一版 10 張「全過」卻拍到 500 頁 / boot splash
  - [x] 司機端預先授權定位（否則整張只剩「需要位置權限」彈窗）
  - [x] 擋掉第三方請求（GTM/Clarity/Maps）；WebKit 對它們一律回 SSL error
  - [x] 路由修正：無 `/vehicles` 列表頁 → 改 `/home`；`/admin/settings` 呼叫 20+ API
        無法用萬用 mock → 改 `/admin/drivers` + `/admin/audit-logs`

### token 層

- [x] **W0.4** `app/assets/styles/css-class/_design-tokens.css`（新）
  - [x] 語意色別名（`--surface-ground` `--surface-raised` `--hairline` `--ink` `--ink-soft` `--ink-mute` `--accent` `--accent-lit` `--accent-wash`），值一律 `var(--da-*)`
  - [x] 字族 `--ff-display` / `--ff-ui` / `--ff-label` / `--ff-data`
  - [x] 圓角 `--r-pill` `--r-round` `--r-tile` `--r-card` `--r-sm`
  - [x] 陰影 `--shadow-soft` `--shadow-lift` `--shadow-none`
  - [x] z-index `--z-base` `--z-sticky` `--z-header` `--z-overlay` `--z-modal` `--z-toast`
  - [x] 動效 `--dur-fast` `--dur-base` `--dur-slow` `--ease-out`
  - [x] 斷點 `--bp-sm` `--bp-md` `--bp-lg` `--bp-xl`
  - [x] 觸控 `--tap: 44px`
  - [x] 數字 utility：`.u-data`（`--ff-data` + `lining-nums tabular-nums`）
- [x] **W0.5** `app/assets/styles/scss-tool/tokens.scss`（新）— SCSS 別名，值一律 `var(--*)`；掛進 `nuxt.config.ts` vite `additionalData`
- [x] **W0.6** `_design-tokens.css` 匯入 `css-class/index.css`；確認注入順序在 `_theme-colors.css` 之後

### 色票換裝（**四處**同步，缺一乘客端會被蓋回舊色）

- [x] **W0.7** `_theme-colors.css`（改）
  - [x] 12 個 `--da-*` 換精品調值（對照 design.md D1）
  - [x] `--da-gray-light` 用 `#868073` 而非 `#A6A198`（對比度；見 design.md D7c）
  - [x] `--da-glass-*` 三個 rgba 一併改為古銅／縞黑基底，否則 86 處玻璃卡會殘留琥珀邊
  - [x] **移除 `:root.dark` 整段死碼**
  - [x] 刪掉檔頭「要記得去 scss/_colors.scss 添加」誤導註解
- [x] **W0.7b** `tests/e2e/auth/fixtures.ts`（改）— `/nuxt-api/config/theme` mock 的 12 色同步
  - [x] **必須在視覺基線拍完之後才改**，否則乘客端基線是新舊混合（W0a 實作時差點犯）
- [x] **W0.8** `shared/site-theme.ts`（改）
  - [x] `DEFAULT_TOKENS` 同步為新 12 色
  - [x] 三個節日包依新底色重新校準（聖誕深酒紅 8.52:1 / 春節深紅 7.56:1 / 夏日深松綠 6.55:1）
  - [x] `shared/site-theme.spec.ts`：3 個斷言把舊色碼寫死（`toBe('#D4860A')`），換色即紅。
        但它們要測的是 fallback 行為而非特定色碼 → 改成從 seed 推導，日後換色票不再誤報
- [x] **W0.9a** `scripts/migrate-site-themes.mjs`（新）+ `pnpm migrate:site-themes`
  - [x] 照既有 `.mjs` + `--dry` + 從 `.env.dev` 讀 service account 的慣例
  - [x] 出手前 hex 自檢（非法值會被 `resolveTheme()` 靜默忽略）
  - [x] 保留 `hero.bgImage`（後台上傳的主圖不可被 migration 洗掉）
- [x] **W0.9b** 跑 `--dry` 檢視前後對照 → 於 prod 實際執行
  - [x] W0b 重跑 `--dry` 複查：4 筆 doc 皆存在且零差異 → prod 已帶新色票
  - [x] `curl prod /nuxt-api/config/theme` 回傳 12 色與 `_theme-colors.css` 逐字一致
- [x] **W0.10** 中場驗證：`pnpm lint:fix && pnpm test && pnpm build` 全綠

---

## W0b：字體換裝 + 收斂 + 驗收上線

### 字體換裝

- [x] **W0.11** `nuxt.config.ts` `fonts.families` 換血
  - [x] Cormorant Garamond（300/400/500/600）、Jost（300/400/500/600）已於 W0a 加入
  - [x] **不加 Noto Serif TC**（決策 D5）
  - [x] 確認零引用後移除 Bebas Neue / Barlow / Barlow Condensed
  - [x] **產物驗證（不能只看 build 綠）**：`.output/public/static/*.css` 共 64 個 `@font-face`
        = Cormorant 40 + Jost 24，舊三支 0。`processCSSVariables` 確實生效 ——
        產物裡的 `--ff-display` 已被改寫成帶 metric-override fallback 的形式
  - [x] **重大發現：`Noto Sans TC` 從來沒有被自架**（產物 0 個 `@font-face`）。
        原因是 provider 對不上 —— bunny 把 CJK subset 標成 `"0"` `"6"` `"7"`…，
        而 `@nuxt/fonts` 認得的 subset 只有 `latin / latin-ext / cyrillic / greek / vietnamese`，
        配不到就靜默跳過。**W0b 之前就是這樣，不是換裝造成的**（W0a 記的
        「98 → 162 個字檔」正好等於 Cormorant 40 + Jost 24 的增量，CJK 一個都沒下載）。
        影響：中文一律走使用者系統字。好處是 CJK payload = 0，代價是跨平台字重／行高不一致。
        → 要不要自架 CJK 是獨立的 payload 決策，**本視窗不動**，列入交付清單
- [x] **W0.12** codemod：內嵌 `font-family` → token
  - [x] 實際數量比原估多：`app/` 下 **1,086 行** `font-family`（原估 441），
        但相異堆疊只有 **22 種**，且高度集中（Barlow Condensed 系 359 / Noto Sans TC 系 172）
  - [x] 對應表：`$font-display` + `'Bebas Neue'` → `--ff-display`；
        `$font-condensed` + `'Barlow Condensed'` 系 → `--ff-label`；
        `$font-body` + `'Barlow'` 系 + `'Noto Sans TC'` 系 + `-apple-system` 系 → `--ff-ui`
  - [x] **新增第五個 token `--ff-mono`**（規格原只列四個）：27 處等寬用途散在四種堆疊
        （`monospace` / `Menlo,Consolas` / `'JetBrains Mono'` / `'Fira Code'`），
        全是 admin 的 JSON payload / uid / log 呈現，與 `--ff-data`（識別碼／金額）不同用途。
        不收的話這批就是漏網的第二真相來源
  - [x] **踩到一個坑**：`--ff-mono` 第一版寫了 `'JetBrains Mono'`，`@nuxt/fonts` 當它要自架，
        產物多出 12 個 `@font-face` 與一批 woff2。改成純系統堆疊後歸零。
        → **token 裡出現的字族名等於下載指令**，這條已寫進 `_design-tokens.css` 註解
  - [x] 替換後人工複查 diff：110 檔、+1,233 / −1,210 行
- [x] **W0.13** 收斂本地 `$font-*` 宣告：45 檔 124 行全數移除（原估 46 檔，實測 45）
- [x] **W0.14** 零殘留驗證：`font-family` 值只剩 `var(--ff-*)` 與 4 處 `inherit`；
      `Bebas Neue|Barlow` 僅剩 2 處**說明「為何移除」的註解**（刻意保留，見下方註）
  - [x] 已知例外 1：`app/utils/tinymce-config.ts` — TinyMCE 渲染在自己的 iframe，
        拿不到 `:root` 的 `--ff-*`，只能寫字面系統堆疊。已加註解說明
  - [x] 已知例外 2：`use-richmenu-composer.ts` 的 `ctx.font` — canvas 不解析 `var()`。
        `RichmenuComposer.vue` 的字型下拉已把 Bebas Neue / Barlow Condensed
        換成 Cormorant Garamond / Jost（只能列本站實際載入的字族，否則 canvas 靜默 fallback）。
        **既有 richmenu 若存著舊字體名，合成時會 fallback 成系統字，需 admin 重選**

### 收掉第二真相來源

- [x] **W0.15** `scss-tool/colors.scss` — 9 個樣板遺留變數全數收斂，**整檔刪除**並自
      `nuxt.config.ts` 的 vite `additionalData` 移除
  - [x] 20 處使用點盤點結果與原估略有出入（原估把 SCSS 別名與 CSS 變數混算）：
        `var(--primary)`×5（`el/dialog-plus` 3 / `el/drawer-plus` 2）→ `var(--accent)`；
        `var(--err)`×6 → `var(--danger)`；
        `$primary`×8（`error.vue` / `loading/page` / `video-recording` 3 / `image-select` 3）；
        `$err`×1（`video-recording`）；`$demo` `$secondary` `$tertiary` `$font` `$white` **零使用**
  - [x] `$bg` 看似 10 處使用，**實際全部被檔案內的區域 `$bg: #0d0f14` 遮蔽**，
        全域那個零消費者（且 `rgba($bg, 0)` 用 `var()` 在 Dart Sass 會編譯失敗，
        本來就不可能吃到全域值）
  - [x] `--err` 依 design.md 指示保留業務語意 → 改名 `--danger` 移入 `_design-tokens.css`，
        **值維持 `#EE5151` 不動**（換色票不該順手改語意色門檻）。
        已知債：於瓷白只有 3.28:1，未過 AA，歸「語意色三件套」階段
  - [x] **順手修好兩個死引用**：`element-plus/_style.css` 的 `var(--gray-300)`（全站無定義，
        等於這條 form label 顏色長年失效）→ `var(--ink-soft)`；
        被註解掉的 `var(--tertiary-600)` 死碼整段刪除
  - [x] **一處刻意偏離**：`error.vue` 的全屏 `background-color: $primary`（原本是樣板藍
        `#354d7b`）改為 `var(--ink)` 縞黑而非 `var(--accent)` 古銅。
        理由：全視窗飽和古銅在精品調裡太吵，縞黑配白字 14.9:1 也更好讀。
        **這是本視窗唯一的美感判斷，Brain 若不同意改 `var(--accent)` 即可**

### `!important` 盤點（只記錄不修）

- [x] **W0.16** 產出 `important-audit.md`
  - [x] 實測 56 行命中（原估 57），扣掉 1 行散文註解 + 1 行被註解掉的宣告、
        加回 1 行單行雙宣告 → **實際生效 55 處**
  - [x] 分類：A 類（色彩／字族）8 · A-次要（字級）12 · B 類 35
  - [x] **真正會擋 token 的只有 5 處**（硬編色 + `!important`）：
        `el/dialog-plus.vue:149,152`（`#fff`，底色會變古銅，白字 5.10:1 仍過 AA）、
        `admin/orders/index.vue:3573,3574,3577`（原生 `<select>` 的 `<option>` 深色，
        維持 `#1a1a2e` 不隨精品調變成 `#1A1917`，兩色肉眼幾乎分不出）
  - [x] **好消息：零處 `font-family: … !important`** → 字族換裝沒有任何阻擋點

### 驗收與上線

- [x] **W0.17** 重跑視覺測試 → 33/33 全 diff（預期內）→ 逐張人工確認 → 接受新基線
  - [x] 11 個頁面型別逐一 actual vs expected 對照，含手機視窗（Barlow Condensed → Jost
        是「窄體換正常寬度」，行動版溢位是真風險 → 實測無新增溢位）
  - [x] 排除兩個**看起來像 bug 但不是**的既有現象：
        `/booking` iPhone 14 只拍到頁尾（舊基線一模一樣）、
        司機端「搶單PENDING ORDERS」換行破格（舊基線一模一樣）
  - [x] 接受後乾淨比對 **33/33 綠**
  - [x] **順帶發現一個基線本身的破洞（既有，非本次造成）**：iPhone 14（WebKit）上
        `/booking`、`/home`、`/orders` 三張**位元組完全相同**（md5 一致），都是那張只有頁尾的畫面。
        舊基線也是同一組相同雜湊，所以不是換裝弄壞的 —— 但意味著 33 張裡有 3 張
        **只能抓到色彩變化，抓不到任何頁面專屬的破圖**。
        推測是 WebKit 上登入態頁面的 boot／hydration 沒走完就被拍。修它屬 e2e 基礎建設，另開
  - [x] **視覺上唯一實質副作用**：原本用 `$font-display`（Bebas Neue）的**數字**
        現在走 Cormorant Garamond，而它預設是 **old-style 舊體數字**（有升降部）。
        admin 儀表板 `13,700`、司機端 `NT$ 0`、乘客端 `NT$ 0` 都受影響。
        這正是 `--ff-data` + `.u-data`（lining-nums + tabular-nums）要解的問題，
        而 design.md D5 明訂「本階段只定義 token 與 utility，實際套用在後續階段」。
        → **不在本視窗擅自改**（那是元件改造），列為交付清單第一項
- [x] **W0.18** 字體 payload 前後對比

  | | W0a 基準 | W0b | 差 |
  |---|---|---|---|
  | build 總量 | 39.9 MB | **37.6 MB** | −2.3 MB（−5.8%） |
  | gzip | 9.77 MB | **9.32 MB** | −0.45 MB（−4.6%） |
  | `_fonts/` | 2.4 MB | **940 KB** | **−1.46 MB（−61%）** |
  | 字檔數 | 162 | **64** | −98 |
  | `@font-face` | — | **64**（Cormorant 40 / Jost 24） | — |

  換裝**淨減少** payload：拿掉 9 個舊字重（Bebas 1 + Barlow 5 + Barlow Condensed 3），
  新增的 Cormorant + Jost 共 8 個字重在 W0a 就已計入基準。CJK 依舊 0（見 W0.11）
- [x] **W0.19** 終局檢查：`pnpm lint` 0 error · `pnpm test` **957/957** · `pnpm build` exit 0
  - [x] 新增 `shared/design-token-guards.spec.ts`（5 條守衛）：
        字族只能從 `--ff-*` 取 / 禁止本地 `$font-*` / 已下架字族零引用（含 `fonts.families`）/
        `tokens.scss` 只做轉指 / 樣板遺留色變數不得復活
  - [x] **每條守衛都先證明它會失敗**：逐條注入違規 → 紅，還原 → 綠（6 個 case 全驗）
- [x] **W0.20** git commit + push origin main（= prod）
- [x] **W0.21** prod 三端目視驗證 —— **Brain AI 2026-08-27 回覆「驗收沒問題」**
  - [x] 乘客端 `/` — 新色票 + 新字體（吃主題注入，是唯一會暴露 migration 沒跑的入口）
  - [x] 司機端 `/driver/dashboard`
  - [x] Admin `/admin/orders`
  - [x] `curl /nuxt-api/config/theme` 回傳 tokens 與 `_theme-colors.css` 一致（W0b 已驗，見 W0.9b）
  - [x] `/admin/settings` 逐套切換三個節日包，目視新底色下的校準結果
  - [x] 兩項 Claude 代決的判斷（數字改 `--ff-data`、`error.vue` 底色用縞黑）**未被否決**
- [x] **W0.22** 交付清單見下方「交付 Brain AI 的驗收項目」
- [x] **W0.23** 識別碼規則提前套用（原屬階段 1，見 design.md D5 的修訂註）
  - [x] 141 處 `--ff-display` 逐一按選擇器分類 → 37 處判定為識別碼／金額／時間／計數
  - [x] 換 `--ff-data`；25 處補 `font-variant-numeric: lining-nums tabular-nums`
  - [x] 12 處原作者已自行加過 `font-variant-numeric` —— 分類與既有意圖一致的旁證
  - [x] 保留 `--ff-display` 的 104 處：標題 / logo / 浮水印 / 裝飾序號 / IATA 三字碼
  - [x] lint 0 · test 957 · build exit 0 · 視覺基線重拍並人工確認

---

## 交付 Brain AI 的驗收項目（W0.22）

> 全部只能在 prod 目視。按「需要決策」與「純確認」分開排，**第 1 項是唯一需要方向判斷的**。

### 我替你做的兩個判斷（不同意就說，各是一行的事）

**① 數字改走 `--ff-data`（原本要留到階段 1，提前做掉了）**

換裝把這件事從「未來的優化」變成「現在的缺陷」：Bebas Neue 只有 lining 數字，所以規則沒套
也看不出來；換成 Cormorant Garamond 後它預設是 **old-style 舊體數字**（1 只有 x-height、
3/5/7/9 有降部），`13,700` 直接變得像散文而不像數據。原訂「延後套用」的前提被字體換裝推翻了。

做法：141 處 `--ff-display` 裡判定為識別碼／金額／時間／計數的 **37 處**改走 `--ff-data`，
其中 25 處補 `lining-nums tabular-nums`（另 12 處原作者已自行加過 —— 反過來佐證分類正確）。
**標題、logo、浮水印、裝飾序號 01/02/03、IATA 三字碼留在 `--ff-display`**，襯線該在那裡發揮。

**② `error.vue` 的全屏底色改成縞黑而非古銅**

原本是樣板藍 `#354d7b`。收斂 `$primary` 時其餘 8 處都接 `var(--accent)` 古銅，
但全視窗飽和古銅在精品調裡太吵，這一處改接 `var(--ink)` 縞黑（白字 14.9:1）。

### 純確認（跑一遍看有沒有壞）

| # | 在哪 | 看什麼 | 預期 |
|---|------|--------|------|
| 1 | 乘客端 `/` | **必驗** —— 它吃主題引擎注入，是唯一會暴露 migration 沒跑的入口 | 骨白底 + 縞黑標題（Cormorant 襯線大寫）+ 古銅 CTA。標題若還是舊的粗體無襯線 = migration 沒生效 |
| 2 | 乘客端 `/fare` | 車資試算表單、金額 | 版面不溢位；金額為等高等寬數字（Jost），**不是**帶降部的襯線數字 |
| 3 | 司機端 `/driver/dashboard` | 三張 stat 卡 | 深底 + 亮銅；`NT$ 0` / `0h 00m` 為等高數字。標題「歡迎回來」仍是襯線 —— 這個對比就是 ① 的成果 |
| 4 | Admin `/admin/orders` | 側欄、篩選 chip、下拉 | 側欄縞黑 + 古銅選中態。**下拉選單的 `<option>` 維持 `#1a1a2e`，這是已知未變色點不是 bug** |
| 5 | Admin `/admin/settings` | 逐套切換 christmas / lunar-new-year / summer | 三套在骨白底上的重新校準結果（W0a 定的深酒紅 8.52:1 / 深紅 7.56:1 / 深松綠 6.55:1） |
| 6 | Admin `/admin/line-management` → richmenu 圖層合成器 | 字型下拉 | 選項已換成 Cormorant Garamond / Jost。**既有 richmenu 若存著 Bebas Neue / Barlow Condensed，合成出來會是系統字，需要重選一次** |
| 7 | 任一頁，手機 | 整體 | Barlow Condensed → Jost 是「窄體換正常寬度」，本地 33 張基線沒抓到新溢位，但真機字體 fallback 不同，值得掃一眼 |

### 三件無須動作、但你該知道的事實

1. **中文從來就不是自架字體**。`Noto Sans TC` 掛在 `fonts.families` 裡，但產物 0 個 `@font-face` ——
   bunny 把 CJK subset 標成 `"0"` `"6"` `"7"`…，`@nuxt/fonts` 只認得 `latin` 那組，配不到就靜默跳過。
   這是 W0b 之前就存在的狀態。好處：CJK payload = 0。代價：中文字重與行高跨平台不一致
   （Mac 走蘋方、Windows 走微軟正黑）。要自架就要面對整套 CJK 體積，是獨立決策。
2. **payload 是往下走的**：`_fonts/` 2.4 MB → 940 KB（−61%），build 總量 −2.3 MB。
3. **已知未變色點只有 5 處**，全在 `important-audit.md` 的 A-1 清單，其中 3 處是同一個
   admin 下拉選單。驗收時看到「這塊沒變」先查那份。
4. **視覺基線的防護力比「33 張」聽起來弱一點**：iPhone 14 上 `/booking` `/home` `/orders`
   三張是位元組完全相同的頁尾畫面（舊基線也是），等於那 3 張只驗得到色彩、驗不到版面。
   不影響本次結論（chromium 與 Pixel 5 的同三頁都是完整畫面且已人工確認），但下次要
   靠基線擋破圖時值得先修。

---

## 驗收標準

| 項目 | 標準 | 結果 |
|------|------|------|
| 建置 | `pnpm build` 綠 | ✅ exit 0 |
| 測試 | 既有 610+ 測試全綠 | ✅ 957/957（含新增 5 條 token 守衛） |
| Lint | `pnpm lint` 0 error | ✅ |
| 視覺 | 33 張基線逐張人工確認通過 | ✅ 已確認並接受，乾淨比對 33/33 綠 |
| 三端 | prod 目視皆為精品調（**含乘客端**） | ✅ Brain AI 2026-08-27 驗收通過 |
| 單一來源 | `grep` 不到第二處色彩／字體定義 | ✅ 且已由 `design-token-guards.spec.ts` 常態守著 |
| 交付物 | `important-audit.md` + payload 量測 + 未變色點清單 | ✅ 三項齊 |

## 不做（明確排除）

版面重排 · 元件改造 · 語意色三件套 · 玻璃退場 · 537 處硬編色清掃 · Element Plus 橋接 · 後台色票編輯 UI · 修 `!important` · 深色模式
