# 樣式指南 (Style Guide) — Destination Anywhere 設計系統

> 美式復古機場風格（Retro Airport Americana）  
> 本文件定義 DestinationAnywhere 的視覺規範，涵蓋色彩、字體、元件模式與動態效果。  
> Element Plus 元件的覆蓋規則見 `.claude/knowledge/frontend-conventions.md`。

## 1. 核心設計語言

| 原則 | 說明 |
|------|------|
| **復古機場美學** | Bebas Neue 大標、黃黑斜條紋分隔、機場代碼浮水印（TPE / JFK / NRT） |
| **溫潤淺色系** | 米白 `#F5F2EC` + 暖奶油 `#FAF8F4`，琥珀金點綴 `#D4860A` |
| **毛邊玻璃** | `backdrop-filter: blur(20px) saturate(180%)` 用於卡片、表單、導航 |
| **行動優先** | 所有版面預設 375px 手機，僅必要時加 breakpoint |
| **No-Border Rule** | 區塊分隔用斜條紋 `stripe-divider` 或背景色切換，禁止純色細線分割大區塊 |

## 2. 色彩系統

CSS Custom Properties 已定義於 `app/assets/styles/css-class/_theme-colors.css`。

| 變數 | Hex | 用途 |
|------|-----|------|
| `--da-cream` | `#F5F2EC` | 主要頁面背景、卡片底色 |
| `--da-off-white` | `#FAF8F4` | 次要背景（交替 section） |
| `--da-amber` | `#D4860A` | 主要強調色、CTA、標籤 |
| `--da-amber-light` | `#F0A830` | 數字展示、hover 狀態 |
| `--da-amber-pale` | `#FDF3DC` | 圖示背景、歷史項目圖示 |
| `--da-dark` | `#1A1814` | 主文字色、深色背景（Stats Bar、Footer） |
| `--da-dark-mid` | `#2E2B25` | 深色斜條紋 |
| `--da-gray` | `#6B6560` | 次要文字、說明文字 |
| `--da-gray-light` | `#B8B3AC` | 標籤文字、佔位色 |
| `--da-gray-pale` | `#E8E4DC` | 分隔線、輸入框邊框 |
| `--da-stripe-yellow` | `#F5C842` | 斜條紋黃 |
| `--da-stripe-dark` | `#2A2620` | 斜條紋深 |
| `--da-glass-bg` | `rgba(250,248,244,0.72)` | 玻璃卡片背景 |
| `--da-glass-border` | `rgba(212,134,10,0.18)` | 玻璃卡片邊框 |
| `--da-glass-shadow` | — | 玻璃卡片陰影（雙層） |

**SCSS 使用方式：**
```scss
color: var(--da-amber);
background: var(--da-dark);
border: 1px solid var(--da-glass-border);
```

## 3. 字體排印

已透過 `@nuxt/fonts` 自動載入 Google Fonts。

| 字體 | 用途 | 字重 |
|------|------|------|
| **Bebas Neue** | Hero 大標、章節標題、統計數字、Logo | 400 |
| **Barlow Condensed** | 標籤、標章、按鈕文字、Tab | 400 / 700 / 900 |
| **Barlow** | 內文、說明文字 | 300 / 400 / 500 / 700 |
| **Noto Sans TC** | 所有中文文字 | 300 / 400 / 700 |

**字體堆疊：**
```scss
font-family: 'Bebas Neue', sans-serif;          // 大標
font-family: 'Barlow Condensed', sans-serif;    // 標籤/標章
font-family: 'Barlow', 'Noto Sans TC', sans-serif; // 內文
```

**字體尺寸模式：**
- Hero 大標：`clamp(72px, 22vw, 108px)`
- 章節標題：`clamp(42px, 12vw, 56px)`
- 標籤：`11px` letter-spacing `0.2em` uppercase
- 內文：`14px–15px` line-height `1.6–1.8`

## 4. 間距與圓角

| 用途 | 值 |
|-----|-----|
| 卡片圓角（Trip / Fleet） | `20–24px` |
| 按鈕圓角（Pill） | `100px` |
| 按鈕圓角（大 CTA） | `12–14px` |
| 輸入框圓角 | `12px` |
| Section 垂直間距 | `72px 24px` |
| 卡片內距 | `20–28px` |

## 5. 核心元件模式

