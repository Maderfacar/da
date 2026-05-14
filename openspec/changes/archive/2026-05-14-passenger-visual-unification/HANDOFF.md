# HANDOFF — 乘客端視覺統一（Wave 3-P1）

## ✅ 完工狀態（2026-05-14）

| Phase | Commit | 內容 |
|---|---|---|
| Phase 0 | `8fd78e0` | audit.md + proposal.md（4 軸對齊 baseline） |
| Phase 1 | `41a3382` | /orders + /orders/[id] cream 化（司機卡 dark accent） |
| Phase 2 | `8470d75` | /notifications + /notifications/[id] cream 化 |
| Phase 3 | `a306c5e` | /profile cream 化（fleet 已對齊不動） |
| Phase 4 | — | archive + HANDOFF + memory |

## 📦 變動清單

### 修改（5 個 dark theme 頁面 → cream theme）

- `app/pages/orders/index.vue` — 列表卡 + STATUS_COLOR cream 適配
- `app/pages/orders/[orderId].vue` — 詳情頁；**司機卡片採 dark accent**（var(--da-dark) 底 + cream 字 + amber 撥號鈕，對應 booking success-id pattern）
- `app/pages/notifications/index.vue` — 列表卡 + is-unread 用 amber-pale
- `app/pages/notifications/[id].vue` — 文章頁；rich content body 全部 dark 字色（rich-content.scss 無 color → 靠 inherit，不動）
- `app/pages/profile/index.vue` — user-card 24px radius 主卡 + section + 內小卡（rgba 白半透 + gray-pale border）

### 不動

- `app/pages/home/index.vue` — Wave 2 P4 剛上的 next-trip 設計（cream 已對齊）
- `app/pages/booking/index.vue` — baseline
- `app/pages/fleet/index.vue` — audit §2.7 確認已對齊

## 🎨 已凍決策（Claude 自決，Brain AI 已授權「依 cream 樣式決定」）

### 1. Radius 階層

- **主卡**（user-card / booking card）：**24px** → booking baseline
- **中卡**（list card / detail section）：**18px** → 與 home next-trip 20px 容差內
- **小卡**（meta-item / stat / support-row）：**12px**
- **Badge / chip / pill**：**100px** circle

### 2. rich-content.scss

無 color 宣告，靠 inherit。改 cream 後自動正確 → **不動 scss 檔**。

### 3. 司機資訊卡 dark accent

詳情頁 `.PageOrderDetail__section.is-driver` 採 `var(--da-dark)` 底 + `var(--da-cream)` 字，沿用 booking success-id pattern：
- 視覺重點突顯（cream 列中唯一深色卡）
- 撥號鈕 amber primary 高對比
- 司機 name / meta / avatar border 全部 cream-friendly

### 4. 取消按鈕

`rgba(220, 38, 38, 0.08)` light 底 + `#dc2626` border + `#dc2626` 字 + `rgba(220, 38, 38, 0.14)` hover。語意紅但 cream 親和。

### 5. STATUS_COLOR cream 適配

dark theme 用淺色 saturated（`#f59e0b` / `#38bdf8` / `#4ade80` / rgba 白）在 cream 底會發白看不清。改深色：

| Status | dark theme | cream theme |
|---|---|---|
| pending | `#f59e0b` | `#b45309` (amber-700) |
| confirmed | `#38bdf8` | `#1B4F8A` (navy) |
| en_route | `#a78bfa` | `#6d28d9` (violet-700) |
| arrived_pickup | `#22d3ee` | `#0e7490` (cyan-700) |
| in_transit | `#4ade80` | `#15803d` (green-700) |
| completed | `rgba(255,255,255,0.4)` | `#6B6560` (`var(--da-gray)`) |
| cancelled | `#f87171` | `#dc2626` |

## 🔍 驗收（手測項目，請在 prod 桌機 + 實機驗）

- [ ] 乘客端 6 頁面（除 booking）底色全部 `var(--da-cream)`
- [ ] /orders 列表卡點擊跳詳情 + 取消按鈕（cream 紅 light）+ STATUS_COLOR 各狀態正確顯示
- [ ] /orders/[id] 司機卡 dark accent（confirmed 後才顯示）+ 路線 / meta 資訊 / 取消按鈕
- [ ] /notifications 列表卡 + is-unread 用 amber-pale 標示 + 紅點
- [ ] /notifications/[id] 文章頁（含 rich-content）+ 返回 pill + CTA 按鈕
- [ ] /profile user-card + section + stat + support 顯示正常
- [ ] /fleet 與其他頁面同調
- [ ] 手機 375 / 414 寬度檢視
- [ ] 不破壞既有功能：取消訂單 / 標已讀 / 撥打司機電話 / 切日期 filter / 搜尋 / 看詳情

## ⚠️ 留尾（**非** Wave 3-P1 範圍）

- 字級 `$fs-*` token 全面遷移（hardcode px → 變數）— 另開 wave 處理
- 字級 9-11px 已有 P25 留尾「最小可讀字級 12px」— 本 wave **未動既有 9-11px**
- admin / driver 端視覺保留（仍 dark theme，正確配位）

## 📝 commit chain

```
8fd78e0 docs(Wave3-P1 Phase 0): 乘客端視覺對齊 audit + proposal
41a3382 feat(Wave3-P1 Phase 1): orders + orders/[id] cream 化
8470d75 feat(Wave3-P1 Phase 2): notifications + notifications/[id] cream 化
a306c5e feat(Wave3-P1 Phase 3): profile cream 化（fleet 已對齊 audit 確認）
{Phase 4 commit hash}  chore(Wave3-P1): archive openspec change + HANDOFF
```

Base：`1b92ab8`（Wave 3-A1 收尾）
