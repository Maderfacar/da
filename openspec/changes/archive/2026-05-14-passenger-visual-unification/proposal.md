# 2026-05-14 — 乘客端視覺統一（Passenger Visual Unification / Wave 3-P1）

## Why

乘客端 7 個頁面分裂成兩個視覺家族，UX 跳 tier：

- **Cream 家族**（與 booking 同調）：`/booking` ✅ + `/home` ✅ + `/fleet` ⚠️（卡片 radius 不一致）
- **Dark 家族**（admin/driver 風格錯置在乘客端）：`/orders` / `/orders/[id]` / `/notifications` / `/notifications/[id]` / `/profile`

Brain AI 巡視時痛點：「乘客端原本應該是 booking 的美式復古機場風（cream + amber + Bebas Neue + glass card），但 5 個頁面跑成 dark theme 像 admin 後台。」

Wave 3-P1 將 5 個 dark theme 頁面重做為 cream theme，並把 fleet 的卡片 radius 對齊 booking。**只動視覺**，所有功能 / 互動 / API 全保留。

## What Changes

依 Brain AI 拍板 **4 軸對齊**：

### 軸 ① — 底色

- 全部換 `var(--da-cream)`（#F5F2EC）為主底，可選擇 section 用 `var(--da-off-white)` 交錯
- 移除既有 `$bg: #0d1117` 局部 SCSS 變數

### 軸 ② — 文字（字型 + 字級層級）

- **主字型**：`'Bebas Neue', sans-serif`（display）/ `'Barlow Condensed', sans-serif`（label/condensed）/ `'Noto Sans TC', sans-serif`（body）
- 統一在每個檔頭宣告 `$font-display` / `$font-condensed` / `$font-body` 變數（與 booking / home / fleet 一致）
- 字級**沿用既有 hardcode px**（booking 也是 px，不為了 Wave 3-P1 強推 `$fs-*` token 遷移；改 token 留給後續清理 wave）

### 軸 ③ — 文字顏色

- 主文字：`var(--da-dark)`（#1A1814）
- 次要文字：`var(--da-gray)`（#6B6560）
- 輔助 / hint：`var(--da-gray-light)`（#B8B3AC）
- amber 強調：`var(--da-amber)` / `var(--da-amber-light)`
- 移除 hardcode `#fff`、`rgba(255,255,255,*)` 等 dark theme 文字色

### 軸 ④ — 版面（卡片 / spacing / radius）

- **主卡片**：`var(--da-glass-bg)` + `var(--da-glass-border)` + `border-radius: 24px` + `box-shadow: var(--da-glass-shadow)` + `backdrop-filter: blur(12px)`
- 小卡 / 內元素：保留 12-16px radius，但須與 booking 內元素風格對齊
- watermark：`'Bebas Neue'` 巨大字 opacity 0.04（fixed 右上）— **選擇性**加（每頁不強迫）
- spacing：`padding: 76px 16px 120px`（fixed nav 56 + 20 gap + bottom 留白）

## Out of Scope（明確不做）

- ❌ 不動 admin / driver 端視覺
- ❌ 不動任何 server / API
- ❌ 不改 layout 行為（只改視覺）
- ❌ 字級不強推 `$fs-*` token migration（後續另開 wave 處理）
- ❌ 不動 PageOrders/PageOrderDetail/PageNotifications 等元件**結構**（只改 SCSS scoped）

## Impact

### 影響範圍

- **改 5 個 dark theme 頁面**：orders / orders[id] / notifications / notifications[id] / profile
- **小改 1 頁**：fleet selector-btn 不變但補對齊（radius 一致性）
- **不改**：booking / home（baseline + 已對齊）

### 風險

| 風險 | 緩解 |
|---|---|
| dark → cream 大改可能破壞既有功能（badge / dialog / toast 顏色斷裂） | 一頁一頁改，每頁改完手測；用 `var()` 而非 hardcode 確保跨端一致 |
| 詳情頁 status badge 顏色差異大 | 沿用 booking step-dot 的 amber-pale / amber 配色，定義通用 badge mixin |
| 上線後個別頁面看起來突兀 | 每改 1-2 頁就 commit + push，可隨時 rollback 單頁 |

### 估時

- **Phase 0**（audit + report）：~1h ← 本檔
- **Phase 1**（orders/* 2 頁）：~1.5h
- **Phase 2**（notifications/* 2 頁）：~1.5h
- **Phase 3**（profile + fleet 微調）：~1.5h
- **Phase 4**（手測 + archive）：~0.5h

**總計 ~6h**，可單日內完成。

## 部署流程

每 Phase 收尾後 commit + push origin HEAD:main，Vercel 自動部署，下個 Phase 基於 prod 狀態繼續。

詳細的頁面 baseline / 現況 / diff / 要改的 SCSS 條目見 [audit.md](audit.md)。
