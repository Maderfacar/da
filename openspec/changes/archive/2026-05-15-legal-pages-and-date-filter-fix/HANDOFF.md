# HANDOFF — 乘客端 Legal Pages + DateRangeFilter cream theme（2026-05-15）

> 程式碼層完工 — Phase 0-5 全綠並準備 push main。`pnpm lint` + `pnpm build` 皆通過。
> firestore rules 已 deploy。真機驗收由 Brain AI 視覺驗證。

## 實作摘要

| Phase | 內容 | 狀態 |
|---|---|---|
| 0 | openspec spec 三件套 + Brain AI 拍板 Q1-Q4 全推預設 | ✅ |
| 1 | server: legal_pages collection + 3 endpoint + rules + audit log + validators | ✅ |
| 2 | admin UI: SettingsLegalDocuments 元件（兩 tab + TinyEditor + 儲存） + settings page section | ✅ |
| 3 | 乘客 page: LegalPageView 共用元件 + terms.vue + privacy.vue + drawer entries + i18n 三語 | ✅ |
| 4 | DateRangeFilter 加 theme prop + cream SCSS + orders 頁面接通 | ✅ |
| 5 | build 驗證 + firebase deploy rules + version bump + archive | ✅ |

## 拍板紀錄（design.md §11）

4 個 Q 全用推 spec 預設（2026-05-15「直接做完 / 預設即可」拍板）：

| Q | 拍板 | 摘要 |
|---|---|---|
| Q1 | A | DateRangeFilter 加 theme prop（'dark' default / 'cream' opt-in） |
| Q2 | A | Legal doc schema 簡單版（key / title / bodyHtml / updatedBy / updatedAt / version） |
| Q3 | A | Admin 編輯入口在 /admin/settings 內新 LEGAL DOCUMENTS section |
| Q4 | A | 乘客 page 走 /legal/terms + /legal/privacy（未來可擴 /legal/cookie 等） |

## 部署狀態

✅ **firestore rules**：legal_pages collection rule（public read / admin write）已 deploy（jobId 1778819294335）
✅ **無 indexes 變動**：只用 doc id 查詢，不需 composite index
✅ **無 Vercel env 變動**
✅ **bundle size**：40.9 → 41.8 MB（TinyEditor admin component + 兩個 page + 1 view component + 5 i18n key）

## 程式碼總覽

### 新增 server util（1）
- [server/utils/legal-pages.ts](server/utils/legal-pages.ts) — LegalPageDoc / DTO / 3 validators + LEGAL_PAGE_KEYS / TITLE_MAX / BODY_HTML_MAX 常數 + placeholder helper

### 新增 endpoint（3）
- [server/routes/nuxt-api/admin/legal-pages/index.get.ts](server/routes/nuxt-api/admin/legal-pages/index.get.ts) — admin list（補 placeholder for 缺檔）
- [server/routes/nuxt-api/admin/legal-pages/[key].put.ts](server/routes/nuxt-api/admin/legal-pages/[key].put.ts) — upsert + version+1 + audit log `legal_page.update`
- [server/routes/nuxt-api/legal-pages/[key].get.ts](server/routes/nuxt-api/legal-pages/[key].get.ts) — public read + `s-maxage=30, swr=300` edge cache

### 新增 UI（4）
- [app/components/admin/SettingsLegalDocuments.vue](app/components/admin/SettingsLegalDocuments.vue) — 兩 tab + TinyEditor + 儲存 + dirty 提示
- [app/components/LegalPageView.vue](app/components/LegalPageView.vue) — 乘客端共用 view（cream theme + v-html + :deep() typography for TinyEditor 輸出）
- [app/pages/legal/terms.vue](app/pages/legal/terms.vue) — `<LegalPageView pageKey="terms" />`
- [app/pages/legal/privacy.vue](app/pages/legal/privacy.vue) — `<LegalPageView pageKey="privacy" />`

