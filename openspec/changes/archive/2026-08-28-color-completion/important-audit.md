# `!important` 盤點（階段 1 更新版）

> 取代 `openspec/changes/archive/2026-08-25-design-token-foundation/important-audit.md`。
> 那份是階段 0 的「只盤點不修」快照；這份是階段 1 修完之後的狀態。
> 重新掃描時間：2026-08-27，範圍 `app/`，工具 `grep -rn "!important" app/`。

## 這份清單存在的理由

`!important` 的優先權高於一般宣告。**當一個 `!important` 直接寫死了色碼，換 token 對它無效** ——
那個點會在換色票後原地不動。驗收時看到「這塊沒變色」，先來這裡查。

## 結論：A-1 清空

| 項目 | 階段 0 | 階段 1 |
|------|-------|-------|
| 實際生效的 `!important` 宣告 | 55 | 58 |
| 其中 **A 類**（宣告色彩或字族） | 8 | 8 |
| 其中 **A-1**（硬編色 → **會擋 token**） | **5** | **0** |
| 其中 A-3（宣告字級，尺度 token 未替換前尚未被擋） | 12 | 12 |
| 其中 B 類（版位／間距／z-index／互動） | 35 | 38 |

**「已知未變色點」從 5 個變成 0 個。** 驗收時若看到某塊沒跟著變色，那是缺陷，不再有已知豁免。

## A 類 —— 8 處，全部走 token

`!important` 保留（它們的用途是壓過 Element Plus 預設或瀏覽器對 `<option>` 的強制樣式），
但值一律改成 token，因此換色票照樣生效。

| 檔案:行 | 宣告 | 說明 |
|---------|------|------|
| `element-plus/_style.css:73` | `color: var(--ink-soft) !important` | W0b 修（原為全站無定義的 `var(--gray-300)`，等於長年失效） |
| `el/dialog-plus.vue:138` | `color: var(--accent) !important` | W0b 修（原為已移除的 `var(--primary)`） |
| `el/dialog-plus.vue:141` | `color: var(--accent) !important` | 同上 |
| `el/dialog-plus.vue:151` | `color: var(--surface-raised) !important` | **階段 1 修**：原 `#fff`。彈窗標題，底色是 `var(--accent)`，瓷白字對古銅 5.42:1 |
| `el/dialog-plus.vue:154` | `color: var(--surface-raised) !important` | **階段 1 修**：原 `#fff`，關閉鈕 icon |
| `admin/orders/index.vue:3575` | `background: var(--ink) !important` | **階段 1 修**：原 `#1a1a2e`。原生 `<option>` 深色底 |
| `admin/orders/index.vue:3576` | `color: var(--surface-raised) !important` | **階段 1 修**：原 `#fff` |
| `admin/orders/index.vue:3579` | `color: var(--surface-a40) !important` | **階段 1 修**：原 `rgba(255,255,255,.4)`，disabled option |

> `<option>` 那三處為什麼可以用 `var()`：custom property 由 `<select>` 繼承給 `<option>`，
> 即使樣式寫在 unscoped `<style>` 也拿得到。它們原本是全站唯一「換色票也不會變」的深色面
> （深藍黑 `#1a1a2e` vs 縞黑 `#1A1917`，兩色極接近，肉眼幾乎分不出，但它確實沒被 token 收編）。

## A-3 —— 字級（12 處，仍待處理）

尺度 token「只定義不替換」期間它們尚未擋到任何東西。等 `font-size` 真的收進 token 時，
這 12 處會變成新的 A-1。集中在 `element-plus/_theme.css`（3）與 `element-plus/_style.css`（9）。

## B 類 —— 38 處（版位／間距／z-index／互動）

不影響色彩收尾。`element-plus/_style.css` 18 · `el/dialog-plus.vue` 9 · `el/drawer-plus.vue` 5 ·
`_scroll.css` 4 · `plugins/not-use/_lock-img-download.client.ts` 3 · `el/image-plus.vue` 3 ·
`el/popover-plus.vue` 2 · `admin/orders/index.vue` 2 · `TrafficChart.client.vue` 1 ·
`loading/page.vue` 1 · `admin/audit-logs/index.vue` 1


---

## 階段 2 增補（2026-08-27，玻璃退場 + 尺度替換）

### A 類 —— 仍為 8 處，全部走 token（不變）

階段 2 沒有新增 A 類。`admin/orders/index.vue` 的三處 `<option>` 宣告值
由階段 1 的 token 改成階段 2 的表面 token（`var(--ink)` → 仍是 `var(--ink)`，
`var(--surface-a40)` 不變），行為相同。

### A-3 —— 字級 12 處，**仍待處理**

階段 2 收的是圓角 / z-index / 陰影 / 動效，**沒有收 font-size**。
因此這 12 處尚未變成 A-1，狀態與階段 1 相同。
字級 token 化是留給後續的最後一項尺度工作。

### B 類 —— 38 處，其中 1 處改走 token

`element-plus/_style.css` 的 `.el-message { z-index: 90000 !important }`
改成 `z-index: var(--z-toast) !important`（`--z-toast` = 9500）。
`!important` 保留 —— 它的用途是壓過 EP 自己的 runtime z-index，那個目的沒變。
其餘 37 處（版位／間距／互動）不受影響。

> 為什麼 9500 夠：EP 的浮層走自己的 runtime 遞增值，起始 2000。
> 站上最高的自有層級是 `--z-gate` 9200（權限阻擋）。全域提示必須在它之上。

### 更正：`_scroll.css` 的 4 個 `!important` 不存在

階段 0 與階段 1 的 B 類清單都把 `_scroll.css` 算成 4 處。實際上該檔第 3–24 行
**整段被 `/* ... */ 註解掉**，是死碼 —— 那 4 個 `!important` 一個都沒生效。
B 類實數應為 34 而非 38。

會數錯的原因跟本階段其他幾顆是同一個：`grep -c "!important"` 不剝註解。
本階段的守衛一律先跑 `stripComments()` 才比對。
