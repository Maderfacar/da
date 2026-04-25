# 樣式指南 (Style Guide) — Editorial Horizon

> 本文件定義 DestinationAnywhere 的 Tailwind CSS + 自定義 Ui* 元件樣式規範。  
> Element Plus 元件的覆蓋規則見 `.claude/knowledge/frontend-conventions.md`。

## 1. 核心設計原則

- **核心北極星**：通透、呼吸、權威
- **大量留白**：每個元件都要有充足呼吸空間（≥ 24px 垂直間距）
- **No-Line Rule**：**嚴禁**使用 1px 純色實線分割區塊（改用背景色階切換）
- **玻璃擬態（Glassmorphism）**：浮動元素使用半透明 + backdrop-blur
- **行動版優先**：所有樣式預設以手機為基準，僅必要時加 `md:` / `lg:`

## 2. 色彩系統（需在 tailwind.config.js 定義語義化顏色）

| 語義名稱 | Hex（Light Mode） | 說明 |
|---------|-----------------|------|
| `background` | `#F8F9FA` | 極輕微暖白底色 |
| `primary` | `#051125` | 深沉午夜藍 |
| `secondary` | `#47607E` | 煙燻藍 |
| `on-primary` | `#FFFFFF` | 主色上的文字 |
| `surface` | — | 基礎表面色 |
| `surface-container-low` | — | 色調堆疊（低） |
| `surface-container-highest` | — | 色調堆疊（最高） |

**Dark Mode**：所有顏色定義 `dark:` variant，只需切換 `html.dark` class。

**使用方式（Tailwind）**：
```html
<div class="bg-primary text-on-primary">...</div>
<div class="bg-surface-container-low dark:bg-surface-container-low">...</div>
```

**玻璃擬態統一類別**（定義於 tailwind.config.js 或 main.css）：
```css
.glass { background: rgba(255,255,255,0.12); backdrop-filter: blur(20px); }
.glass-card { background: rgba(255,255,255,0.08); backdrop-filter: blur(20px); }
```

## 3. 字體排印

- **標題 / Display**：Manrope，字重 600
- **內文 / Label / Body**：Inter，字重 400 / 500
- **繁體中文**：行高 1.6 ~ 1.8，避免過緊字距

透過 `@nuxt/fonts` 載入，禁止硬編碼字體家族。

## 4. 間距與圓角

| 用途 | 值 | Tailwind |
|-----|-----|---------|
| 按鈕 / 一般元件 | 16px | `rounded-[16px]` |
| 卡片 / 大容器 | 32px | `rounded-[32px]` |
| 垂直間距基準 | ≥ 24px | `gap-6` / `py-6` |

## 5. 元件具體規範

### UiButton
- Primary：`bg-primary text-on-primary rounded-[16px]`
- Hover：透明度 +10%；Active：`scale-98`
- Glass：`glass rounded-[16px]`
- **禁止**使用標準 border

### UiCard
- 圓角：32px
- **嚴禁** `<hr>` 或 `border`
- 內容分隔用垂直間距 + 背景色階

### UiInput
- 底色：`bg-surface-container-highest`
- 無邊框；焦點狀態：2px `primary` 底線
- 可點擊區域 ≥ 44px（手機可用性）

### 陰影
- 浮動元素：`blur(40px)` spread `-10px` 透明度 4%~8%

## 6. Tailwind 配置待辦

```js
// tailwind.config.js（尚未建立，Stage 2 前必須完成）
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'primary': '#051125',
        'secondary': '#47607E',
        'on-primary': '#FFFFFF',
        'background': '#F8F9FA',
        // ... 其他語義化顏色
      }
    }
  }
}
```

## 7. Do's and Don'ts

**✅ Do's**
- 大量留白與呼吸空間
- 使用語義化顏色類別（`bg-primary` 而非 `bg-[#051125]`）
- 行動版優先開發
- 同時支援 Light / Dark Mode

**❌ Don'ts**
- 禁止 1px 純色實線（No-Line Rule）
- 禁止使用純黑色（改用 `primary` 色）
- 禁止硬編碼 Hex（除在 tailwind.config.js 定義）
- 禁止 `!important`（Element Plus 覆蓋用 `:deep()`）

---

**版本紀錄**
- 版本：v1.1（新增 Element Plus 並行說明 + tailwind.config.js 配置待辦）
- 更新日期：2026/04/26