### Stripe Divider（斜條紋分隔線）
```scss
.stripe-divider {
  height: 12px;
  background: repeating-linear-gradient(
    -45deg,
    var(--da-stripe-yellow) 0px, var(--da-stripe-yellow) 12px,
    var(--da-stripe-dark) 12px, var(--da-stripe-dark) 24px
  );
  opacity: 0.85;
}
```

### Glass Card（毛邊玻璃卡片）
```scss
.glass-card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 20px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
}
```

### Top Nav（固定導航）
```scss
nav {
  backdrop-filter: blur(20px) saturate(180%);
  background: rgba(250, 248, 244, 0.82);
  border-bottom: 1px solid var(--da-glass-border);
  height: 56px;
}
```

### Bottom Nav（底部 Tab Bar）
- 高度 64px
- 毛玻璃背景（同 Top Nav）
- `padding-bottom: env(safe-area-inset-bottom, 12px)` 支援 iPhone 瀏海

### Airport Flip Board（機場翻牌統計）
- 深色背景 `--da-dark`
- 數字使用 Bebas Neue，顏色 `--da-amber-light`
- 啟動時執行翻牌動畫：隨機字符快速循環後定格在最終值
- 動畫：`@keyframes flip-in { 0% { transform: rotateX(90deg); opacity: 0; } 100% { rotateX(0deg); opacity: 1; } }`

### Section Label（章節標籤）
```scss
.section-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 10px;
  &::before {
    content: '';
    width: 24px;
    height: 1.5px;
    background: var(--da-amber);
  }
}
```

### Airport Badge（機場代碼浮水印）
- 絕對定位，`opacity: 0.06`
- 字體 Bebas Neue，字級 60–120px
- 三個代碼：TPE（右上）、JFK（左中）、NRT（右中）
- 套用 `@keyframes floatY`（垂直浮動，振幅 12px）

## 6. 動畫系統

| 名稱 | 用途 | 說明 |
|------|------|------|
| `fadeUp` | 元素入場 | `opacity 0→1, translateY 20→0` |
| `flyIn` | 飛機圖示 | `translateX(40px) rotate(-10deg) → 0` |
| `floatY` | 浮動物件 | `translateY 0 ↔ -12px`，週期 6–10s |
| `pulse` | 狀態圓點 | `opacity + scale`，週期 2s |
| `flip-in` | 翻牌效果 | `rotateX(90deg) → 0`，duration 0.1s |
| `scroll-left` | —（已廢棄） | 改用翻牌取代 |

### Scroll Reveal
```ts
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) e.target.classList.add('visible')
  })
}, { threshold: 0.1 })
```
```scss
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.6s ease, transform 0.6s ease;
  &.visible { opacity: 1; transform: translateY(0); }
}
```

## 7. 元件命名慣例（DA 專屬）

| 前綴 | 適用 | 範例 |
|------|------|------|
| `UiButton` | 原子按鈕 | `UiButtonPrimary`, `UiButtonGlass` |
| `UiCard` | 卡片容器 | `UiCardGlass`, `UiCardDark` |
| `UiInput` | 輸入框 | — |
| `UiModal` | 彈窗底 sheet | — |
| `UiToast` | 提示訊息 | — |
| `UiBadge` | 狀態標籤 | `UiBadgeConfirmed`, `UiBadgePending` |
| `TripCard` | 行程卡片 | `TripCardUpcoming` |
| `Passenger` | 乘客業務 | `PassengerBookForm` |

## 8. Do's and Don'ts

**✅ Do's**
- 使用 CSS 變數（`var(--da-*)`）管理所有顏色
- 章節間隔用 `stripe-divider` 或背景色切換
- 卡片一律套用 `glass-card` 模式
- 所有動畫套用 `will-change: transform` 提升效能
- 中文標籤下方附英文小標（增強機場風格）

**❌ Don'ts**
- 禁止使用純色細線分割大區塊
- 禁止跑馬燈（marquee/scroll-left）—— 已改為翻牌效果
- 禁止純黑色（改用 `--da-dark #1A1814`）
- 禁止硬編碼 Hex（在 `_theme-colors.css` 中定義）
- 禁止 `!important`

---

**版本紀錄**
- 版本：v2.0（全面改版為美式復古機場風，替換 Editorial Horizon 設計語言）
- 更新日期：2026/04/26
