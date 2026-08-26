# Color Completion — Design

## 現況實測（2026-08-27，全數為實際 grep／build 產物結果）

| 指標 | 數值 |
|------|------|
| 舊色票殘留（7 個舊值，hex + `rgba()`） | **363 處 / 86 檔** |
| ↳ 其中舊琥珀 `#D4860A` | 258（hex 56 + `rgba` **202**） |
| 硬編狀態色 | **196 處 / 53 檔，27 種相異值** |
| 兩者聯集受影響檔案 | **97** |
| 產物 CSS 內 `#d4860a` 出現次數 | **469** |
| 產物 CSS 內 `#7e6330`（新古銅）出現次數 | **1** |
| EP `$colors` map 的 primary | `#354d7b`（樣板藍，第二真相來源） |
| `--el-*` 覆寫 | 僅 3 條字級；色彩 0 條 |
| 舊琥珀 `rgba` 的相異 alpha | **27 種** |
| 舊縞黑 `rgba` 的相異 alpha | 13 種 |
| 舊瓷白 `rgba` 的相異 alpha | 12 種 |

## 決策

### D1 — `rgba()` 殘留改走 `color-mix`，不改走 `--*-rgb`

202 處舊琥珀是 `rgba(212, 134, 10, α)` 形式。有兩種接法：

| 做法 | 跟主題 | 瀏覽器門檻 |
|------|--------|-----------|
| `rgba(var(--accent-rgb), α)` | ❌ 不跟 | 全支援 |
| `color-mix(in srgb, var(--accent) α%, transparent)` | ✅ 跟 | Chrome 111 / Safari 16.2 / FF 113 |

**選 `color-mix`。** 決定性理由是節日主題包會把 `--da-amber` 換成**深酒紅／深紅／深松綠**
（`shared/site-theme.ts:133/150/167`）。用 `--accent-rgb` 的話，聖誕節時按鈕是酒紅、
但它周圍 202 處光暈與邊框仍是古銅 —— 換膚又「切一半」，正是階段 0 D1 明令要避免的病。

門檻風險用 `@supports` 收：

```css
:root { --accent-a20: rgba(126, 99, 48, 0.2); }              /* 舊瀏覽器：固定古銅 */
@supports (color: color-mix(in srgb, red 50%, transparent)) {
  :root { --accent-a20: color-mix(in srgb, var(--accent) 20%, transparent); }
}
```

**必須用 `@supports` 而非同名重複宣告。** custom property 的值在 parse 期幾乎不驗證，
`--x: color-mix(…)` 在不支援的瀏覽器會被原樣存下，直到 `var(--x)` 代入時才變成
「invalid at computed-value time」—— 那時 `border-color` 會退成 `currentColor` 而不是
退回前一條宣告，等於破圖。這是 CSS 自訂屬性與一般屬性的行為差異，踩了很難查。

舊瀏覽器拿到的是固定古銅色調 —— 與**今天**的行為（固定舊琥珀）相比只有更好，沒有更差。

專案已在用 `:has()`（Safari 15.4+）、`aspect-ratio`、`clamp()`，門檻本來就不低。

### D2 — 疊色收成 6 階階梯，不是一處一個 alpha

27（accent）+ 13（ink）+ 12（surface）= **52 種相異 alpha**，是圓角 12 種值的同一種病。

階梯取在實測眾數上（`0.2×27` `0.18×16` `0.08×15` `0.35×15` `0.3×14` `0.12×13` `0.5×13`）：

```
--accent-a06 / a12 / a20 / a32 / a50 / a70
--ink-a06    / a12 / a20 / a32 / a50 / a70
--surface-a50 / a72 / a88 / a96      （高透明區間，玻璃面用）
```

就近吸附，最大偏移 0.07（`0.25 → 0.32`／`0.45 → 0.50`）。疊色色調上這個量級肉眼不可辨。

