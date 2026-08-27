# Tasks — 階段 2

> 五個 wave，各自獨立 commit。完工後 Brain AI 一次整體驗收（不做中途目視）。

## W0 — 前置
- [x] **W0.1** `git fetch` 確認與 `origin/main` 同步、工作區乾淨
- [x] **W0.2** 實測盤點（glass 86 · backdrop-filter 65 · 藍黑 34 · 中性 SCSS 79 ·
      radius 656/31 · z-index 76/29 · shadow 79 · transition 254）

## W1 — 玻璃退場 + 表面 token 化
- [ ] **W1.1** `_design-tokens.css` 新增 `--surface-deep` / `-2` / `-3`（D14）
- [ ] **W1.2** `[data-surface='dark']` 加 `--hairline: var(--surface-a12)`（D14）
- [ ] **W1.3** `--da-glass-*` 三個 token 從 `_theme-colors.css` 下架
- [ ] **W1.4** 86 處 glass 依 D18 映射表替換
- [ ] **W1.5** 65 處 `backdrop-filter` 移除（含 `-webkit-`），遮罩類改實色疊層（D19）
- [ ] **W1.6** 34 處藍黑改接 `--surface-deep*`（D15）
- [ ] **W1.7** 79 條中性 SCSS 變數改走 `--surface-a*` / `--ink-a*`
- [ ] **W1.8** 關掉守衛兩處「暫時放行」（中性 SCSS 變數、深色面硬編色），並證明會紅
- [ ] **W1.9** lint / test / build 綠 → commit

## W2 — 尺度 token 實際替換
- [ ] **W2.1** 圓角階梯重定為七階（D16）
- [ ] **W2.2** 656 處 `border-radius` 替換
- [ ] **W2.3** 76 處 `z-index` 收成六層（D17）
- [ ] **W2.4** 79 處 `box-shadow` 收成三階
- [ ] **W2.5** 254 處 `transition` 時長／緩動改 token
- [ ] **W2.6** 新守衛：尺度字面值不得復活（含注入違規證明會紅）
- [ ] **W2.7** lint / test / build 綠 → commit

## W3 — 後台色票編輯 UI
- [ ] **W3.1** 主題包 CRUD endpoint
- [ ] **W3.2** `/admin/settings` 色票編輯器（即時預覽 + 對比度計算）
- [ ] **W3.3** lint / test / build 綠 → commit

## W4 — 深色模式
- [ ] **W4.1** 乘客端深色配色（以 W1 的表面 token 為基礎）
- [ ] **W4.2** 切換 UI（跟隨系統／手動）與持久化
- [ ] **W4.3** lint / test / build 綠 → commit

## W5 — 版面重排
- [ ] **W5.1** 乘客端公開頁面的版面語彙
- [ ] **W5.2** lint / test / build 綠 → commit

## W6 — 收尾
- [ ] **W6.1** 視覺基線重拍並逐張確認
- [ ] **W6.2** `@font-face` 數不變（`grep -o` 應 72 / `_fonts` 應 64）
- [ ] **W6.3** push origin main
- [ ] **W6.4** 交付 Brain AI 的整體驗收清單

## 驗收標準

| 項目 | 標準 |
|------|------|
| 玻璃 | `--da-glass-*` 與 `backdrop-filter` 在 `app/` 下 0 命中 |
| 表面 | 藍黑六值 0 命中；中性 SCSS 色變數 0 條；兩處守衛豁免關閉 |
| 尺度 | radius / z-index / shadow / transition 字面值收斂，由守衛常態擋 |
| 建置 | lint 0 · test 全綠 · build exit 0 · `@font-face` 數不變 |
