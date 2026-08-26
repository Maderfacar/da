# Color Completion — Tasks

> 階段 1「色彩收尾包」。範圍由 Brain AI 2026-08-27 拍板。
> 四個 P 各自獨立 commit，破圖可歸因（design.md D6）。

## P0 — 前置

- [ ] **P0.1** 確認工作區乾淨、與 `origin/main` 同步（階段 0 的 archive commit `6aabe33` 已在線上）
- [ ] **P0.2** 確認現行 33 張視覺基線可用（不重拍 —— 它就是「收尾之前」的正確起點）

## P1 — 舊色票殘留清除（363 處 / 86 檔）

- [ ] **P1.1** `_design-tokens.css` 新增疊色階梯（design.md D2）
  - [ ] `--accent-a06/a12/a20/a32/a50/a70`
  - [ ] `--ink-a06/a12/a20/a32/a50/a70`
  - [ ] `--surface-a50/a72/a88/a96`
  - [ ] 每組先寫 `rgba()` 字面值，再以 `@supports (color: color-mix(…))` 覆蓋成 `color-mix`
        —— **不可用同名重複宣告**（design.md D1，custom property 會 invalid at computed-value time）
- [ ] **P1.2** 替換 7 個舊值的 hex 形式（89 處）
- [ ] **P1.3** 替換 `rgba()` 形式（274 處），alpha 就近吸附到 6 階
- [ ] **P1.4** 逐檔看上下文，排除「刻意的第三方品牌色」誤判（**不做全域 sed**）
- [ ] **P1.5** 驗收：`grep` 7 個舊值在 `app/` 下 hex 與 rgba 皆 0 命中
- [ ] **P1.6** `pnpm build` → 起 prod server → 視覺 diff → 逐張人工確認 → commit

## P2 — 語意色四件套（196 處 / 53 檔）

- [ ] **P2.1** `_design-tokens.css` 新增 12 個語意色 token（design.md D3 的表，含實測對比值註解）
- [ ] **P2.2** `--danger` 改為 `var(--stop)`（**D3b：偏離「留尾不碰」，已標註可一行還原**）
- [ ] **P2.3** 27 個硬編狀態色逐處歸類 → 換 token
  - [ ] good 50 處 / 7 值
  - [ ] stop 89 處 / 9 值
  - [ ] note 42 處 / 7 值
  - [ ] wait 15 處 / 4 值
- [ ] **P2.4** 深色面上的狀態色改用 `-lit` 階（司機端、admin 側欄）
- [ ] **P2.5** 品牌色**不動**：LINE `#06c755`(16) 等第三方識別色不是語意色
- [ ] **P2.6** `pnpm build` → 視覺 diff → commit

## P3 — Element Plus 橋接

- [ ] **P3.1** `scss-tool/element-plus/index.scss` 的 `$colors` map 換成精品調字面值（design.md D4 映射表）
- [ ] **P3.2** `$table` 三個值換到 token 對應色
- [ ] **P3.3** `element-plus/_theme.css` 補 `--el-*` → token 橋接（runtime 跟主題）
- [ ] **P3.4** 檢查 `_style.css` 17 處 `!important` 是否與新橋接衝突
- [ ] **P3.5** `pnpm build` → 視覺 diff（**`/admin/orders` `/admin/dashboard` `/admin/settings` 三頁重點看**）→ commit

## P4 — `!important` A 類修理 + 守衛補洞

- [ ] **P4.1** A-1 五處接上 token（`dialog-plus.vue:149,152`、`admin/orders/index.vue:3573,3574,3577`）
- [ ] **P4.2** 新增守衛 G6：舊色票 7 值不得復活（hex + rgba 兩種寫法）
- [ ] **P4.3** 新增守衛 G7：27 個狀態色值不得硬編
- [ ] **P4.4** 新增守衛 G8：EP `$colors` map 必須與 token 字面值一致
- [ ] **P4.5** **三條守衛逐條注入違規證明會紅、還原證明會綠**（階段 0 紀律，沒證明過不算守衛）
- [ ] **P4.6** 更新 `important-audit.md`：A-1 從 5 處降為 0，記錄修法
- [ ] **P4.7** 修正 `openspec/specs/design-tokens/spec.md` 的古銅值 `#9C7C3C` → `#7E6330`（design.md D7）

## P5 — 收尾

- [ ] **P5.1** `pnpm lint` 0 error
- [ ] **P5.2** `pnpm test` 全綠（既有 957 + 新增 3 條守衛）
- [ ] **P5.3** `pnpm build` exit 0，且 `@font-face` 數不變（字體管線沒被波及的唯一證明）
- [ ] **P5.4** 視覺基線重拍並接受，33/33 乾淨比對
- [ ] **P5.5** push origin main（= prod）
- [ ] **P5.6** 產出「交付 Brain AI 的驗收項目」清單（prod 目視為主，含我代決的判斷）

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
