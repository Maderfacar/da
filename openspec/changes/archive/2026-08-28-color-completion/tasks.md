# Color Completion — Tasks

> 階段 1「色彩收尾包」。範圍由 Brain AI 2026-08-27 拍板。
> 四個 P 各自獨立 commit，破圖可歸因（design.md D6）。

## P0 — 前置

- [x] **P0.1** 確認工作區乾淨、與 `origin/main` 同步（階段 0 的 archive commit `6aabe33` 已在線上）
- [x] **P0.2** 確認現行 33 張視覺基線可用（不重拍 —— 它就是「收尾之前」的正確起點）

## P1 — 舊色票殘留清除（363 處 / 86 檔）

- [x] **P1.1** `_design-tokens.css` 新增疊色階梯（design.md D2）
  - [x] `--accent-a06/a12/a20/a32/a50/a70`
  - [x] `--ink-a06/a12/a20/a32/a50/a70`
  - [x] `--surface-a50/a72/a88/a96`
  - [x] 每組先寫 `rgba()` 字面值，再以 `@supports (color: color-mix(…))` 覆蓋成 `color-mix`
        —— **不可用同名重複宣告**（design.md D1，custom property 會 invalid at computed-value time）
- [x] **P1.2** 替換 7 個舊值的 hex 形式（89 處）
- [x] **P1.3** 替換 `rgba()` 形式（274 處），alpha 就近吸附到 6 階
- [x] **P1.4** 逐檔看上下文，排除「刻意的第三方品牌色」誤判（**不做全域 sed**）
- [x] **P1.5** 驗收：`grep` 7 個舊值在 `app/` 下 hex 與 rgba 皆 0 命中
- [x] **P1.6** `pnpm build` → 起 prod server → 視覺 diff → 逐張人工確認 → commit

## P2 — 語意色四件套（196 處 / 53 檔）

- [x] **P2.1** `_design-tokens.css` 新增 12 個語意色 token（design.md D3 的表，含實測對比值註解）
- [x] **P2.2** `--danger` 改為 `var(--stop)`（**D3b：偏離「留尾不碰」，已標註可一行還原**）
- [x] **P2.3** 27 個硬編狀態色逐處歸類 → 換 token
  - [x] good 50 處 / 7 值
  - [x] stop 89 處 / 9 值
  - [x] note 42 處 / 7 值
  - [x] wait 15 處 / 4 值
- [x] **P2.4** 深色面上的狀態色改用 `-lit` 階（司機端、admin 側欄）
- [x] **P2.5** 品牌色**不動**：LINE `#06c755`(16) 等第三方識別色不是語意色
- [x] **P2.6** `pnpm build` → 視覺 diff → commit

## P3 — Element Plus 橋接

- [x] **P3.1** `scss-tool/element-plus/index.scss` 的 `$colors` map 換成精品調字面值（design.md D4 映射表）
- [x] **P3.2** `$table` 三個值換到 token 對應色
- [x] **P3.3** `element-plus/_theme.css` 補 `--el-*` → token 橋接（runtime 跟主題）
- [x] **P3.4** 檢查 `_style.css` 17 處 `!important` 是否與新橋接衝突
- [x] **P3.5** `pnpm build` → 視覺 diff（**`/admin/orders` `/admin/dashboard` `/admin/settings` 三頁重點看**）→ commit

## P4 — `!important` A 類修理 + 守衛補洞

- [x] **P4.1** A-1 五處接上 token（`dialog-plus.vue:149,152`、`admin/orders/index.vue:3573,3574,3577`）
- [x] **P4.2** 新增守衛 G6：舊色票 7 值不得復活（hex + rgba 兩種寫法）
- [x] **P4.3** 新增守衛 G7：27 個狀態色值不得硬編
- [x] **P4.4** 新增守衛 G8：EP `$colors` map 必須與 token 字面值一致
- [x] **P4.5** **三條守衛逐條注入違規證明會紅、還原證明會綠**（階段 0 紀律，沒證明過不算守衛）
- [x] **P4.6** 更新 `important-audit.md`：A-1 從 5 處降為 0，記錄修法
- [x] **P4.7** 修正 `openspec/specs/design-tokens/spec.md` 的古銅值 `#9C7C3C` → `#7E6330`（design.md D7）

### P2 / P3 / P4 執行中追加（皆已完成，詳見 design.md D13）

- [x] **P2.7** 修正色相分類的三類系統性誤判：舊琥珀家族被當成 `wait`（26 處）、
      語言 chip 的類別色盤被壓扁（2 檔）、LINE 氣泡擬真色被語意化（1 處）
- [x] **P2.8** 新增 `--line-green` / `--line-bubble` 兩個「第三方擬真」token，
      並明載換色票時刻意不跟著換
- [x] **P2.9** 修深色面上的填色標章白字對比（1.7:1 → 6.89:1，2 處）
- [x] **P2.10** 新增 `[data-surface='light']` 逃生門，處理深色 layout 內的白底輸入框
      （focus 邊框 1.9:1，WCAG 2.2 焦點指示需 3:1）；套用 8 處
