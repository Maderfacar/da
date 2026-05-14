# Audit — 乘客端 7 頁面視覺對齊（Wave 3-P1 Phase 0）

> Brain AI 拍板 4 軸對齊：①底色 ②文字（字型 + 字級層級） ③文字顏色 ④版面設計（卡片 / spacing / radius）。
> 不動 admin / driver 端；不動 server / API；不動 layout 行為。

## 1. /booking baseline（標準參照）

[booking/index.vue](../../../app/pages/booking/index.vue) — Brain AI 指定的設計家族基準。

### 1.1 SCSS 變數抽取

```scss
// 字型（檔內未宣告變數，直接 hardcode 字串）
'Bebas Neue', sans-serif       // display 巨字 (hero title / success title / id strong)
'Barlow Condensed', sans-serif // label / kicker / step / id span
'Noto Sans TC', sans-serif     // body 內文

// CSS variables（來自 _theme-colors.css）
var(--da-cream)        // 主底 #F5F2EC
var(--da-off-white)    // 副底 #FAF8F4
var(--da-amber)        // 強調 #D4860A
var(--da-amber-light)  // 強調次色 #F0A830
var(--da-amber-pale)   // 強調背景 #FDF3DC
var(--da-dark)         // 主文字 #1A1814
var(--da-gray)         // 次要文字 #6B6560
var(--da-gray-light)   // hint #B8B3AC
var(--da-gray-pale)    // 邊框 #E8E4DC
var(--da-glass-bg)     // 卡片背景 rgba(250,248,244,0.72)
var(--da-glass-border) // 卡片邊框 rgba(212,134,10,0.18)
var(--da-glass-shadow) // 卡片陰影
```

### 1.2 4 軸 baseline 規格

| 軸 | 規格 | 來源類名 |
|---|---|---|
| ① 底色 | `background: var(--da-cream)` + `min-height: 100vh` + `padding: 76px 16px 120px` | `.PageBooking` |
| ② 字型 | hero `'Bebas Neue' 36px`；kicker `'Barlow Condensed' 12px ls 0.2em`；body `'Noto Sans TC' 13-14px` | `__success-title` / `__success-sub` |
| ③ 文字色 | 主 `var(--da-dark)`；amber 強調 `var(--da-amber)` / `var(--da-amber-light)`；hint `var(--da-gray-light)` | 全檔 |
| ④ 版面 | 主卡 `var(--da-glass-bg)` + `var(--da-glass-border)` + `border-radius: 24px` + `padding: 24px 20px` + `backdrop-filter: blur(12px)` + soft shadow | `.PageBooking__card` |

### 1.3 額外設計元素

- **Watermark**：右上 fixed `'Bebas Neue' 120px var(--da-dark) opacity: 0.04`，配 `floatY 8s` 動畫
- **Step dot**：32px 圓 + 2px `var(--da-gray-pale)` border；active 切 `var(--da-amber)` 底 + 白字；done 切 `var(--da-amber-pale)` 底 + amber 字
- **Success 卡**：`var(--da-dark)` 底 + amber-light strong 字，特殊 dark accent 卡

---

## 2. 6 個目標頁面現況

### 2.1 ✅ /home — Cream 家族（已對齊，**不動**）

[home/index.vue](../../../app/pages/home/index.vue)

| 軸 | 現況 |
|---|---|
| ① 底色 | `var(--da-off-white)` 主 + section `var(--da-cream)` 交錯 ✅ |
| ② 字型 | 檔頭宣告 `$font-display/$font-condensed/$font-body` ✅ |
| ③ 文字色 | 全部 `var(--da-*)` ✅ |
| ④ 版面 | trip card `var(--da-glass-bg)` + 20px radius；Wave 2 P4 新增的 next-trip-empty 用 dashed amber CTA |

**Diff**：trip card radius 是 20px，booking 是 24px。**容差範圍內**，本 wave **不調**（避免破壞 Wave 2 P4 剛上線設計）。

---

### 2.2 ❌ /orders — Dark 家族（**要重做**）

[orders/index.vue](../../../app/pages/orders/index.vue)