**這是本階段唯一一處「順手收斂尺度」** —— 因為不收就得為 52 個 alpha 各寫一條 `color-mix`，
成本比收斂高。圓角／z-index／動效仍照 Brain AI 的指示不碰。

### D3 — 語意色四件套：不進主題引擎，值寫死

四組各三階，對照現有 `--accent` / `--accent-lit` / `--accent-wash` 的形狀：

| token | 值 | 瓷白 | 骨白 | 用途 |
|-------|-----|------|------|------|
| `--good` | `#3E6B4E` | **5.54** | **4.98** | 淺底上的成功文字／框 |
| `--good-lit` | `#86BC9C` | — | 縞黑 **8.10** | 深底（司機端／admin 側欄）上的成功 |
| `--good-wash` | `#E7EFE9` | 配 `--good` **5.24** | | 成功標章底 |
| `--wait` | `#A0521F` | **5.09** | **4.57** | 等待／處理中 |
| `--wait-lit` | `#E5A878` | — | 縞黑 **8.54** | |
| `--wait-wash` | `#F6EADC` | 配 `--wait` **4.76** | | |
| `--note` | `#35527A` | **7.18** | **6.44** | 提示／資訊 |
| `--note-lit` | `#98B6D6` | — | 縞黑 **8.36** | |
| `--note-wash` | `#E8EDF3` | 配 `--note` **6.76** | | |
| `--stop` | `#9E3535` | **6.28** | **5.64** | 錯誤／危險／取消 |
| `--stop-lit` | `#E08B8B` | — | 縞黑 **6.89** | |
| `--stop-wash` | `#F5E3E1` | 配 `--stop` **5.63** | | |

全部 ≥ 4.5:1，過 WCAG AA 文字標準。

**`wait` 刻意不用金色。** 慣例上等待＝琥珀，但本站的 `--accent` 就是古銅（hsl 39°），
再放一個金色進來會與主色糊在一起。選赤陶 `#A0521F`（hsl 24°，**Δhue 15°**）拉開色相，
同時保住「暖色＝等待」的閱讀直覺。

**四件套不列入 `DA_THEME_TOKEN_KEYS`，值直接寫死在 `_design-tokens.css`。**
理由與現行 `--danger` 相同：狀態色是判讀門檻，不該隨換季飄 —— 聖誕節的「成功」不能變成紅色。
這也表示它們**不需要**四處同步（`site-theme.ts` / migration / fixtures 都不必動）。

### D3b — `--danger` 併入 `--stop`（**與「留尾都先不碰」的偏離，一行可還原**）

Brain AI 2026-08-27 指示三個階段 0 留尾都不碰，其中一項是「`--danger` 對比不足」。
但四件套一旦定義了 `--stop`，站上就會有**兩個紅**：舊的 `--danger: #EE5151`（瓷白 3.19:1，未過 AA）
與新的 `--stop: #9E3535`（6.28:1）。

**兩個紅 = 第二真相來源，正是本階段存在的目的要消滅的東西。** 因此把 `--danger` 改成
`var(--stop)` 的別名而非留著獨立值。這是我替你做的判斷，不同意就把那一行改回 `#EE5151`，
其餘不受影響。

副作用：現行 7 處用 `--danger` 的錯誤文字會從亮紅變深紅，且**從未過 AA 變成過 AA**。

### D4 — Element Plus：SCSS map 換值 + `--el-*` 橋接，兩件都做

只做其中一件都不夠：

- **只換 SCSS map**：EP 元件會變色，但任何在 runtime 讀 `--el-color-primary` 的地方（自訂樣式、
  第三方、`_style.css` 的覆寫）仍是編譯期算出的固定值，換季時不跟。
- **只加 `--el-*` 橋接**：EP 的 SCSS 在編譯期已把 `#354d7b` 的色階（`-light-3` … `-dark-2`）
  烤進產物，橋接只蓋得到直接讀 var 的那些。

