# Design — 階段 2 的決策與踩過的雷

> 承接階段 0 的 D1–D7、階段 1 的 D8–D13，本階段編號自 **D14** 起。

## D14 — 深色面不能用「翻轉 `--surface-raised`」來做

最直覺的做法是在 `[data-surface='dark']` 裡把表面別名整組翻過來：

```css
[data-surface='dark'] { --surface-raised: var(--da-dark-mid); }   /* ← 這是陷阱 */
```

**這會炸掉疊色階梯。** `--surface-a06 … --surface-a96` 十一階全部由 `--surface-raised` 推導
（`color-mix(in srgb, var(--surface-raised) 12%, transparent)`）。深色面用到這些疊層的目的是
「白色系的細線與填底」—— 那正是階段 1 拿它取代 `rgba(255,255,255,.08)` 的理由。
一旦 `--surface-raised` 在深色作用域變成 `#26241F`，`--surface-a12` 就變成
「深色 12% 疊在深色上」＝**看不見**。全站深色面的髮絲線會集體消失，而且 build 全綠。

所以深色面的表面色改用**絕對 token**（在任何作用域都是深色，不隨 scope 翻轉）：

```css
--surface-deep:   var(--da-dark);        /* #1A1917 深色面底 —— 取代 #0d0f14 / #0f1115 */
--surface-deep-2: var(--da-dark-mid);    /* #26241F 深色面卡片 —— 取代 #1a1a2e / #161b22 */
--surface-deep-3: #302D27;               /* 深色面第三層／hover —— 取代 #1f2937 / #2d2d4e */
```

元件在深底上寫 `background: var(--surface-deep-2)`，語意明確、不依賴自己在哪個 scope 裡。
`--surface-a*` 繼續保持「白色系疊層」的語意不變。

**唯一在深色作用域翻轉的表面別名是 `--hairline`**（`--da-gray-pale` → `--surface-a12`）。
它安全的理由是沒有任何東西從 `--hairline` 推導。

## D15 — 藍黑不是「深一點的縞黑」，是不同色系

被換掉的 34 處是藍黑家族，縞黑是暖黑：

| 值 | hue | 用途 |
|----|-----|------|
| `#0d0f14` / `#0f1115` | 220° / 220° | 深色頁面底 |
| `#1a1a2e` / `#161b22` | 240° / 213° | 面板、卡片 |
| `#1f2937` / `#2d2d4e` | 215° / 240° | 抬升面、hover |
| **`#1A1917` 縞黑** | **40°** | 設計系統的深色 |

色相差 175–200°，等於互補。兩者並置時暖黑顯得偏紅、藍黑顯得偏冷 ——
這是「admin 跟乘客端不像同一個站」的成因之一，不是「深淺不同」而已。

`--surface-deep-3: #302D27` 是本階段唯一新增的字面色。取法是縞黑 `#1A1917` 與
`--da-dark-mid #26241F` 的同一條暖黑軸往上再推一階（保持 hue 40°、明度 +6%），
不是從藍黑挑一個近似值。

## D16 — 圓角階梯必須重定：階段 0 的五個值蓋不住實況

階段 0 的 B 區寫「圓角 —— 現況 656 次、**12 種值**」，並據此定了五階
（`--r-pill 100px` / `--r-round 50%` / `--r-tile 8px` / `--r-card 5px` / `--r-sm 3px`）。

實測是 **31 種**。而且 `--r-card: 5px` 對應的 `5px` 全站只有 **4 次**，
`--r-sm: 3px` 只有 **3 次** —— 這兩階是照著想像定的，不是照著實況定的。
真正的量體在階段 0 的階梯裡**沒有對應階**：

```
100px ×142 · 8px ×99 · 10px ×88 · 50% ×72 · 12px ×62 · 6px ×41
16px ×32 · 14px ×26 · 18px ×19 · 20px ×15 · 4px ×14 · 999px ×6 · 2px ×6
```

`10px`（88 次）與 `12px`（62 次）合計 150 次，比 `8px` 還多，卻只能被迫吸到 `--r-tile: 8px`。

重定為七階，並**順勢收緊**（精品調的圓角語彙是克制的；大圓角讀起來是消費級 App，
不是精品）。吸附後最大偏移 4px，且一律往小的方向：