| 軸 | 現況 | 要改成 |
|---|---|---|
| ① 底色 | `$bg: #0d1117` ❌ | `var(--da-cream)` |
| ② 字型 | hardcode `'Bebas Neue'`/`'Barlow Condensed'`/`'Noto Sans TC'` 散落 | 抽 `$font-*` 變數（沿用 home / fleet 慣例） |
| ③ 文字色 | 主 `#fff` / 副 `rgba(255,255,255,0.4)` ❌ | 主 `var(--da-dark)` / 副 `var(--da-gray)` / hint `var(--da-gray-light)` |
| ④ 卡片 | `$surface: rgba(255,255,255,0.04)` + `$border: rgba(255,255,255,0.07)` + 16px radius ❌ | `var(--da-glass-bg)` + `var(--da-glass-border)` + 24px radius + glass shadow |

**具體要改的類名 + 變數**：

```scss
.PageOrders                    // background: $bg → var(--da-cream)；color: #fff → var(--da-dark)
.PageOrders__header-label      // color: $amber → var(--da-amber)（hardcode → CSS var）
.PageOrders__header-title      // color: #fff → var(--da-dark)
.PageOrders__empty-text        // color: rgba(255,255,255,0.4) → var(--da-gray)
.PageOrders__empty-link        // background: $amber → var(--da-amber)；保留白字
.PageOrders__card              // background: $surface → var(--da-glass-bg)；border-color → var(--da-glass-border)；border-radius: 16px → 18px（與 home trip card 對齊，補 box-shadow + backdrop-filter）
.PageOrders__cancel            // 紅色保留但底色從 dark rgba 改 var(--da-amber-pale) family 或保留 alert red；建議保留 #f87171 系列但換 light surface
.PageOrders__type-badge        // color: $amber → var(--da-amber)；background: rgba($amber, 0.1) → var(--da-amber-pale)
.PageOrders__route-line        // background: rgba(255,255,255,0.12) → var(--da-gray-pale)
.PageOrders__route-addr        // color: rgba(255,255,255,0.75) → var(--da-dark) opacity 或 var(--da-gray)
.PageOrders__card-footer       // border-top: 1px solid $border → var(--da-gray-pale)
.PageOrders__date              // color: rgba(255,255,255,0.4) → var(--da-gray-light)
.PageOrders__vehicle           // 同上
.PageOrders__fare              // color: $amber → var(--da-amber)
```

**Token 對應**：刪除檔頭 `$bg / $surface / $border / $amber` 4 個局部變數，全部改 `var(--da-*)`。

---

### 2.3 ❌ /orders/[orderId] — Dark 家族（**要重做**）

[orders/[orderId].vue](../../../app/pages/orders/[orderId].vue)

| 軸 | 現況 | 要改成 |
|---|---|---|
| ① 底色 | `$bg` dark ❌ | `var(--da-cream)` |
| ② 字型 | hardcode | 抽 `$font-*` |
| ③ 文字色 | 主 `#fff` + 細粒度 `rgba(255,255,255,0.45)` 多處 | 全部 → `var(--da-dark)` / `var(--da-gray)` / `var(--da-gray-light)` |
| ④ 卡片 | dark surface 多張卡 | `var(--da-glass-bg)` + 24px radius |

**具體要改的類名**（從 [orders/[orderId].vue](../../../app/pages/orders/[orderId].vue) line 239 起 SCSS）：

```scss
.PageOrderDetail               // background: $bg → var(--da-cream)
.PageOrderDetail__back-btn     // border / background → light glass family
.PageOrderDetail__status       // 沿用 badge mixin（pending / confirmed / progress / done / cancelled）
.PageOrderDetail__driver-card  // dark surface → var(--da-glass-bg)
.PageOrderDetail__route-card   // 同上
.PageOrderDetail__info-card    // 同上
.PageOrderDetail__call-btn     // amber primary 保留
```

**注意**：詳情頁有「司機卡片」+ 「路線卡片」+ 「資訊卡片」+ 「狀態歷史」多個卡，全部統一換 cream 版 `.PageOrderDetail__card` 通用樣式。

---

### 2.4 ❌ /notifications — Dark 家族（**要重做**）

[notifications/index.vue](../../../app/pages/notifications/index.vue)

| 軸 | 現況 | 要改成 |
|---|---|---|
| ① 底色 | `$bg` dark ❌ | `var(--da-cream)` |
| ② 字型 | hardcode | 抽 `$font-*` |
| ③ 文字色 | 主 `#fff` | `var(--da-dark)` |
| ④ 卡片 | `$surface` rgba(255,255,255,0.04) + 12px radius | `var(--da-glass-bg)` + 18px radius |