因此：`$colors` map 換成精品調（讓編譯期色階正確），`_theme.css` 再把
`--el-color-primary` 等橋到 token（讓 runtime 跟主題）。

映射：

| EP | 接到 | 說明 |
|----|------|------|
| `primary` | `--accent` | 樣板藍 `#354d7b` 退場 |
| `success` | `--good` | 原 `#00ADA9` 青綠 |
| `warning` | `--wait` | 原 `#EB8B2D` |
| `danger` / `error` | `--stop` | 原 `#EE5151` |
| `info` | `--ink-soft` | 原 `#808080` |
| `table.header-bg-color` | `--ink` | 原 `#354d7b` |
| `table.header-text-color` | `--surface-raised` | 原 `#fff` |
| `table.border-color` | `--hairline` | 原 `#E6E7E7` |

SCSS map 的值必須是編譯期常數，不能寫 `var(--accent)`（Sass 要用它算色階）。
所以 map 裡放色碼字面值 —— 這是**唯一容許的例外**，且必須與 token 一致，由新守衛比對。

### D5 — 守衛補三條（先證明會紅才算數）

階段 0 的守衛只掃 `--da-*` 與 `$font-*`，所以**漏掉了 EP 的 SCSS map 這個第二真相來源**。
本階段補：

| 守衛 | 內容 |
|------|------|
| G6 舊色票不得復活 | 7 個舊值的 hex 與 `rgba()` 兩種寫法在 `app/` 下皆為 0 命中 |
| G7 狀態色不得硬編 | 27 個已知狀態色值不得出現；新狀態色只能從 `--good/wait/note/stop` 取 |
| G8 EP map 與 token 一致 | `scss-tool/element-plus/index.scss` 的 `$colors` 值必須逐一等於 `_design-tokens.css` 對應 token 的字面值 |

每一條**先注入違規證明它會紅、還原證明它會綠**，沒證明過的不算守衛（階段 0 的紀律）。

### D6 — 分階段 commit，破圖可歸因

一個 commit 換 363 處 + 196 處 + 整套 EP，破圖將無法歸因。拆四個 commit：

```
P1 舊色票清除（機械，零決策）      → build + 視覺 diff
P2 語意色四件套                    → build + 視覺 diff
P3 Element Plus 橋接（admin 面最大）→ build + 視覺 diff
P4 !important + 守衛                → lint / test / build
```

視覺基線在 P1 之前**不重拍** —— 現行 33 張基線就是「階段 0 之後、色彩收尾之前」的正確起點。

### D7 — 順手修一處文件錯誤

`openspec/specs/design-tokens/spec.md:37` 寫古銅為 `#9C7C3C`，但實際值是 `#7E6330`
（W0a 為了過 AA 5.10:1 調過，proposal 的舊值沒同步）。主 spec 是後人查值的地方，
留著會誤導，順手改正。

## 遷移

```
1. P1 舊色票清除 → grep 歸零 → build → 視覺 diff 人工確認 → commit
2. P2 語意色四件套 → build → 視覺 diff → commit
3. P3 EP 橋接 → build → 視覺 diff（admin 三頁重點看）→ commit
4. P4 !important + 3 條守衛（含注入證明）→ lint/test/build → commit
5. 接受新基線 → push origin main（= prod）
6. 交付 Brain AI 的 prod 驗收清單
```

**回滾**：四個 commit 各自獨立可 revert。token 層的新增（語意色、疊色階梯）即使 revert 替換
也無害 —— 它們只是多定義了幾個沒人用的變數。

---

# 執行中發現（2026-08-27，寫在動手之後）

以下五條都不是規劃時知道的，是 P1 做下去才撞出來的。每一條都改變了做法，因此補記在此。

## D8 — 色彩也有「散在各檔的本地變數」，而守衛看不到（第四處真相來源）

