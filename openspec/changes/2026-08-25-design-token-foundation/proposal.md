# Design Token Foundation — 設計 token 單一真相來源 + 精品調色票與字體換裝

> Brain AI（架構師）與 Claude（Execution AI）2026-08-25 鎖定。
> 這是「介面方向改版」的**階段 0**：只換 token 與字體，**不動任何版面與元件**。
> 視覺方向提案見 artifact `Private Terminal`（縞黑 · 骨白 · 古銅）。

## Why

介面方向要從「美式復古琥珀」轉向「精品調」（縞黑 `#1A1917` / 骨白 `#EAE7E0` / 古銅 `#9C7C3C`）。全面改版估 13–18 視窗，風險太高、回頭成本太大。

**但這件事有一個異常划算的起手式** —— 全站色彩其實已經接好一大半線：

| | 數量 |
|---|---|
| `var(--da-*)` 已走 token | **940 處** |
| 硬編色碼未走 token | **537 處** |
| **已接線比例** | **64%** |

也就是說，**改 `_theme-colors.css` 那 12 行變數，全站有 64% 立刻變色**，不必碰任何頁面。用一個視窗就能看到真實 app 在新方向下長什麼樣 —— 而不是看 mockup。方向對就往下走，方向錯就還原 12 行。

同時，這次必須碰的檔案剛好覆蓋了幾筆長年技術債，順手收掉的邊際成本接近零：

- **字體堆疊沒有單一來源**：441 行內嵌 `font-family` + `$font-*` 在 **46 個檔各自重複宣告**。要換字體，這一項不收斂，階段 0 本身就會很痛。
- **色彩有兩個真相來源**：`css-class/_theme-colors.css` 與 `scss-tool/colors.scss` 並存，且前者檔頭第一行寫著「要記得去 scss/_colors.scss 添加」—— 設計成需要手動同步，drift 是時間問題。
- **`:root.dark` 是死碼**：內容與 `:root` 一字不差，但 `@nuxtjs/color-mode` 掛著，會誤導後人以為有深色模式。
- **57 處 `!important`**：CLAUDE.md 明文禁止，而且**它會蓋掉 token** → 換色票時這些點可能原地不動，造成「為什麼這塊沒變色」。
- **沒有視覺回歸防護網**：610+ 測試全是邏輯測試。而全站 49% 的程式碼是 `<style>`（26,593 行 / 54,733 行）。動全站色彩而無截圖比對，破圖會靜默發生。

## What Changes

### 核心概念：token 層是唯一真相來源

CSS custom properties 為真相來源，SCSS 變數只做別名。沿用專案既有的 `scss-tool/typography.scss` 先例（該檔已明文規定「新元件只能從這裡挑字級，禁止 hard-coded px」），把同一套紀律擴到色彩、字族、圓角、陰影、z-index、動效、斷點、觸控高度。

### 已鎖定的決策（不需再拍板）

| 項目 | 決策 |
|------|------|
| token 命名 | **保留 `--da-*` 名稱只換值**，另加語意別名層指回 `--da-*`。不重命名（940 處使用零風險，且主題引擎白名單不必動） |
| 中文襯線 | **不加 Noto Serif TC**。拉丁展示字走 Cormorant Garamond、中文標題續用 Noto Sans TC 700。避免多背一整套 CJK 字重 |
| 替換範圍 | **只實際替換色票與字體**。圓角／陰影／z-index／動效／斷點／tap **只定義 token 不替換**，後續階段順路換 |
| `!important` | **只盤點不修**。產出「會擋 token 的點」清單交付，修理另開 |
| 視覺基線 | **改之前先拍**。Playwright 三個 project × 三端關鍵頁 |
| 深色模式 | `:root.dark` 死碼**移除**。要做深色模式另開變更 |

### 必須同步處理的地雷（已實測確認）

`shared/site-theme.ts` 的 `DEFAULT_TOKENS` 硬編了現行 12 個色碼，且 prod Firestore `site_themes/default` 已於 2026-07-30 seed 了同一組舊色。主題引擎會把它注入 `[data-da-theme]`（掛在乘客 layout）。

**只改 `_theme-colors.css` 而不同步這兩處，乘客端會被舊色蓋回去。** 因此本變更必含：

1. `shared/site-theme.ts` 的 `DEFAULT_TOKENS` + `DEFAULT_SITE_THEMES` 同步換色
2. **prod Firestore migration**：更新 `site_themes/default.tokens` 為新色票
3. 三套節日包（christmas / lunar-new-year / summer）色值重新校準到新底色

### 新增 / 修改檔案（總覽，逐步驟見 tasks.md）

| 檔案 | 動作 |
|------|------|
| `app/assets/styles/css-class/_design-tokens.css`（新） | 全部 CSS custom properties：色彩／字族／圓角／陰影／z-index／動效／斷點／tap |
| `app/assets/styles/scss-tool/tokens.scss`（新） | SCSS 別名指回 CSS vars，供既有 SCSS 語法使用 |
| `app/assets/styles/css-class/_theme-colors.css`（改） | 12 個 `--da-*` 換值；移除 `:root.dark` 死碼；刪掉誤導註解 |
| `app/assets/styles/scss-tool/colors.scss`（改） | 收斂 9 個樣板遺留變數（全站僅 20 處使用） |
| `nuxt.config.ts`（改） | fonts families 換血；vite `additionalData` 掛入新 token 層 |
| `shared/site-theme.ts`（改） | `DEFAULT_TOKENS` + 四套主題包色值同步 |
| `scripts/migrate-site-themes.ts`（新） | prod Firestore `site_themes` 色票 migration |
| `tests/e2e/visual/*.spec.ts`（新） | 視覺回歸基線 |
| 46 個宣告 `$font-*` 的 `.vue`（改） | 移除本地宣告，改用 token |
| 441 行內嵌 `font-family`（改） | codemod 換成 token |

## 不在本變更

- 版面、資訊架構、元件重排（首頁 app 化、司機端、admin 17 頁）
- 語意色三件套（good / wait / note / stop）導入
- 玻璃退場（`var(--da-glass-*)` 86 處 + `backdrop-filter` 65 處）
- 537 處硬編色碼清掃
- Element Plus `--el-*` 橋接
- 後台色票編輯 UI（`themes/[id]/tokens.patch.ts` + 輸入介面）
- 修理 57 處 `!important`
- 深色模式

## 風險

| 風險 | 緩解 |
|------|------|
| **bunny 沒有 Cormorant Garamond / Jost** → build 掛（前例：gstatic 對 CJK 回 404 害 Vercel 部署失敗） | **W0.1 為阻斷性前置**：確認字體可取得且 `pnpm build` 綠，才准往下 |
| 字體 payload 增加拖慢 LCP | 移除 Bebas Neue／Barlow／Barlow Condensed（換裝後應零引用）；不加 CJK 襯線；W0.9 量測前後 payload |
| 57 處 `!important` 造成局部未變色 | 盤點成清單交付，驗收時明確標示「已知未變色點」，不當成 bug |
| 全站色彩變動造成靜默破圖 | 視覺基線先行；驗收時逐張人工確認「變得對」而非「有變」 |
| 主題引擎把舊色蓋回乘客端 | 三處同步 + prod migration，且 W0.11 必須在 prod 實際目視乘客端 |