**具體要改的類名**：

```scss
.PageNotifications             // background: $bg → var(--da-cream)
.PageNotifications__header-*   // 沿用 orders/header pattern
.PageNotifications__card       // dark surface → var(--da-glass-bg) + 18px radius
.PageNotifications__card-title // color: #fff → var(--da-dark)
.PageNotifications__card-excerpt // color: rgba(255,255,255,0.6) → var(--da-gray)
.PageNotifications__unread-dot // dot 仍 amber（保留）
.PageNotifications__card-date  // color: muted → var(--da-gray-light)
```

---

### 2.5 ❌ /notifications/[id] — Dark 家族（**要重做**）

[notifications/[id].vue](../../../app/pages/notifications/[id].vue)

| 軸 | 現況 | 要改成 |
|---|---|---|
| ① 底色 | `$bg` dark ❌ | `var(--da-cream)` |
| ② 字型 | hardcode | 抽 `$font-*` |
| ③ 文字色 | 主 `#fff` + rich content text 白系 | 主 `var(--da-dark)` + content text `var(--da-gray)` |
| ④ 版面 | back-btn dark glass + hero image + body card | back-btn light glass + hero 保留 + body cream card |

**具體要改的類名**：

```scss
.PageNotificationDetail        // background: $bg → var(--da-cream)
.PageNotificationDetail__back  // dark glass → light glass family（rgba 透明的反相）
.PageNotificationDetail__title // color: #fff → var(--da-dark)
.PageNotificationDetail__meta  // muted → var(--da-gray-light)
.PageNotificationDetail__hero img // 保留圖片，無需改
.PageNotificationDetail__body  // 富文本 .g-rich-content；確認 rich-content.scss 預設色為 dark 或加 cream override
.PageNotificationDetail__cta-btn // amber primary 保留
```

**特別注意**：本頁用 `rich-content.scss` 渲染 announcement HTML body — 需確認該 scss 文字色已是 dark 系（或用 `:where(.cream-theme)` 包裹強制）。

---

### 2.6 ❌ /profile — Dark 家族（**要重做**）

[profile/index.vue](../../../app/pages/profile/index.vue)

| 軸 | 現況 | 要改成 |
|---|---|---|
| ① 底色 | `$bg` dark ❌ | `var(--da-cream)` |
| ② 字型 | hardcode | 抽 `$font-*` |
| ③ 文字色 | 主 `#fff` 多處 | `var(--da-dark)` |
| ④ 卡片 | dark surface 20px radius | `var(--da-glass-bg)` 24px radius |

**具體要改的類名**：

```scss
.PageProfile                   // background: $bg → var(--da-cream)
.PageProfile__header-*         // 沿用 orders header pattern
.PageProfile__user-card        // dark surface 20px → var(--da-glass-bg) 24px
.PageProfile__avatar           // border / background 微調
.PageProfile__user-name        // color: #fff → var(--da-dark)
.PageProfile__user-uid         // color muted → var(--da-gray-light)
.PageProfile__menu-item        // dark hover → light glass hover
.PageProfile__logout-btn       // alert red 保留但底色換 cream
```

---

### 2.7 ⚠️ /fleet — Cream 家族（**微調**）

[fleet/index.vue](../../../app/pages/fleet/index.vue)

| 軸 | 現況 | 要改成 |
|---|---|---|
| ① 底色 | `var(--da-cream)` ✅ | — |
| ② 字型 | `$font-display/$font-condensed/$font-body` ✅ | — |
| ③ 文字色 | 全 `var(--da-*)` ✅ | — |
| ④ 版面 | 主卡 `.PageFleet__detail-card` 24px radius ✅；selector-btn 14px radius ✅；spec-row 12px ✅ | — |

**Diff**：fleet 已對齊 booking。本 wave **不改**（除非 Phase 3 收尾發現微小不一致再補）。

---

## 3. 共通 Token 整理

### 3.1 既有 `var(--da-*)` token（已存在 `_theme-colors.css`）

✅ 不需新增 token，全部沿用 booking / home / fleet 既有變數。

### 3.2 SCSS 變數命名慣例（每檔頭宣告）

```scss
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;
```

5 個要改的頁面**每頁都要補上**此 3 行（與 home / fleet 一致）。

