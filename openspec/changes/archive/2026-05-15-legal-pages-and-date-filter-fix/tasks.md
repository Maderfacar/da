# Tasks

## Phase 0：spec ✅
- [x] proposal.md
- [x] design.md
- [x] tasks.md

## Phase 1：Server ✅
- [x] `server/utils/legal-pages.ts`：schema / DTO / validators / 常數
- [x] `server/utils/audit-log.ts`：加 action `legal_page.update` + targetType `legal_page`
- [x] `server/routes/nuxt-api/admin/legal-pages/index.get.ts`（admin list with placeholder fallback）
- [x] `server/routes/nuxt-api/admin/legal-pages/[key].put.ts`（upsert + version+1 + audit）
- [x] `server/routes/nuxt-api/legal-pages/[key].get.ts`（public + 30s edge cache + 300s SWR）
- [x] `firestore.rules`：加 `legal_pages` collection rule（public read / admin write）

## Phase 2：Admin UI ✅
- [x] `app/components/admin/SettingsLegalDocuments.vue`（兩 tab + TinyEditor + 儲存 + dirty 提示）
- [x] `app/pages/admin/settings/index.vue`：加 LEGAL DOCUMENTS section
- [x] `app/protocol/fetch-api/api/admin/legal-page/` module（GetAdminLegalPages / PutAdminLegalPage）

## Phase 3：乘客 page + drawer ✅
- [x] `app/components/LegalPageView.vue`（共用 view component，cream theme，v-html + :deep() typography）
- [x] `app/pages/legal/terms.vue`
- [x] `app/pages/legal/privacy.vue`
- [x] `app/components/common/CommonDrawer.vue`：items 加 legal-terms / legal-privacy 2 entry
- [x] `app/protocol/fetch-api/api/legal-page/` module（GetLegalPage public）+ 在 fetch-api/index.ts 註冊
- [x] i18n 三語 zh/en/ja 新 key（drawer.legal.* + legal.title.* + legal.loading / loadFailed / notPublished / lastUpdated）

## Phase 4：DateRangeFilter cream theme ✅
- [x] `app/components/ui/DateRangeFilter.vue`：加 theme prop（default 'dark'）+ cream SCSS 覆蓋
- [x] `app/pages/orders/index.vue`：傳 `theme="cream" size="md"`

## Phase 5：build / archive ✅
- [x] `pnpm lint` 綠
- [x] `pnpm build` 綠
- [x] firebase deploy rules（Claude 自跑 — jobId 1778819294335 完成）
- [x] version v0.3.27 → v0.3.28
- [x] HANDOFF.md
- [x] archive mv
- [x] commit + push main

## 留尾（非阻塞）
- 多語版 legal doc（lang 維度子 doc）— Brain AI 反饋後決定是否做
- 版本歷史 / rollback UI — 觀察使用率後評估
- 「我已閱讀」勾選 / 簽署紀錄（登入或訂車流程擋）— 法務需求才做
- 公開 sitemap.xml 自動列入 /legal/*