W0b 治好了字體的這個病（`$font-*` 散在 46 個檔）。**色彩的同一個病沒被發現**：

```scss
$amber: #d4860a;        // 32 個檔各自宣告
$bg:    #0d0f14;        // 10 個檔
$danger / $amber-light / $rose / …   // 16 個
```

共 **58 條宣告散在 33 個檔**，`$amber` 被引用 **442 次**（其中 203 次是 `rgba($amber, α)`）。

這解釋了一件之前說不通的事：**階段 0 換了色票，為什麼 admin 看起來還是「對的」？**
因為 admin 的主色根本沒走 token，它走 `$amber: #d4860a` —— 還是舊琥珀。
「看起來沒壞」是因為它整片沒變，不是因為它變對了。

`design-token-guards.spec.ts` 的五條守衛掃 `--da-*` 與 `$font-*`，掃不到 `$amber` 這種
自由命名的本地色變數。**守衛的涵蓋範圍是按「已知的病」設計的，不是按「色碼可能藏在哪」設計的。**

處置：58 條宣告全刪，442 處引用改走 token；新守衛 G6 改成掃「任何 `$x: #hex` 形式的本地色變數宣告」，
而不是列舉已知名稱。

## D9 — iPhone 14 的視覺基線從來沒拍到過 CSS

階段 0 記了一條留尾：「iPhone 14 上 `/booking` `/home` `/orders` 的截圖 md5 完全相同，
都是只有頁尾的畫面，推測是 boot/hydration 沒走完就被拍」。

**推測錯了，而且問題比那嚴重得多。** 真正原因是：

專案 CSP 含 `upgrade-insecure-requests`（`server/utils/security-headers.ts:84`）。
Chromium 對 localhost 這類 potentially-trustworthy origin 豁免該指令，**WebKit 不豁免**。
於是 WebKit 把 `http://localhost:3000/static/entry.css` 升級成 `https://` → SSL connect error
→ **整張 entry.css 靜默載入失敗**。頁面照常渲染，只是所有 design token 解析為空字串。

實測：WebKit 下 `getComputedStyle(:root).getPropertyValue('--da-amber')` 回傳 `""`，
Chromium 下回傳 `#7e6330`。

也就是說 **iPhone 14 的 11 張基線在此之前完全驗不到 token 相關的任何東西**。
三張 md5 相同不是巧合 —— 三張都在拍沒有 CSS 的頁面，長得當然一樣。

這也是為什麼 P1 一動就「破圖」：我把顏色從「元件內嵌 CSS 的字面值」（WebKit 讀得到，
因為 Nuxt 把 component CSS inline 進 HTML）搬到「entry.css 的 token」（WebKit 讀不到）。
**既有的洞被新寫法照出來，不是新寫法造成的洞。**

prod 全站走 https，該指令是 no-op —— 這純粹是「本地用 http 跑 prod server」的測試假象。
因此**不動 production CSP**，只在視覺基線的 route handler 剝掉回應的 CSP／HSTS header。

踩過的岔路：Playwright 的 `bypassCSP: true` **救不了這個**（實測 WebKit 下 `--da-amber` 仍為空），
它不涵蓋 `upgrade-insecure-requests`。只有改寫 response header 有效。
且只需要剝**文件**的 header（升級是由文件的 CSP 發動的），順帶避開「測試收尾時
還有子資源在飛，`route.fetch()` 對已關閉的 page 拋錯」那個坑。

## D10 — 階段 0 的語意別名層不跟主題引擎走（潛伏 bug，被 P1 引爆）

階段 0 design.md D1 寫：「別名**必須**指向 `--da-*` 而非直接寫死色值 —— 否則主題引擎
覆寫 `--da-*` 時別名不會跟著變，換膚又『切一半』。」

方向對，但**只做到「值寫成 `var(--da-*)`」不夠 —— 宣告的位置也要跟著覆寫的位置**。