### 3.3 通用卡片 mixin（建議，**選擇性**）

可在 `app/assets/styles/scss-tool/mixin.scss` 補一個共用 mixin：

```scss
@mixin glass-card($radius: 24px, $padding: 20px) {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: $radius;
  padding: $padding;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
}
```

**判斷**：是否抽 mixin 留到 Phase 1 改第一頁時決定。若 5 個頁面 card 樣式高度重複再抽；否則直接 inline scss 即可。

### 3.4 Status badge 共通配色

訂單狀態 badge 跨多頁出現（orders / orders[id]）。建議統一規格：

```scss
.is-pending   { background: rgba(26,24,20,0.06);  color: var(--da-dark);  border: 1px solid rgba(26,24,20,0.15); }
.is-confirmed { background: var(--da-amber-pale); color: var(--da-amber); border: 1px solid rgba(212,134,10,0.25); }
.is-progress  { background: rgba(56,189,248,0.10); color: #1B4F8A;         border: 1px solid rgba(56,189,248,0.20); }
.is-done      { background: rgba(34,197,94,0.10);  color: #16a34a;         border: 1px solid rgba(34,197,94,0.20); }
.is-cancelled { background: rgba(239,68,68,0.08);  color: #dc2626;         border: 1px solid rgba(239,68,68,0.15); }
```

（沿用 P19 既有的 cream version，已存在於 [upcoming/index.vue](../../../app/pages/upcoming/index.vue) 但該頁已於 Wave 2 P4 刪除 → 抽到 mixin 或在 orders 第一個改時 inline 即可）

---

## 4. Phase 拆分

| Phase | 範圍 | 預估 | commit |
|---|---|---|---|
| **Phase 0** | 本 audit + proposal | 完成 | ← 本次 |
| **Phase 1** | `/orders` + `/orders/[id]` 重做 | 1.5h | `feat(Wave3-P1 Phase 1): orders 系列 cream 化` |
| **Phase 2** | `/notifications` + `/notifications/[id]` 重做 | 1.5h | `feat(Wave3-P1 Phase 2): notifications 系列 cream 化` |
| **Phase 3** | `/profile` 重做 + fleet 微調 | 1.5h | `feat(Wave3-P1 Phase 3): profile cream 化 + fleet 微調` |
| **Phase 4** | 手測 + archive openspec | 0.5h | `chore(Wave3-P1): archive openspec change — 視覺驗收通過` |

每 Phase 收尾後 push origin HEAD:main，Vercel 自動部署。

---

## 5. 驗收標準

- [ ] 6 個目標頁面底色全部 `var(--da-cream)`（或 off-white）
- [ ] 主卡片全部 `var(--da-glass-bg)` + 24px radius（小卡可保留 12-18px）
- [ ] 主文字色 `var(--da-dark)`；次要 `var(--da-gray)`；hint `var(--da-gray-light)`
- [ ] 強調色 amber 全部走 CSS var（不再 `$amber: #d4860a` 局部變數）
- [ ] 每頁檔頭宣告 `$font-display/$font-condensed/$font-body` 三個變數
- [ ] 不破壞既有功能：取消訂單 / 標已讀 / 撥打司機電話 / 切日期 filter / 詳情頁 / 司機資訊撥號等
- [ ] 手機（375 / 414）+ 桌機 visual check
- [ ] pnpm lint + pnpm build 每 Phase 通過

---

## 6. 待 Brain AI 確認的決策點

1. **小卡片 radius**：booking 主卡 24px；orders/notifications 卡片 list 是「中卡」尺寸，建議 18px（與 home next-trip 對齊），是否同意？
2. **rich-content.scss 文字色**：notifications/[id] 用 `.g-rich-content` 渲染 HTML，需要確認該 scss 文字色已是 dark 系或要加 cream override — 進 Phase 2 時看實際狀態決定
3. **訂單詳情頁「司機資訊卡」深色 accent**：booking success-id 用 `var(--da-dark)` 底 + amber strong 做深色 accent — 是否在 orders[id] driver card 沿用同樣設計（與 booking 呼應）？
4. **取消按鈕色系**：dark theme 用 `#f87171` red；cream version 是否改 `var(--da-amber-pale)` + `#dc2626`？

**建議**：1 / 2 / 4 由 Claude 在 Phase 1 開始時實作，找不滿意再退回問；3 留給 Brain AI 確認。
