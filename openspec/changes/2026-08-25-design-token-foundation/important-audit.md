# `!important` 盤點（W0.16）

> **只記錄，不修**。修理另開變更（design.md D9）。
> 產出時間：2026-08-26（W0b）。掃描範圍 `app/`，工具 `grep -rn "!important" app/`。

## 為什麼要有這份清單

`!important` 的優先權高於一般宣告，所以**當一個 `!important` 直接寫死了色碼或字體名，換 token 對它無效**——
那個點會在色票／字體換裝後原地不動。驗收時看到「這塊沒變色」，要先來這裡查，
查得到就是**已知未變色點**，不是缺陷。

## 統計

| 項目 | 數量 |
|------|------|
| `grep` 命中行 | 56 |
| 扣除非宣告（1 行散文註解、1 行被 `/* */` 註解掉） | −2 |
| 加回單行雙宣告（`TrafficChart.client.vue:112`） | +1 |
| **實際生效的 `!important` 宣告** | **55** |
| 其中 **A 類**（宣告色彩或字族） | 8 |
| 其中 **A 類且硬編色**（= 真正會擋 token） | **5** |
| 其中 **A-次要**（宣告字級，本階段不替換尺度 token，故尚未被擋） | 12 |
| 其中 **B 類**（版位／間距／z-index／互動） | 35 |

檔案分布：`element-plus/_style.css` 17 · `el/dialog-plus.vue` 10 · `el/drawer-plus.vue` 5 ·
`_scroll.css` 4 · `admin/orders/index.vue` 4 · `el/image-plus.vue` 3 ·
`plugins/not-use/_lock-img-download.client.ts` 3 · `element-plus/_theme.css` 3 ·
`el/popover-plus.vue` 2 · `TrafficChart.client.vue` 2 · `loading/page.vue` 1 · `admin/audit-logs/index.vue` 1

---

## A 類 — 宣告色彩或字族

### A-1 已知未變色點（硬編色 + `!important` → 換色票無效）

**這 5 處就是驗收時「為什麼這塊沒變色」的完整答案。**

| # | 檔案:行 | 宣告 | 說明 |
|---|---------|------|------|
| 1 | `app/components/el/dialog-plus.vue:149` | `color: #fff !important` | `[type="edit"]` 彈窗標題文字。底色是 `var(--accent)`（會變成古銅），白字對古銅 5.10:1 → 仍過 AA，視覺可接受 |
| 2 | `app/components/el/dialog-plus.vue:152` | `color: #fff !important` | 同上，關閉鈕 icon |
| 3 | `app/pages/admin/orders/index.vue:3573` | `background: #1a1a2e !important` | 原生 `<select>` 的 `<option>` 深色底。註解已載明：scoped hash 對 option 不一定生效，故刻意用 unscoped + `!important` |
| 4 | `app/pages/admin/orders/index.vue:3574` | `color: #fff !important` | 同上，option 文字 |
| 5 | `app/pages/admin/orders/index.vue:3577` | `color: rgba(255,255,255,.4) !important` | 同上，disabled option 文字 |

> #3–#5 三處連在一起，實際表現是「admin 訂單頁的下拉選單維持深藍黑（`#1a1a2e`），不隨精品調變成縞黑（`#1A1917`）」。
> 兩色極接近，肉眼幾乎分不出，但它確實是站上唯一沒被 token 收編的深色面。

### A-2 已接線，`!important` 無害（值本身就是 token）

`!important` 只是提升強度以壓過 Element Plus 預設，值走的是 token，換色票照樣生效。留著記錄，避免下次盤點誤判。

| 檔案:行 | 宣告 |
|---------|------|
| `app/assets/styles/css-class/element-plus/_style.css:73` | `color: var(--ink-soft) !important` — W0b 修：原為 `var(--gray-300)`，該變數全站無定義，等於這條長年失效 |
| `app/components/el/dialog-plus.vue:138` | `color: var(--accent) !important` — W0b 修：原為已移除的 `var(--primary)` |
| `app/components/el/dialog-plus.vue:141` | `color: var(--accent) !important` — 同上 |

### A-3 字級（本階段尺度 token「只定義不替換」，故尚未被擋）

等後續階段真的把 `font-size` 收進 token 時，這 12 處會變成 A-1 那種問題。先記著。

| 檔案 | 行 | 宣告 |
|------|----|------|
| `element-plus/_theme.css` | 4 | `--el-font-size-base: 1.125rem !important` |
| `element-plus/_theme.css` | 6 | `--el-font-size-small: 0.875rem !important` |
| `element-plus/_theme.css` | 8 | `--el-checkbox-font-size: 1rem !important` |
| `element-plus/_style.css` | 25 | `font-size: var(--el-font-size-base) !important` |
| `element-plus/_style.css` | 30 | `font-size: var(--el-font-size-base) !important` |
| `element-plus/_style.css` | 34 | `font-size: var(--el-font-size-base) !important` |
| `element-plus/_style.css` | 39 | `font-size: var(--el-font-size-large) !important` |
| `element-plus/_style.css` | 49 | `font-size: 16px !important` |
| `element-plus/_style.css` | 62 | `font-size: 16px !important` |
| `element-plus/_style.css` | 72 | `font-size: var(--el-font-size-small) !important` |
| `element-plus/_style.css` | 82 | `font-size: 18px!important`（缺空格，順手記著） |
| `element-plus/_style.css` | 89 | `font-size: 20px !important` |

> **沒有任何一處 `font-family: … !important`。** 這是本次字體換裝的好消息：字族換裝零阻擋點。

