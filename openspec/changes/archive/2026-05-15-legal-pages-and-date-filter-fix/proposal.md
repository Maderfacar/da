# 2026-05-15 — 乘客端 Legal Pages（會員條款 / 隱私政策）+ DateRangeFilter cream theme 修色

> **狀態**：Brain AI 預先拍板「直接做完 / 預設即可」— Q1-Q4 全推預設。
> **規模**：1.0-1.5 工作天 / 5 Phase。

## Why

1. **`/orders` 頁面年/月/日切換 + 日期 input 文字看不清**：UiDateRangeFilter 在 Wave 1 設計時走 dark theme（白色 input / 半透明白 placeholder / 白色文字），但 Wave 3-P1 把乘客 `/orders` 重做為 cream theme 後，白色 input 在 cream 底色上**幾乎不可辨識**。元件雖有 `size-md` 註解寫「淺色版」但**實際只調 size 沒覆蓋色系**。
2. **乘客端缺「會員服務條款 / 隱私權政策」兩頁面**：法務 / GDPR / App Store 上架（如未來打包 Capacitor）通常都需要這兩頁公開可讀。現況乘客點 drawer 沒入口、也沒任何 footer link。
3. **admin 必須能改文字內容**：條款 / 政策內容會因業務調整變動（例如新增金流支付、調整退費政策、加 LINE OA Push 同意條款），不能 hard-code 到前端 i18n 檔；走 admin 後台編輯。

## What Changes

### 1. DateRangeFilter cream theme（Q1=A 最小改動）

`app/components/ui/DateRangeFilter.vue` 加 `theme: 'dark' | 'cream'` prop（預設 `'dark'`，不破壞既有 admin/driver 端使用）。`'cream'` 模式：

- input 文字 → `var(--da-dark)`
- input 邊框 → 灰底 `rgba(26, 24, 20, 0.18)`
- input 背景 → `rgba(255, 255, 255, 0.65)`
- granularity 按鈕未啟動 → `var(--da-gray)`；啟動 → amber 同 dark
- placeholder → `rgba(26, 24, 20, 0.4)`
- `color-scheme: light`（避免 native date picker 用 dark mode）

乘客 `/orders` 頁面 UiDateRangeFilter 傳 `theme="cream"`。

### 2. Legal Pages 後端（Q2=A schema 簡單版）

新 collection `legal_pages/{key}`，key ∈ `'terms' | 'privacy'`：

```typescript
interface LegalPageDoc {
  key: 'terms' | 'privacy';
  title: string;        // 頁面標題（例「會員服務條款」）
  bodyHtml: string;     // TinyEditor 產出的 HTML
  updatedBy: string;    // admin lineUid
  updatedAt: Timestamp;
  version: number;      // 自動 +1（observability 用，無 rollback 機制）
}
```

3 個 endpoint：

| Method | Path | 權限 | 用途 |
|---|---|---|---|
| GET | `/nuxt-api/admin/legal-pages` | admin canManage | 列兩個 doc（缺則 default 占位） |
| PUT | `/nuxt-api/admin/legal-pages/[key]` | admin canManage | 更新 title + bodyHtml；自動 +version |
| GET | `/nuxt-api/legal-pages/[key]` | public（無 auth） | 乘客端讀取 |

firestore rules：admin level ≥ ?（依現有 admin role）write；public read（與 announcement / public asset 同策略）。

Audit log action：`legal_page.update`，payload `{ key, version, titleLen, bodyHtmlLen }`。

### 3. Admin UI 編輯介面（Q3=A 直接接 TinyEditor）

`app/components/admin/settings/SettingsLegalDocuments.vue` 新 component：

- 兩 tab：「會員服務條款」/「隱私權政策」
- 每 tab 內：title 輸入 + TinyEditor body + 儲存按鈕
- 載入時若 doc 不存在 → 顯示空表單 + 「建立並儲存」按鈕
- 儲存成功 ElMessage + 重新載入

`app/pages/admin/settings/index.vue` 在既有 ACCESS / FLEET section 之後加新 section：

```pug
section.PageAdminSettings__legal-section
  .PageAdminSettings__section-label LEGAL DOCUMENTS
  h2 文件管理（會員條款 / 隱私政策）
  AdminSettingsSettingsLegalDocuments
```

### 4. 乘客 Pages（Q4=A 走 /legal/* 路徑）

- `app/pages/legal/terms.vue` → 渲染 `legal_pages/terms`
- `app/pages/legal/privacy.vue` → 渲染 `legal_pages/privacy`
- cream theme（對齊 booking 家族）+ v-html 渲染 bodyHtml
- 載入失敗顯示 i18n fallback「條款載入失敗，請稍後再試」
- SEO-friendly：useHead 設 title

CommonDrawer items 加兩個 entry：

```
{ id: 'legal-terms',   path: '/legal/terms',   label: t('drawer.legal.terms'),   badge: 0 }
{ id: 'legal-privacy', path: '/legal/privacy', label: t('drawer.legal.privacy'), badge: 0 }
```

