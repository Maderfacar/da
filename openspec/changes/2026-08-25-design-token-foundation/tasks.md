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
  - [ ] 開啟該選項後重跑 build，確認產物含 Cormorant / Jost 的 `@font-face`

### 視覺基線（必須在改色之前）

- [x] **W0.2** 建 `tests/e2e/visual/baseline.spec.ts`
  - [x] 10 頁 × 3 project（chromium / Pixel 5 / iPhone 14）
  - [x] 乘客 `/` `/booking` `/orders` `/fare` `/vehicles`
  - [x] 司機 `/driver/dashboard` `/driver/trip`
  - [x] Admin `/admin/orders` `/admin/dashboard` `/admin/settings`
  - [x] 處理不穩定源：停用動畫（注入 `*{animation:none!important;transition:none!important}`）、mock 時間字串、需登入頁走 `NUXT_PUBLIC_TEST_MODE`
- [ ] **W0.3** 跑一次產生基線 → 目視確認截圖是「現況舊色且完整」→ **commit 基線**
  - [ ] flaky 且本視窗穩不下來的頁 → 移出清單並在 tasks.md 記錄原因

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

- [ ] **W0.7** `_theme-colors.css`（改）
  - [ ] 12 個 `--da-*` 換精品調值（對照 design.md D1）
  - [ ] `--da-gray-light` 用 `#868073` 而非 `#A6A198`（對比度；見 design.md D7c）
  - [ ] `--da-glass-*` 三個 rgba 一併改為古銅／縞黑基底，否則 86 處玻璃卡會殘留琥珀邊
  - [ ] **移除 `:root.dark` 整段死碼**
  - [ ] 刪掉檔頭「要記得去 scss/_colors.scss 添加」誤導註解
- [ ] **W0.7b** `tests/e2e/auth/fixtures.ts`（改）— `/nuxt-api/config/theme` mock 的 12 色同步
  - [ ] **必須在視覺基線拍完之後才改**，否則乘客端基線是新舊混合（W0a 實作時差點犯）
- [ ] **W0.8** `shared/site-theme.ts`（改）
  - [ ] `DEFAULT_TOKENS` 同步為新 12 色
  - [ ] `christmas` / `lunar-new-year` / `summer` 三包色值依新底色重新校準
  - [ ] `shared/site-theme.spec.ts` 既有測試須續綠
- [x] **W0.9a** `scripts/migrate-site-themes.mjs`（新）+ `pnpm migrate:site-themes`
  - [x] 照既有 `.mjs` + `--dry` + 從 `.env.dev` 讀 service account 的慣例
  - [x] 出手前 hex 自檢（非法值會被 `resolveTheme()` 靜默忽略）
  - [x] 保留 `hero.bgImage`（後台上傳的主圖不可被 migration 洗掉）
- [ ] **W0.9b** 跑 `--dry` 檢視前後對照 → 於 prod 實際執行
- [ ] **W0.10** 中場驗證：`pnpm lint:fix && pnpm test && pnpm build` 全綠

---

## W0b：字體換裝 + 收斂 + 驗收上線

### 字體換裝

- [ ] **W0.11** `nuxt.config.ts` `fonts.families` 換血
  - [ ] 加 Cormorant Garamond（300/400/500/600）、Jost（300/400/500/600）
  - [ ] **不加 Noto Serif TC**（決策 D5；中文標題走 Noto Sans TC 700）
  - [ ] 確認 Bebas Neue / Barlow / Barlow Condensed 零引用後移除
- [ ] **W0.12** codemod：441 行內嵌 `font-family` → token
  - [ ] 先列出所有相異字體堆疊字串（預期高度重複）
  - [ ] 逐種對應到 `--ff-display` / `--ff-ui` / `--ff-label`
  - [ ] 腳本替換後**人工複查 diff**，不可盲信
- [ ] **W0.13** 收斂 46 個檔的本地 `$font-*` 宣告（124 行）→ 全部移除，改用 token
- [ ] **W0.14** 驗證零殘留：`grep -r "Bebas Neue\|Barlow" app/ nuxt.config.ts` 結果為 0

### 收掉第二真相來源

- [ ] **W0.15** `scss-tool/colors.scss`（改）— 收斂 9 個樣板遺留變數
  - [ ] 先定位那 20 處使用點（`--demo`×1 `--primary`×6 `--err`×6 `--secondary`×1 `--tertiary`×1 `--font`×1 `--bg`×1 `--white`×1 `--gray`×2）
  - [ ] 逐點改為對應語意 token，然後刪除變數宣告
  - [ ] 若某個確實還有業務用途（如 `--err`）→ 保留但移入 `_design-tokens.css`，不留在 colors.scss

### `!important` 盤點（只記錄不修）

- [ ] **W0.16** 產出 `openspec/changes/2026-08-25-design-token-foundation/important-audit.md`
  - [ ] 57 處逐一列出：檔案:行號 / 宣告的屬性 / 分類（A=色彩或字體，會擋 token；B=其他）
  - [ ] A 類另列成「已知未變色點」清單

### 驗收與上線

- [ ] **W0.17** 重跑視覺測試 → **逐張人工確認「變得對」**（預期 30 張全 diff，此非失敗）→ 接受新基線
- [ ] **W0.18** 量測字體 payload 前後對比（`pnpm build` 產物中 fonts 目錄大小），記錄於 tasks.md
- [ ] **W0.19** 終局檢查：`pnpm lint:fix && pnpm test && pnpm build` 全綠
- [ ] **W0.20** git commit + push origin main（= prod）
- [ ] **W0.21** prod 三端目視驗證（**乘客端必驗**，它吃主題注入，是唯一會暴露 migration 沒跑的入口）
  - [ ] 乘客端 `/` — 新色票 + 新字體
  - [ ] 司機端 `/driver/dashboard`
  - [ ] Admin `/admin/orders`
  - [ ] `curl /nuxt-api/config/theme` 回傳 tokens 與 `_theme-colors.css` 一致
  - [ ] `/admin/settings` 逐套切換三個節日包，目視新底色下的校準結果
- [ ] **W0.22** 交付「已知未變色點」清單給 Brain AI，並回報方向是否值得往階段 1 走

---

## 驗收標準

| 項目 | 標準 |
|------|------|
| 建置 | `pnpm build` 綠 |
| 測試 | 既有 610+ 測試全綠 |
| Lint | `pnpm lint` 0 error |
| 視覺 | 30 張基線逐張人工確認通過 |
| 三端 | prod 目視皆為精品調（**含乘客端**） |
| 單一來源 | `grep` 不到第二處色彩／字體定義 |
| 交付物 | `important-audit.md` + payload 量測 + 未變色點清單 |

## 不做（明確排除）

版面重排 · 元件改造 · 語意色三件套 · 玻璃退場 · 537 處硬編色清掃 · Element Plus 橋接 · 後台色票編輯 UI · 修 `!important` · 深色模式