| token | 值 | 吸收 | 處數 |
|-------|----|------|------|
| `--r-round` | `50%` | `50%` | 72 |
| `--r-pill` | `100px` | `100px` `999px` `9999px` | 149 |
| `--r-xl` | `20px` | `20px` `24px` | 21 |
| `--r-lg` | `14px` | `14px` `16px` `18px` | 77 |
| `--r-md` | `10px` | `10px` `12px` | 150 |
| `--r-sm` | `6px` | `6px` `8px` `9px` | 146 |
| `--r-xs` | `3px` | `1px` `2px` `3px` `4px` `5px` | 29 |

`8px → 6px` 是本階段最大宗的單一變動（99 處）。這是刻意的方向調整，不是吸附誤差。

## D17 — `z-index` 的 29 種值是考古地層，不是系統

實測 `0` `1` `2` `5` `10` `11` `12` `13` `14` `60` `70` `80` `99` `100` `150` `200` `250`
`300` `998` `999` `1000` `1050` `1100` `1200` `1900` `2000` `9999` `10000` `90000`。

`998` / `999` / `9999` / `10000` / `90000` 這串是典型的「上次被蓋住所以加一個 9」。
`90000 !important` 在 `plugins/not-use/_lock-img-download.client.ts` —— 那是個 `not-use` 目錄。

收成階段 0 已定義好的六層語意（`--z-base` 1 / `--z-sticky` 10 / `--z-header` 100 /
`--z-overlay` 500 / `--z-modal` 1000 / `--z-toast` 2000）。

⚠ **Element Plus 的浮層不歸這套管。** EP 的 `popper` / `ElMessage` / `ElDialog` 用的是
自己的 `--el-index-*` 與 runtime 遞增的 `zIndex`（`ElConfigProvider` 的 `z-index` 起始值），
起始 2000。因此 `--z-toast` 定在 2000 是**與 EP 共用同一層**，不是巧合，
要蓋過 EP 的浮層必須用 EP 自己的機制，不能靠把 `--z-toast` 加大。

## D18 — 玻璃的三個 token 各自只用在一個屬性，所以映射是安全的

實測 86 處的宣告屬性分布：

```
var(--da-glass-bg)     → background ×39            （100%）
var(--da-glass-border) → border ×30 / border-bottom ×3 / border-top ×1  （100% 邊框）
var(--da-glass-shadow) → box-shadow ×13            （100%）
```

沒有一處被拿去當漸層停點或 `color`，所以逐 token 機械映射不會有語意錯位：

| 舊 | 新 | 理由 |
|----|----|------|
| `--da-glass-bg` `rgba(瓷白,.72)` | `--surface-raised` 實心瓷白 | 半透明的用途本來就是「像卡片」；實心之後才真的像 |
| `--da-glass-border` `rgba(古銅,.20)` | `--hairline` | **不是** `--accent-a20`。每張卡都鑲一圈古銅邊正是「樣板感」的來源；精品調用中性髮絲線 |
| `--da-glass-shadow` 雙層 40px | `--shadow-soft` | 階段 0 已定義好，刻意更淡 |

`--da-glass-border` → `--hairline` 是本階段**唯一一個有設計判斷的映射**（其餘皆機械）。
它會讓全站 34 處卡片邊框從帶琥珀色轉成中性 —— 這是預期中的變化，不是破圖。

## D19 — `backdrop-filter` 全數移除，遮罩改用實色疊層

65 處全移，含 `-webkit-backdrop-filter`。分兩類處置：

1. **卡片／面板上的 blur**（多數）—— 底已改實心，blur 沒有作用對象，直接刪。
2. **遮罩／浮層背板上的 blur**（`blur(2px)` `blur(4px)` 那批）—— 改用 `--ink-a50` 之類的
   實色疊層。精品調的遮罩語彙是「壓暗」不是「糊化」，而且 `backdrop-filter` 在
   捲動中的遮罩上是每幀重新取樣整個背景，成本最高的正是這一類。

保留 `filter:`（不帶 backdrop）的用法不在本階段範圍 —— 那是元素自身的濾鏡，不吃背景。

## D20 — 階段 1 把「深色作用域」標在了 layout 根節點，而 admin 有一半是淺色頁

這是本階段開工時發現的**既有缺陷**，不是新引入的。

階段 1 為了解決「古銅在深底只有 3.11:1」，新增 `[data-surface='dark']` 作用域，
把主色換成亮銅 `#C9A961`。標記位置選在 `layouts/back-desk.vue` 與 `layouts/driver.vue`
的**根節點**。

