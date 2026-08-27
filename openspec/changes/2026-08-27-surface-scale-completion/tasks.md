# Tasks — 階段 2

> 五個 wave。Brain AI 2026-08-27 指示：不做中途驗收，全部完工後一次整體驗收。

## W0 — 前置
- [x] **W0.1** `git fetch` 確認與 `origin/main` 同步、工作區乾淨
- [x] **W0.2** 實測盤點（glass 88 · backdrop-filter 65 · 藍黑 34 · 中性 SCSS 79 ·
      radius 656/31 · z-index 76/29 · shadow 79 · transition 254）

## W1 — 玻璃退場 + 表面 token 化 ✅
- [x] **W1.1** `--surface-deep` / `-2` / `-3` 三個絕對深色面 token（D14）
- [x] **W1.2** 修正階段 1 的 scope 標記位置（D20）—— admin 7 淺色頁的主色從 1.82:1 拉回 4.58:1
- [x] **W1.3** `--hairline` 在深色作用域翻轉為 `--surface-a12`（D21，必須在 W1.2 之後）
- [x] **W1.4** `--da-glass-*` 下架，88 處依 D18/D22 映射
- [x] **W1.5** `backdrop-filter` 65 處移除（先驗證沒有「只有 blur 沒有 background」的規則）
- [x] **W1.6** 藍黑家族 34 處 → `--surface-deep*`；war-room 地圖色盤 19 處平移暖黑軸
- [x] **W1.7** 中性疊層：SCSS 宣告 79 條 + 引用 343 處 + 行內 867 處 → `--surface-a*` / `--ink-a*`
- [x] **W1.8** 關閉守衛兩處「暫時放行」，新增 4 條守衛並逐條證明會紅
- [x] **W1.9** lint / test / build 綠（build exit 0，`@font-face` 72 / `_fonts` 64 未變）

## W2 — 尺度 token 實際替換 ✅
- [x] **W2.1** 圓角階梯重定為七階（D16）
- [x] **W2.2** 660 個圓角長度值替換
- [x] **W2.3** z-index 收成十一層（D17），38 處替換；≤20 的區域堆疊保留
- [x] **W2.4** box-shadow 37 處收成三階（新增 `--shadow-pop`）
- [x] **W2.5** transition 378 段時長走 `--dur-*`、緩動統一 expo-out
- [x] **W2.6** 3 條尺度守衛，逐條證明會紅；另證明「區域 z-index: 5」不誤觸發

## W3 — 後台色票編輯 UI ✅
- [x] **W3.1** `setThemeTokens` helper + `PATCH .../themes/{id}/tokens` 端點（雙重驗證：白名單 + hex）
- [x] **W3.2** `PatchThemeTokens` protocol
- [x] **W3.3** `/admin/settings` 色票編輯器：12 色即時預覽 + WCAG 對比即時計算 + 改預設主題二次警告
- [x] **W3.4** audit log `site_theme.tokens_update`（逐 key before/after）

## W4 — 深色模式 ✅
- [x] **W4.1** 乘客端深色調色盤（12 token，對比全數實測過門檻）
- [x] **W4.2** 作用域 `.dark [data-da-theme]`（D23）；別名層與守衛 required 清單同步
- [x] **W4.3** `CommonThemeToggle` 三選一（淺色 / 深色 / 跟隨系統）放進乘客抽屜；i18n 三語
- [x] **W4.4** 改寫 `:root.dark` 守衛到它的意圖上，並補「深色調色盤不得缺 key」；兩條都證明會紅

## W5 — 版面重排 ✅
- [x] **W5.1** 版面節奏 token（`--gutter` / `--space-*` / `--space-section` / `--space-major` / `--measure` / `--shell`）
- [x] **W5.2** 首頁 12 欄編輯型骨架（≥1024px 標籤與標題進左側欄）
- [x] **W5.3** 尺度對比：hero 128 → 168px、區塊標題 56 → 88px 上限
- [x] **W5.4** 破格網格：機場 6 欄不等重、特色錯落
- [x] **W5.5** 換氣點（`is-coverage` 用 `--space-major`）取代均勻 72px
- [x] **W5.6** `/home` `/fare` `passenger/home/*` 8 處區塊改走節奏 token（D24 的滿版寫法）

## W6 — 收尾 ✅
- [x] **W6.1** 最終 build（exit 0）+ 視覺基線 33 張重拍，連跑兩次乾淨
- [x] **W6.2** `@font-face` 72 / `_fonts` 64 未變（字體管線沒被波及）
- [x] **W6.3** push origin main（12 個 commit `e02accc`..`351c533`）
- [x] **W6.4** 交付 Brain AI 的整體驗收清單（`acceptance.md`）