放在 drawer 末段、客服按鈕之前。

## Out of Scope

- ❌ 三語系獨立 doc（第一版 admin 編一份；i18n key 只走 fallback 標題）— 未來如需多語版 doc 再加 `lang` field 維度
- ❌ 版本歷史 / rollback UI（只記 version int 給觀察）
- ❌ 公開 RSS / sitemap 自動列入
- ❌ 「我已閱讀」勾選 / 簽署紀錄（登入 / 訂車流程不擋）
- ❌ App Store / Play Store 上架時必要的 markdown 版本（v-html 即可，需要 plaintext 再說）
- ❌ XSS sanitize on server（TinyEditor 產出已可控；server 端僅做長度限制，不解析 HTML）

## 4 個關鍵決策

| Q | 選項 | 預設 |
|---|---|---|
| Q1 DateRangeFilter 修色方式 | A) 加 theme prop 雙模式 / B) 在 page :deep() override / C) 拆兩元件 | **A** — prop 切換最 reusable |
| Q2 Legal doc schema | A) title + bodyHtml + version / B) 同 + lang 維度三語 / C) 加 publishedAt + draft | **A** — 第一版簡單；多語 / draft 留 backlog |
| Q3 Admin 編輯入口 | A) settings 內新 section / B) 獨立新頁 /admin/legal / C) 整合進 line-management | **A** — 與 P38 spec 提到 settings 已 4 section 警示無衝突（這是低頻編輯，不過度切割頁面） |
| Q4 乘客 page 路徑 | A) `/legal/terms` + `/legal/privacy` / B) `/terms` + `/privacy` | **A** — 群組到 `/legal/*` 未來加 cookie policy / refund policy 更整齊 |

## Impact

### 影響範圍

- **新增 firestore collection**：`legal_pages`（2 doc：terms / privacy）+ rules + 無新 composite index
- **新增 endpoint（3）**：GET admin list / PUT admin upsert / GET public read
- **新增 server util**：`server/utils/legal-pages.ts`（schema + DTO + validators）
- **新增 admin UI component（1）**：`SettingsLegalDocuments.vue`（auto-import 名 `AdminSettingsSettingsLegalDocuments`）
- **改動 admin settings page**：加 LEGAL DOCUMENTS section
- **新增乘客 page（2）**：`pages/legal/terms.vue` / `pages/legal/privacy.vue`
- **改動 CommonDrawer**：items 加 2 entry
- **改動 UiDateRangeFilter**：加 theme prop + cream 樣式覆蓋
- **改動 pages/orders/index.vue**：傳 `theme="cream"`
- **i18n**：加 `drawer.legal.terms` / `drawer.legal.privacy` / `legal.loading` / `legal.loadFailed` / `legal.title.terms` / `legal.title.privacy` 三語
- **audit-log**：加 `legal_page.update` action 與 targetType `legal_page`
- **firestore.rules**：加 `legal_pages` collection（public read，admin write）

### 風險

| 風險 | 緩解 |
|---|---|
| TinyEditor HTML 內含 `<script>` 攻擊 | TinyEditor 預設不允許 raw script；server 加長度上限（bodyHtml ≤ 100 KB）；前端 v-html 信任 admin 內容（admin 為內部受信任角色） |
| public GET endpoint 被刷 | 加 30s server cache header（`s-maxage=30, stale-while-revalidate=300`）；無 IP 限速但內容是公開的，刷流量影響可忽略 |
| Drawer items 加項目破壞既有對齊 | 用既有 items array 結構；不改 SCSS |
| 既有 admin/driver 用 UiDateRangeFilter 被波及 | theme prop 預設 'dark'，既有所有 call site 不傳 prop 行為不變 |
| 乘客點 drawer 跳 /legal/terms 後返回不對 | 用 NuxtLink，瀏覽器返回正常；無特殊狀態保留 |

### 估時

| Phase | 內容 | 估時 |
|---|---|---|
| **Phase 0** | openspec spec 三件套 | 0.2d |
| **Phase 1** | server: collection / rules / 3 endpoint / util / audit log | 0.3d |
| **Phase 2** | admin UI: SettingsLegalDocuments + settings page section | 0.3d |
| **Phase 3** | 乘客 page 2 個 + drawer 入口 + i18n | 0.3d |
| **Phase 4** | DateRangeFilter cream theme + orders 接通 | 0.1d |
| **Phase 5** | build 驗證 + version bump + archive + push | 0.2d |
| **總計** | | **~1.4 工作天** |

## Brain AI 拍板紀錄（2026-05-15）

**指令節錄**：「直接做完，有需要拍板的，直接照你預設即可」。Q1-Q4 全用推 spec 預設。

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | A | DateRangeFilter 加 theme prop |
| Q2 | A | Legal doc schema 簡單版（title + bodyHtml + version） |
| Q3 | A | Admin 編輯入口在 settings 內新 section |
| Q4 | A | 乘客 page 走 `/legal/terms` + `/legal/privacy` |

**Phase 1 解鎖** — 直接開工。