司機端沒問題 —— 11 頁全部是深色頁（逐頁查證：`var(--ink)` / `var(--da-dark)` / `#0d0f14` / `#0f1115`）。
但 **admin 是 7 深 7 淺混用**：

| 深色頁（根節點有深色 background） | 淺色頁（無 background，吃 layout 的骨白） |
|---|---|
| `orders` `settings/index` `users` `drivers/index` `notifications` `traffic` `war-room` | `dashboard` `audit-logs` `referral` `line-management` `drivers/[uid]` `settings/pin` `settings/fare-sandbox` |

那 7 個淺色頁在階段 1 之後，`var(--accent)` 一律解析成亮銅，而亮銅於骨白 `#EAE7E0`
只有 **1.82:1**（古銅是 4.58:1）。admin 頁面的主色量體：`pages/admin/` 98 處、
`components/admin/` 67 處。

處置：把 `data-surface='dark'` 從 layout 根節點**移到真正是深色表面的節點** ——
`back-desk.vue` 的三處深色 chrome（載入遮罩 / 頁首 / 側欄抽屜）加上那 7 個深色頁的根節點。
淺色頁什麼都不用標，拿回 base 階古銅。司機端 layout 根節點的標記保留（它是對的），
只把根背景從瓷白改成 `--surface-deep`（原本是「深色頁蓋在淺底上」，載入時會閃一下白）。

教訓：**作用域標記要標在「表面實際是什麼顏色」的那個節點上，不是標在「這一端大致是深色」的那個節點上。**
「admin 是深色的」是一句對一半的話，而 CSS 繼承不接受對一半。

## D21 — `--hairline` 是唯一能在深色作用域翻轉的表面別名

一度想在 `[data-surface='dark']` 裡把 `--hairline` 從 `--da-gray-pale`（淺）翻成 `--surface-a12`（白 12%），
理由是深底上該用微亮的細線。

**在 D20 修好之前，這會炸掉 admin 的淺色頁**：`element-plus/_theme.css` 把
`--el-border-color` 三個變數全接到 `--hairline`，而 admin 淺色頁上的 EP 輸入框、
選擇器、表格邊框會全部變成「白 12% 疊在骨白上」＝ 看不見，而且 build 全綠。

D20 修好之後（深色標記只落在真正的深色節點上）這個翻轉才安全，所以兩件事必須一起做。
`--hairline` 能翻的另一個前提是**沒有任何 token 從它推導** ——
`--surface-a*` 全部從 `--surface-raised` 推導，所以 `--surface-raised` 不能翻（D14）。

## D22 — 玻璃退場後，`--da-glass-border` 改接中性髮絲線而不是 `--accent-a20`

`--da-glass-border` 的字面值就是 `rgba(126, 99, 48, 0.20)`，也就是 `--accent-a20`。
機械上最「忠實」的映射是接回 `--accent-a20`，一個像素都不變。

刻意不那樣做。全站 34 處卡片、面板、輸入框、tab 的邊框都鑲一圈 20% 古銅，
是「每個元件都在提醒你它有品牌色」的樣板感來源。精品調的層級是靠中性髮絲線與留白撐的，
主色只在需要指向動作的地方出現。

這是本階段 264 處表面替換裡**唯一一個帶設計判斷的映射**，其餘皆機械。
不同意的話，把 `_design-tokens.css` 的 `--hairline` 改指 `var(--accent-a20)` 即可全站還原。

## D23 — 深色模式必須贏過主題引擎的選擇器，所以不能寫在 `:root`

季節主題把 `--da-*` 注入在 `[data-da-theme]`（乘客 layout 根節點，特異度 0,1,0），
而 `:root.dark` 是 0,1,1 —— 看似會贏，但兩者作用在**不同節點**上：
`[data-da-theme]` 是 `:root` 的子孫，子孫的宣告直接覆蓋繼承來的值，特異度根本不參與比較。

所以深色模式的選擇器必須是 `.dark [data-da-theme]`（作用在同一個節點上，特異度 0,2,0 勝出），
外加 `:root.dark` 給沒掛主題的情況。並且依 D10，這兩個選擇器都要把整層別名重新宣告一次
—— 守衛的 `required` 清單同步加進去。

預設值刻意維持 `preference: 'light'`（不是 `'system'`）：深色配色是本階段新產出的，
還沒有人目視過，不該讓所有系統設為深色的乘客在上線當天直接吃到。
切換器提供「淺色 / 深色 / 跟隨系統」三選一，想改預設是 `nuxt.config.ts` 一行的事。