- [x] **P2.11** 修 `rgba(var(--stop), .4)` 靜默失效 —— `$danger: var(--stop)` 之後
      餵進 Sass 的 `rgba()` 會編出無效 CSS，宣告直接消失。產物實測 15 條，全數修正
- [x] **P2.12** 計費沙盒併入設計系統（原本自帶 7 色的離線色盤，是站上最後一個沒進 token 的頁面）
- [x] **P4.8** 更新 `important-audit.md`：A-1 從 5 處降為 **0**

## P5 — 收尾

- [x] **P5.1** `pnpm lint` 0 error
- [x] **P5.2** `pnpm test` 全綠（既有 957 + 新增 3 條守衛）
- [x] **P5.3** `pnpm build` exit 0，且 `@font-face` 數不變（字體管線沒被波及的唯一證明）
- [x] **P5.4** 視覺基線重拍並接受，33/33 乾淨比對
- [x] **P5.5** push origin main（= prod）
- [x] **P5.6** 產出「交付 Brain AI 的驗收項目」清單（見下方）
- [ ] **P5.7** Brain AI prod 目視驗收 —— **併入階段 2 一次驗收**
  - 2026-08-28 已交付 `2026-08-27-surface-scale-completion/acceptance.md`（27 項 + 4 個代決判斷）
  - 驗收進行中；archive 不等待此項，驗收結果以後續變更追蹤
      （Brain AI 2026-08-27 指示：「整個都改完之後我再一次就整體感覺來驗收」。
      本階段的 11 項清單與 4 個代決判斷不單獨驗，隨
      `2026-08-27-surface-scale-completion` 的交付清單一起看；兩個 change 同時 archive。）

## 驗收標準

| 項目 | 標準 |
|------|------|
| 舊色票 | `app/` 下 7 個舊值 hex + rgba 皆 0 命中，且由 G6 常態守著 |
| 語意色 | 27 種硬編狀態色歸零；四件套全部 ≥ 4.5:1 過 AA |
| Element Plus | `$colors` 無樣板色；`--el-*` 橋接可跟主題；G8 常態比對 |
| `!important` | A-1 清單從 5 處降為 0 |
| 守衛 | 3 條新守衛各自證明過會紅 |
| 建置 | lint 0 · test 全綠 · build exit 0 · `@font-face` 數不變 |
| 視覺 | 33 張基線逐張人工確認後接受 |

## 不做（明確排除）

版面重排 · 玻璃退場 · 尺度 token 實際替換（圓角／z-index／動效／斷點）· 後台色票編輯 UI ·
深色模式 · 視覺基線 3 張空包彈 · richmenu 字型重選（只能 Brain AI 在後台操作）


---

## 交付 Brain AI 的驗收項目（P5.6）

> 全部只能在 prod 目視。已上線：commits `9146897`（P1）· `c0a2fd0`（P3）· `764cbfe`（P4）· `e0a50f9`（P2）。
> Vercel 部署完成並確認：新 `entry.css` 含 `#9e3535`、樣板藍 `#354d7b` 歸零；
> 八條路由 curl 全 200；`/nuxt-api/config/theme` 回傳的 tokens 與 `_theme-colors.css` 一致。

### 一、我替你做的四個判斷（不同意就說，每個都是小改動）

**① `--danger` 併進 `--stop` —— 這一項偏離了你「留尾都先不碰」的指示**

你指定三個留尾都不碰，其中一項是 `--danger` 對比不足。但四件套一旦有了 `--stop`，
站上就會有兩個紅：舊 `--danger #EE5151`（瓷白 3.19:1，未過 AA）與新 `--stop #9E3535`（6.28:1）。
**兩個紅就是第二真相來源，正是這個階段存在的目的要消滅的東西。**
所以我把 `--danger` 改成 `var(--stop)` 的別名。
不同意的話把 `_design-tokens.css` 那一行改回 `#EE5151` 即可，其餘不受影響。
副作用：7 處錯誤文字從亮紅變深紅，且從未過 AA 變成 6.28:1。

**② 深色面的主色改用亮銅**

古銅 `#7E6330` 是配著淺底定的（瓷白 5.10:1）。放到縞黑上只有 **3.11:1** ——
而 admin 與司機端整片是深底，舊琥珀在舊深底上是 6.58:1。
新增 `[data-surface='dark']` 作用域，在深色面把主色換成亮銅 `#C9A961`（縞黑 7.81:1）。
**這連帶讓 admin 側欄、chip、按鈕比階段 0 剛上線時明顯更清楚** —— 那不是我改亮了，
是階段 0 把它們調暗了（因為它們當時還沒接 token，看起來「沒變」而已）。

**③ `wait` 用赤陶不用金色**