## W7 — 產物比對逼出的收尾（不在原規劃內）✅
- [x] **W7.1** 玻璃 token 的**定義**下架（用法早清零，定義躲在 `TOKEN_SOURCES` 裡）
- [x] **W7.2** 藍黑的 `rgb()` 形式 3 處（守衛只列 hex）
- [x] **W7.3** 8 碼 hex 2 處 + 守衛
- [x] **W7.4** EP/Tailwind 預設灰藍 155 處（站上的**第三套調色盤**）
- [x] **W7.5** 3 碼 hex 24 處（全禁式守衛一上就抓到）
- [x] **W7.6** CSS 顏色關鍵字 36 處 + 函式值裡的關鍵字 2 處
- [x] **W7.7** 空格分隔的現代語法 1 處
- [x] **W7.8** 守衛由「門檻式」改為「全禁式 + 兩個具名例外」，涵蓋七種寫法

## W8 — 排版 token 化與留尾收斂（2026-08-28）✅

原本記在「刻意留給後續」的三項，做掉兩項。

- [x] **W8.1** 字級 token 化 1,309 處 → 11 階
      沿用 `typography.scss` 早就拍板的階梯（最小 12px、body 15px），不自己重新發明。
      那份檔案寫著「舊代碼 11px 仍存在 100+ 處，後續以 PR 漸進收斂」——
      實測 444 處低於它自訂的最小值，而整套 16 個 token 全站只被引用 8 次。
- [x] **W8.2** 行高 237 處 → 5 階、字距 621 處 → 8 階（偏移 ≤ 0.03em）
- [x] **W8.3** `typography.scss` 從「自帶 16 個字面值」改成純轉指層（它原本是排版的第二真相來源）
- [x] **W8.4** EP 的 `--el-font-size-*` 接上 `--fs-*` → `important-audit` 的 A-3 全部走 token
- [x] **W8.5** `#OpenGroup` 與 `CommonDrawer` 補上 `data-da-theme`
      —— 修掉 acceptance.md 記的「深色模式到不了乘客端彈窗」，
      順帶修掉「季節主題到不了彈窗與抽屜」（那個從 2026-07-29 主題引擎上線就存在）
- [x] **W8.6** 新增 5 條守衛（字級／行高字距／typography 轉指／Sass 算術／config 編譯期常數），
      全部證明會紅，並證明 `clamp()`、`em`、`white-space: nowrap` 不誤觸發
- [x] **W8.7** 側欄字標被階梯撐破（28px→32px 切字）—— 逐張看截圖抓到，降一階修好
- [x] **W8.8** 視覺基線 33 張重拍，連跑兩次乾淨

### W8 踩到的三顆

1. **替換 regex 誤傷 Sass 編譯期常數，build 直接中斷**：`font-size:` 是 `$base-font-size:` 的
   子字串，`rem()` 拿它做除法，Sass 無法對 `var()` 做算術。
   **而且守衛有同一個 bug** —— 還原成正確值之後反而把合法的常數判成違規。兩邊都補了邊界。
2. **背景建置沒等它真的結束就啟下一個**：兩個建置搶同一個 `.nuxt`，
   於是先重現舊錯誤、再變成 manifest 消失。看起來像「修了沒用」，其實是兩個行程打架。
3. **等待條件寫成「日誌裡出現 EXIT=」**，而上一輪的 `EXIT=` 還在同一個檔案裡 ——
   等待器立刻誤判完成，之後所有「驗證」都在對著上一輪的產物看。
   等待條件必須是**行程結束**，不能是日誌字串；或每次先 `rm -f build.log`。

## 仍留尾（一項，且刻意）

- **每套主題各帶一組深色 tokens** —— 深色模式下季節主題被整組蓋掉（聖誕深色 == 預設深色）。
  刻意不做的理由：它是疊在深色模式上的，而深色模式本身還沒有人目視過。
  若對深色的方向有調整，這些 per-theme 深色配色會整組重做 —— 先驗收再做，不要先做再重做。

## 驗收標準

| 項目 | 標準 | 狀態 |
|------|------|------|
| 玻璃 | `--da-glass-*`（含定義）與 `backdrop-filter` 0 命中 | ✅ 守衛常態擋 |
| 表面 | 藍黑十值（hex + rgb）0 命中 | ✅ 守衛常態擋 |
| 色彩單一來源 | `<style>` 內 0 字面色碼，例外 2 個且各附理由 | ✅ 守衛常態擋 |
| 尺度 | 圓角 / 跨元件 z-index / transition 時長皆走 token | ✅ 守衛常態擋 |
| 色票後台 | 12 色可編輯，存檔前跑 WCAG 對比 | ✅ |
| 深色模式 | 12 token 全覆蓋、對比全過、三選一切換 | ✅ 守衛擋缺 key |
| 建置 | lint 0 · 974 tests · build exit 0 · `@font-face` 72/64 | ✅ |
| 視覺 | 33 張基線重拍，連跑兩次乾淨，逐張人工確認 | ✅ |