### 新增 protocol module（2）
- [app/protocol/fetch-api/api/admin/legal-page/](app/protocol/fetch-api/api/admin/legal-page/) — admin GetAdminLegalPages / PutAdminLegalPage
- [app/protocol/fetch-api/api/legal-page/](app/protocol/fetch-api/api/legal-page/) — public GetLegalPage

### 改動（5）
- [server/utils/audit-log.ts](server/utils/audit-log.ts) — 加 action `legal_page.update` + targetType `legal_page`
- [firestore.rules](firestore.rules) — 加 legal_pages collection rule
- [app/pages/admin/settings/index.vue](app/pages/admin/settings/index.vue) — 加 LEGAL DOCUMENTS section
- [app/components/common/CommonDrawer.vue](app/components/common/CommonDrawer.vue) — items 加 legal-terms / legal-privacy 2 entry
- [app/protocol/fetch-api/index.ts](app/protocol/fetch-api/index.ts) + [app/protocol/fetch-api/api/admin/index.ts](app/protocol/fetch-api/api/admin/index.ts) — 註冊 legal-page modules
- [app/components/ui/DateRangeFilter.vue](app/components/ui/DateRangeFilter.vue) — 加 theme prop + cream SCSS（既有 dark 不破壞）
- [app/pages/orders/index.vue](app/pages/orders/index.vue) — 傳 `theme="cream" size="md"`
- [i18n/locales/zh.js](i18n/locales/zh.js) / [en.js](i18n/locales/en.js) / [ja.js](i18n/locales/ja.js) — drawer.legal.* + legal.* 三語 key

### 版本
v0.3.27 → v0.3.28（[version.ts](version.ts)）

## 留尾

### Brain AI 真機驗收 checklist

| 場景 | 預期 |
|---|---|
| 乘客 /orders 頁面 — 看年/月/日切換 + 日期 input | 文字 / 邊框清晰可辨識（cream 底深字）；對齊 booking 家族色系 |
| Admin 進 /admin/settings → 滾到「LEGAL DOCUMENTS」section | 看到「會員服務條款 / 隱私權政策」兩 tab；版本 v0 / 尚未建立 |
| Admin 切「會員服務條款」 tab → 填標題 + TinyEditor 輸入內容 → 儲存 | ElMessage「已儲存（version v1）」+ Version v0 → v1 |
| Admin 切「隱私權政策」tab → 編輯 → 儲存 | 同上，version v0 → v1，独立計 |
| Admin 改內容後切 tab 不儲存 | UseAsk 提示「未儲存變更會遺失」 |
| 乘客 drawer 開啟 → 點「會員服務條款」 | 跳 `/legal/terms`，顯示 admin 編輯的內容 |
| 乘客 drawer → 點「隱私權政策」 | 跳 `/legal/privacy`，顯示對應內容 |
| 訪客（未登入）直接打開 `/legal/terms` URL | 公開可讀，無 auth 阻擋 |
| Admin 還沒編內容、乘客先點 `/legal/terms` | 顯示 404 i18n fallback「此頁面尚未發布」 |
| 標題輸入超 200 字、bodyHtml 超 100 KB | server validate 擋下，ElMessage 提示具體錯誤 |
| 公開 endpoint `/nuxt-api/legal-pages/terms` curl 直打 | Cache-Control header `public, s-maxage=30, stale-while-revalidate=300` |

### 後續觀察 / 留尾
- **多語版 legal doc**：第一版 admin 編一份；如業務要求 zh / en / ja 各一份，再加 `lang` 子 doc 維度
- **版本歷史 / rollback**：目前只 version int（觀察用），需要 UI rollback 再加 `legal_pages/{key}/versions/{ver}` 子 collection
- **「我已閱讀」簽署紀錄**：法務需求才做，可走 `user_legal_acceptances` collection
- **sitemap.xml** 自動列 /legal/*：SEO 需求才做