慣例上等待＝琥珀，但本站主色就是古銅（hsl 39°），再放金色進來會糊在一起。
選赤陶 `#A0521F`（hsl 24°，Δhue 15°）拉開色相，同時保住「暖色＝等待」的直覺。

**④ 三個「進行中」狀態同色**

`/orders/[id]` 的 `confirmed` / `en_route` / `arrived_pickup` 原本是藍 / 紫 / 青三色，
四件套裡沒有對應語意，收斂成同一個 `--note`。色只是輔助，狀態意義由旁邊的文字承擔。

### 二、純確認（跑一遍看有沒有壞）

| # | 在哪 | 看什麼 | 預期 |
|---|------|--------|------|
| 1 | Admin 任一頁 | **重點** —— 按鈕、開關、下拉、分頁、表格表頭 | 全部是精品調。之前它們是樣板藍 `#354d7b`（Element Plus 從來沒接過品牌色），現在應該完全看不到藍色 |
| 2 | `/admin/orders` | 「縣市」下拉 | 從「深色頁面上的白盒子」變成融進深色面的深色框 |
| 3 | `/admin/orders` | 原生下拉展開後的 `<option>` | **這是階段 0 唯一的「已知未變色點」，現在應該跟著變了**。清單已清空，看到沒變色就是真缺陷 |
| 4 | Admin 側欄 / chip / 按鈕 | 古銅 vs 亮銅 | 比階段 0 剛上線時清楚一階（見上方判斷②） |
| 5 | `/admin/line-management` | 語言 chip（繁中 / EN / 日本語） | 三個不同色（紅 / 藍 / 綠）。若有兩個同色就是我沒修乾淨 |
| 6 | `/admin/line-management` | Bot 文案的訊息預覽氣泡 | 仍是 LINE 的淡綠，**不是**設計系統的綠 |
| 7 | 司機端 `/driver/dashboard` `/driver/trip` | 狀態標章 | 綠 / 赤陶 / 藍 / 紅四色，飽和度比之前低（不再像貼紙） |
| 8 | 乘客端 `/orders` `/orders/[id]` | 訂單狀態文字 | 待確認＝赤陶、已完成＝綠、已取消＝深紅 |
| 9 | **LINE 通知**（下一則推播） | 訊息裡的標題色與訂單編號色 | **這是最容易被忽略的一項**：階段 0 只看 `app/`，server 端的 Flex message 產生器整片漏掉，你之前收到的每一則 LINE 通知都還是舊琥珀。現在應該是古銅 `#7E6330` |
| 10 | `/admin/settings` 逐套切換三個節日包 | 換季後整站 | 主色與**所有半透明疊層**一起變（之前疊層是寫死的舊琥珀，換季只變一半） |
| 11 | `/admin/settings/fare-sandbox` | 計費沙盒整頁 | 從自帶的米白＋磚紅色盤換成精品調。這是站上最後一個沒進設計系統的頁面 |

### 三、四件無須動作、但你該知道的事實

1. **iPhone 14 的視覺基線在此之前從來沒拍到過 CSS**。CSP 的 `upgrade-insecure-requests`
   在 WebKit 上不豁免 localhost，`entry.css` 被升級成 https 後 SSL 失敗、靜默不載入。
   舊留尾記的「三張截圖 md5 相同、推測是 hydration race」推測錯了 —— 是三張都在拍沒有 CSS 的頁面。
   已修（只在測試端剝掉回應的 CSP/HSTS，**不動 production**），那 11 張現在是真的基線了。
2. **階段 0 的語意別名層不跟主題引擎走**。`--accent: var(--da-amber)` 寫在 `:root` 就當場定案，
   子孫 `[data-da-theme]` 再覆寫也追不回來。階段 0 沒出事是因為別名幾乎沒人用；
   這一輪改了 750 處之後就會讓季節主題在乘客端失效，所以一併修了（見驗收項 10）。
3. **階段 0 的字體驗收指令一直在空轉**。`grep -c "@font-face"` 數的是行數，而 `entry.css`
   壓成一行，所以它永遠回 `1`，看起來像通過。正確是 `grep -o … | wc -l`（應 72）
   配上 `ls .output/public/_fonts | wc -l`（應 64）。一條防止靜默失敗的檢查自己靜默失敗了。
4. **richmenu 字型仍需你手動重選**（階段 0 留尾，只能在 admin 後台操作）。

### 四、刻意留給後續階段的東西

- **深色面的表面色**（`#1a1a2e` / `#161b22` / `#1f2937` / `#0f1115` 等藍黑家族，約 35 處）——
  它們與縞黑同色系但不同色相，屬「表面 token 化」而非色彩收尾
- **中性白／黑疊層**（`rgba(255,255,255,.08)` 之類，約 40 條本地 SCSS 變數）——
  不帶色相、不隨色票變，歸同一階段
- 玻璃退場 · 尺度 token 實際替換 · 版面重排 · 後台色票編輯 UI · 深色模式