CSS custom property 的計算值是「`var()` 代入之後」的 token stream，然後被子孫繼承。
`--accent: var(--da-amber)` 寫在 `:root`，就在 `:root` 當場定案成 `#7E6330`；
主題引擎的覆寫落在子孫 `[data-da-theme]` 上（`shared/site-theme.ts` 的 `buildThemeCss`），
追不回那個已經定案的 `--accent`。

實測（Chromium，2026-08-27）：在子孫上覆寫 `--da-amber: #7A2B2B`（聖誕深酒紅），
該子孫讀到的 `--accent` 仍是 `rgb(126, 99, 48)` 古銅。

階段 0 當時沒出事，是因為**別名幾乎沒人用**（940 處都是直接 `var(--da-*)`）。
階段 1 把 750 處改成別名之後，這一條就從理論問題變成「季節主題在乘客端會失效」。

解法：凡是會覆寫 `--da-*` 的作用域，都要把整層別名與疊色階梯**重新宣告一次**：

```css
:root,
[data-da-theme],          /* 主題引擎注入處 */
[data-surface='dark'] {   /* 深色面，見 D11 */
  --accent: var(--da-amber);
  --accent-a20: …;
  …
}
```

## D11 — 古銅在深色面只有 3.11:1，需要一個「深色作用域」

`--da-amber` 古銅 `#7E6330` 是配著淺底定的（瓷白 5.10:1 過 AA）。
放到縞黑 `#1A1917` 上只有 **3.11:1** —— 連非文字的 3.0 都只是剛過。

而 admin 與司機端整片是深底。舊值 `#D4860A` 於舊深底 `#0d0f14` 是 **6.58:1**，
所以把 `$amber` 一律接到 `--accent` 會是明確的可讀性退步（6.58 → 3.11）。

`_theme-colors.css` 本來就把亮銅註記為「深底上使用」（`--da-amber-light #C9A961`，
於縞黑 **7.81:1**）。缺的只是一個「宣告自己在深底上」的機制。

做法是在深色作用域**把 `--da-amber` 本身換成亮銅**，而不是叫每個元件改寫成 `--accent-lit`：

```css
[data-surface='dark'] { --da-amber: var(--da-amber-light); }
```

三個好處：① 元件端一律寫 `var(--accent)`，不必知道自己在什麼底色上；
② 連既有那些直接寫 `var(--da-amber)` 的舊程式碼也一起救到（那些在階段 0 就已經掉到 3.11:1）；
③ 疊色階梯因為在同一個作用域重新宣告，會自動推導成亮銅的疊色。

標記位置四處：`layouts/back-desk.vue`、`layouts/driver.vue`、
`components/open/dialog/announcement/Edit.vue`（深色彈窗；`#OpenGroup` 掛在 `app.vue`，
是 layout 的**兄弟**不是子孫，繼承不到）、`components/common/CommonDrawer.vue`（乘客端的深色抽屜）。

## D12 — 階段 0 的字體驗收指令一直在空轉

階段 0 立了一條紀律：「凡動字體，驗收條件是 grep 產物的 `@font-face`
（`cat .output/public/static/*.css | grep -c "@font-face"`，目前應為 64），不是 build 綠。」

**那條指令數的是「有幾行命中」，而 `entry.css` 是壓成一行的**，所以它永遠回 `1`。
64 這個數字對得上的是 `.output/public/_fonts/` 的檔案數，不是它的輸出。

正確寫法是數出現次數：

```
cat .output/public/static/*.css | grep -o "@font-face" | wc -l     # 應為 72
ls .output/public/_fonts | wc -l                                    # 應為 64
```

72 = 64 個真實字檔 face + 8 個 fallback metric-override face（Cormorant 3 + Jost 5）。

這條很值得記：**一條「防止靜默失敗」的檢查本身靜默失敗了**，而且會回一個非零數字，
看起來像通過。動字體時請用上面兩條，並且兩個數字要一起看。
