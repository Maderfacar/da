# Color Completion — 色彩收尾：舊色清除、語意色四件套、Element Plus 橋接

> 這是「介面方向改精品調」的**階段 1**。
> 階段 0（`2026-08-25-design-token-foundation`，已 archive）換了色票與字體、建了 token 層；
> 本階段把**沒跟上的那 36%** 收乾淨，讓「換色票」這件事真正只需要改一處。
> 範圍由 Brain AI 2026-08-27 拍板為「色彩收尾包」，版面重排／玻璃退場／尺度替換不在本次。

## Why

階段 0 的結論是「全站 64% 已接線，改 12 行就變色」。反過來說，**剩下的 36% 現在是壞的** ——
不是「還沒變」，是「明確地錯」：它們硬編了**已經被廢棄的舊色值**，於是在新底色上以舊琥珀渲染。

實測（2026-08-27，`app/` 下 `.vue` / `.css` / `.scss`）：

### 一、舊色票殘留 363 處

| 舊值 | 應接的 token | hex | `rgba()` | 合計 |
|------|-------------|-----|---------|------|
| `#D4860A` 舊琥珀 | `--accent` | 56 | **202** | **258** |
| `#1A1814` 舊縞黑 | `--ink` | 12 | 41 | 53 |
| `#FAF8F4` 舊瓷白 | `--surface-raised` | 1 | 22 | 23 |
| `#F5C842` 舊亮黃 | `--da-stripe-yellow` | 9 | 3 | 12 |
| `#6B6560` 舊次要灰 | `--ink-soft` | 9 | 2 | 11 |
| `#F5F2EC` 舊骨白 | `--surface-ground` | 1 | 4 | 5 |
| `#B8B3AC` 舊三級灰 | `--ink-mute` | 1 | 0 | 1 |
| | | | **合計** | **363** |

**`rgba()` 形式是階段 0 沒看見的那一半**：`grep '#'` 抓不到 `rgba(212, 134, 10, .18)`，
所以 design.md 的「537 處硬編色」低估了實況。單是舊琥珀的 `rgba` 形式就有 202 處。

產物側佐證：現行 build 的 CSS 裡，**新古銅 `#7E6330` 出現 1 次，舊琥珀 `#d4860a` 出現 469 次**。

### 二、Element Plus 整套仍是樣板藍

`app/assets/styles/scss-tool/element-plus/index.scss` 掛在 `nuxt.config.ts` 的全域
`additionalData`，內容是樣板遺留色：

```
primary: #354d7b（樣板藍） · success: #00ADA9 · warning: #EB8B2D
danger/error: #EE5151 · info: #808080 · table header bg: #354d7b
```

Element Plus 由這個 `$colors` map 生成整條色階（按鈕、開關、日期選擇器、Tag、分頁、
focus ring、表格表頭）。也就是說 **admin 17 頁的元件全部沒有進入精品調**。

這是**階段 0 沒抓到的第二處色彩真相來源** —— W0b 收斂 `colors.scss` 時清掉了
`--primary: #354d7b`（`error.vue` 那處改接 `--ink`），但同一個色碼在 EP 的 SCSS map 裡活著，
而 `design-token-guards.spec.ts` 的守衛只掃 `--da-*` 與 `$font-*`，看不到 SCSS map 的 key。
**守衛有盲區，本次一併補。**

### 三、語意色 27 種值各自為政

狀態色（成功／等待／提示／錯誤）從來沒有 token，各頁自行挑色：

| 語意 | 硬編處數 | 相異色值 | 舉例 |
|------|---------|---------|------|
| good 成功 | 50 | **7** | `#059669` `#50c878` `#4ade80` `#16a34a` `#67c23a` `#2ecc71` `#22c55e` |
| stop 錯誤 | 89 | **9** | `#ef4444` `#f87171` `#e74c3c` `#b91c1c` `#dc2626` `#f56c6c` `#ee5151` … |
| note 提示 | 42 | **7** | `#2563eb` `#4338ca` `#3b82f6` `#64c8ff` `#409eff` … |
| wait 等待 | 15 | **4** | `#f5c518` `#fbbf24` `#f59e0b` `#e6a23c` |
| | **196** | **27** | |

這 27 個值全部是 Tailwind／Element Plus／Bootstrap 的預設色，飽和度遠高於精品調，
在骨白＋古銅的環境裡像貼紙。而且同一個「成功」在不同頁面是不同的綠。

### 四、5 處 `!important` 會擋 token

`important-audit.md` 的 A-1 清單。階段 0 明確只盤點不修，留給本階段。

## What Changes

四個階段，各自獨立 commit，破圖可歸因到單一階段。

### P1 — 舊色票殘留清除（363 處 / 86 檔）

機械替換，零設計決策。hex 與 `rgba()` 兩種寫法都換。
`rgba(212,134,10,.18)` 這種帶透明度的，換成 `color-mix(in srgb, var(--accent) 18%, transparent)`。

**驗收是 grep 歸零，不是肉眼**：舊色票 7 個值在 `app/` 下必須 0 命中，並由新守衛常態擋住。

### P2 — 語意色四件套（good / wait / note / stop）

新增 12 個 token（4 語意 × base／lit／wash），全部通過 WCAG AA。
196 處硬編狀態色收斂過去。`--danger` 改為 `var(--stop)` 的別名（見 design.md D3）。

### P3 — Element Plus 橋接

`scss-tool/element-plus/index.scss` 的 `$colors` map 換成精品調，
並在 `element-plus/_theme.css` 補 `--el-*` 對 token 的橋接（`--el-color-primary: var(--accent)` 等）。
表格表頭 `#354d7b` → `var(--ink)`。

### P4 — A 類 `!important` 修理 + 守衛補洞

A-1 那 5 處接上 token；`design-token-guards.spec.ts` 新增 3 條守衛：
舊色票不得復活 / 狀態色不得硬編 / EP 的 `$colors` map 不得寫死色碼。

## 不在本變更

- 版面重排（首頁 app 化、司機端、admin 17 頁）
- 玻璃退場（`var(--da-glass-*)` 86 處 + `backdrop-filter` 65 處）
- 尺度 token 的實際替換（圓角 656 次 / z-index 72 次 / 動效 / 斷點）
- 後台色票編輯 UI
- 深色模式
- 視覺基線 3 張空包彈（iPhone 14 的 `/booking` `/home` `/orders`）—— Brain AI 2026-08-27 指定不碰
- richmenu 字型重選 —— 只能由 Brain AI 在 admin 後台操作

## 風險

| 風險 | 緩解 |
|------|------|
| 363 處機械替換改錯語意（例：某處的 `#D4860A` 其實是刻意的第三方品牌色） | 逐檔看上下文再換，不做全域 `sed`；替換後 grep 歸零 + 33 張視覺基線逐張人工確認 |
| `rgba()` → `color-mix()` 瀏覽器支援 | `color-mix` 於 Chrome 111+ / Safari 16.2+ / Firefox 113+；專案已用 `oklch`／`backdrop-filter` 等同級特性。低透明度處若不放心可改用預先算好的 `--da-*` 衍生 token |
| EP 換色牽動 admin 全站元件，破圖面積最大 | 單獨一個 commit；視覺基線含 `/admin/orders` `/admin/dashboard` `/admin/settings` 三頁 × 3 project |
| 語意色重定義改變使用者對狀態的判讀 | 四色維持慣例色相（綠／橘／藍／紅），只降飽和度並拉高對比；全部標註實測對比值 |
| 又出現「第三處色彩真相來源」 | P4 的守衛把 EP 的 SCSS map 納入掃描範圍 |