---

## B 類 — 版位／間距／互動（不影響本階段）

| 檔案 | 行 | 宣告 |
|------|----|------|
| `element-plus/_style.css` | 4 | `line-height: 30px !important` |
| `element-plus/_style.css` | 12 | `width: 100% !important` |
| `element-plus/_style.css` | 13 | `margin: unset !important` |
| `element-plus/_style.css` | 77 | `margin-bottom: 0 !important` |
| `element-plus/_style.css` | 83 | `line-height: 30px !important` |
| `element-plus/_style.css` | 94 | `outline: none !important` — 值得注意：這會拿掉焦點框，是**無障礙隱憂**，非本階段範圍 |
| `element-plus/_style.css` | 105 | `z-index: 90000 !important` — 現況最大 z-index，遠超 `--z-toast: 2000`；後續 z-index 收斂時的頭號對象 |
| `_scroll.css` | 10 | `background-clip: padding-box !important` |
| `_scroll.css` | 11 | `border: 1px solid transparent !important` — 含 border 但色為 `transparent`，無色可換，故不列 A |
| `_scroll.css` | 12 | `cursor: pointer !important` |
| `_scroll.css` | 13 | `border-radius: 0 !important` |
| `TrafficChart.client.vue` | 112 | `width: 100% !important` |
| `TrafficChart.client.vue` | 112 | `height: 100% !important` |
| `el/dialog-plus.vue` | 100 | `margin: 0 !important` |
| `el/dialog-plus.vue` | 101 | `padding: 0 !important` |
| `el/dialog-plus.vue` | 108 | `width: 95% !important` |
| `el/dialog-plus.vue` | 109 | `height: unset !important` |
| `el/dialog-plus.vue` | 115 | `padding: 10px 20px !important` |
| `el/dialog-plus.vue` | 129 | `padding: 10px 20px !important` |
| `el/drawer-plus.vue` | 93 | `padding: 0 !important` |
| `el/drawer-plus.vue` | 96 | `padding: 10px !important` |
| `el/drawer-plus.vue` | 97 | `margin: 0 !important` |
| `el/drawer-plus.vue` | 104 | `padding: 10px 20px !important` |
| `el/drawer-plus.vue` | 105 | `margin: 0 !important` |
| `el/image-plus.vue` | 26 | `width: …!important`（JS 字串組出的 inline style） |
| `el/image-plus.vue` | 30 | `padding-top: …!important`（同上） |
| `el/image-plus.vue` | 34 | `height: …!important`（同上） |
| `el/popover-plus.vue` | 33 | `width: 100% !important` |
| `el/popover-plus.vue` | 34 | `margin-left: 0 !important` |
| `loading/page.vue` | 46 | `opacity: 0 !important` |
| `admin/audit-logs/index.vue` | 393 | `padding: 16px 20px !important` |
| `plugins/not-use/_lock-img-download.client.ts` | 11 | `-webkit-touch-callout: none !important` |
| `plugins/not-use/_lock-img-download.client.ts` | 12 | `-webkit-user-select: none !important` |
| `plugins/not-use/_lock-img-download.client.ts` | 13 | `user-select: none !important` |

> `plugins/not-use/` 目錄名已寫明是停用的，那 3 處等同死碼 —— 清理時可一併移除整個檔。

---

## 非宣告（掃描命中但不是 CSS 宣告）

| 檔案:行 | 內容 |
|---------|------|
| `element-plus/_style.css:78` | `/* line-height: 16px !important; */` — 已被註解掉 |
| `app/pages/admin/orders/index.vue:3566` | 散文註解，說明為何 option 需要 unscoped + `!important` |

---

## 附帶：token 化的其他已知例外（非 `!important`，但同樣「不吃 token」）

盤 `!important` 的過程順帶撞到的，一併記著，避免驗收時當成漏改。

| # | 位置 | 為什麼吃不到 token | 影響 |
|---|------|-------------------|------|
| 1 | `app/utils/tinymce-config.ts` `content_style` / `font_family_formats` | TinyMCE 把編輯區渲染在自己的 iframe，拿不到本頁 `:root` 的 `--ff-*`，也套不到自架 `@font-face` | 僅「編輯中的預覽」是系統字；發布後的內容在站上走 `rich-content.scss`（已 token 化），正常 |
| 2 | `app/composables/use-richmenu-composer.ts:194` `ctx.font` | canvas 的 `ctx.font` 不解析 `var()` | richmenu 圖片合成用的字體來自 `layer.fontFamily` 資料。W0b 已把選單選項換成本站實際載入的 Cormorant / Jost；**Firestore 裡存著舊字體名（Bebas Neue / Barlow Condensed）的既有 richmenu，合成時會 fallback 成系統字，需 admin 重選** |
| 3 | `app/composables/system/use-inapp-browser/inapp-browser-block.vue:48-52` | 元件內自帶 5 個區域變數（`--green` `--border` `--text` `--gray` 等硬編色） | 這是「偵測到 in-app 瀏覽器」的全屏阻擋畫面，刻意獨立於設計系統以確保任何情況都能顯示。維持原樣 |
| 4 | `app/pages/admin/orders/index.vue` 等 10 個檔的區域 `$bg: #0d0f14` | SCSS 區域變數遮蔽，且 `rgba($bg, 0)` 需要真實色值（`rgba(var(--x), 0)` 在 Dart Sass 會編譯失敗） | admin／司機端深色面維持 `#0d0f14`。屬「537 處硬編色清掃」階段的範圍 |
