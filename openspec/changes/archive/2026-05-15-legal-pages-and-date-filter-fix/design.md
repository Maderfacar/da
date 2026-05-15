# 設計：Legal Pages + DateRangeFilter cream theme

## 1. Firestore schema：`legal_pages/{key}`

```typescript
// server/utils/legal-pages.ts
export type LegalPageKey = 'terms' | 'privacy';

export const LEGAL_PAGE_KEYS: readonly LegalPageKey[] = ['terms', 'privacy'] as const;

export const TITLE_MAX = 200;
export const BODY_HTML_MAX = 100_000; // 100 KB（粗估 50,000 中文字以上）

export interface LegalPageDoc {
  key: LegalPageKey;
  title: string;
  bodyHtml: string;
  updatedBy: string;
  updatedAt: Timestamp;
  version: number; // 起始 1，每次 PUT 自動 +1
}

export interface LegalPageDto {
  key: LegalPageKey;
  title: string;
  bodyHtml: string;
  updatedBy: string;
  updatedAt: string | null;
  version: number;
}
```

DTO 序列化、validateLegalKey / validateTitle / validateBodyHtml 三個 validator。

## 2. Endpoints

### GET `/nuxt-api/admin/legal-pages` — admin 列兩 doc

```typescript
// server/routes/nuxt-api/admin/legal-pages/index.get.ts
// 權限：canManage（admin level ≥ admin）
// Response: { items: LegalPageDto[] }
// 若某 key 不存在 → return placeholder { key, title: '', bodyHtml: '', version: 0 }
```

### PUT `/nuxt-api/admin/legal-pages/[key]`

```typescript
// server/routes/nuxt-api/admin/legal-pages/[key].put.ts
// 權限：canManage
// Body: { title: string; bodyHtml: string }
// 行為：
//   - validate key in ['terms', 'privacy']
//   - validate title 1..TITLE_MAX
//   - validate bodyHtml 0..BODY_HTML_MAX（允許空）
//   - upsert doc，version + 1（不存在則設 1）
//   - audit log: legal_page.update with { key, version, titleLen, bodyHtmlLen }
// Response: { key, version, updatedAt }
```

### GET `/nuxt-api/legal-pages/[key]` — 公開讀取

```typescript
// server/routes/nuxt-api/legal-pages/[key].get.ts
// 無 auth required
// Response: LegalPageDto（若不存在回 404）
// Cache: setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300')
```

## 3. Firestore rules

```
// firestore.rules
match /legal_pages/{key} {
  allow read: if true; // public
  allow write: if isAdminAtLevel(['super', 'admin']); // 用既有 helper
}
```

## 4. Audit log

`server/utils/audit-log.ts` 加：
- AuditAction 加 `'legal_page.update'`
- AuditTargetType 加 `'legal_page'`

## 5. Admin UI：`SettingsLegalDocuments.vue`

```pug
.SettingsLegalDocuments
  .SettingsLegalDocuments__tabs
    button(:class="{ 'is-active': activeKey === 'terms' }" @click="ClickTab('terms')") 會員服務條款
    button(:class="{ 'is-active': activeKey === 'privacy' }" @click="ClickTab('privacy')") 隱私權政策

  .SettingsLegalDocuments__editor
    .SettingsLegalDocuments__meta
      span Version v{{ currentDoc?.version ?? 0 }}
      span {{ currentDoc?.updatedAt ? `更新 ${formatDate(currentDoc.updatedAt)}` : '尚未建立' }}

    label 標題
    input(v-model="form.title" maxlength="200" placeholder="例：會員服務條款")

    label 內文
    TinyEditor(v-model="form.bodyHtml")

    button(@click="ClickSave" :disabled="saving") {{ saving ? '儲存中…' : '儲存' }}
```

- 切 tab 時若 dirty 提示 UseAsk「未儲存的變更會遺失」
- 載入 / 儲存錯誤 ElMessage
- TinyEditor 高度設 480px

## 6. Passenger pages：`/legal/terms` + `/legal/privacy`

```vue
<!-- app/pages/legal/terms.vue -->
<script setup lang="ts">
definePageMeta({ layout: 'front-desk' }); // 無 auth middleware（公開頁）
const { t } = useI18n();
const doc = ref<LegalPageDto | null>(null);
const loading = ref(false);
const loadError = ref<string>('');

const ApiLoad = async () => {
  loading.value = true;
  try {
    const res = await $api.GetLegalPage('terms');
    if (res.status?.code !== $enum.apiStatus.success || !res.data) {
      loadError.value = res.status?.message?.zh_tw ?? t('legal.loadFailed');
      return;
    }
    doc.value = res.data;
  } finally {
    loading.value = false;
  }
};

useHead({ title: () => doc.value?.title || t('legal.title.terms') });
onMounted(ApiLoad);
</script>

<template lang="pug">
.PageLegalTerms
  .PageLegalTerms__header
    .PageLegalTerms__header-label LEGAL
    h1.PageLegalTerms__header-title {{ doc?.title || $t('legal.title.terms') }}
  .PageLegalTerms__loading(v-if="loading") {{ $t('legal.loading') }}
  .PageLegalTerms__error(v-else-if="loadError") {{ loadError }}
  .PageLegalTerms__body(v-else v-html="doc?.bodyHtml || ''")
</template>
```

Privacy 結構完全鏡像。

`v-html` 信任 admin 端 TinyEditor 內容（admin 為內部受信任角色，與 announcement / Flex template 同策略）。

## 7. CommonDrawer items 擴充

```typescript
const items = computed(() => [
  { id: 'notifications', path: '/notifications', label: t('drawer.notifications'), badge: props.unreadCount },
  { id: 'booking',       path: '/booking',       label: t('drawer.booking'),       badge: 0 },
  { id: 'orders',        path: '/orders',        label: t('drawer.orders'),        badge: 0 },
  { id: 'fleet',         path: '/fleet',         label: t('drawer.fleet'),         badge: 0 },
  { id: 'profile',       path: '/profile',       label: t('drawer.profile'),       badge: 0 },
  // 新增
  { id: 'legal-terms',   path: '/legal/terms',   label: t('drawer.legal.terms'),   badge: 0 },
  { id: 'legal-privacy', path: '/legal/privacy', label: t('drawer.legal.privacy'), badge: 0 },
]);
```

放在 profile 之後、客服 button 之前。

## 8. DateRangeFilter theme prop

```typescript
interface Props {
  // ... 既有
  theme?: 'dark' | 'cream'; // 預設 'dark'
}
```

SCSS：把既有 dark 樣式包進 `.theme-dark`（容器層），新加 `.theme-cream` 套用 cream 色系：

```scss
.UiDateRangeFilter.theme-cream {
  .UiDateRangeFilter__granularity {
    border-color: rgba(26, 24, 20, 0.18);
  }
  .UiDateRangeFilter__gran-btn {
    background: rgba(26, 24, 20, 0.04);
    color: var(--da-gray);
    border-right-color: rgba(26, 24, 20, 0.10);
    &:hover { background: rgba(26, 24, 20, 0.08); color: var(--da-dark); }
    &.is-active { background: rgba(212, 134, 10, 0.18); color: #b8730a; }
  }
  .UiDateRangeFilter__input {
    background: rgba(255, 255, 255, 0.65);
    border-color: rgba(26, 24, 20, 0.18);
    color: var(--da-dark);
    color-scheme: light;
    &::placeholder { color: rgba(26, 24, 20, 0.4); }
    &:focus { border-color: rgba(212, 134, 10, 0.55); }
  }
  .UiDateRangeFilter__sep { color: rgba(26, 24, 20, 0.4); }
  .UiDateRangeFilter__clear {
    background: rgba(26, 24, 20, 0.04);
    border-color: rgba(26, 24, 20, 0.18);
    color: var(--da-gray);
    &:hover { background: rgba(220, 38, 38, 0.10); color: #dc2626; border-color: rgba(220, 38, 38, 0.30); }
  }
}
```

Template 加 `:class`：

```pug
.UiDateRangeFilter(:class="[`size-${size}`, `theme-${theme}`]")
```

## 9. i18n keys（zh/en/ja）

```javascript
// zh.js
drawer: {
  legal: {
    terms: '會員服務條款',
    privacy: '隱私權政策',
  },
},
legal: {
  loading: '載入中…',
  loadFailed: '載入失敗，請稍後再試',
  title: {
    terms: '會員服務條款',
    privacy: '隱私權政策',
  },
},
```

en / ja 對譯。

## 10. 風險 / fallback

- **doc 不存在**：admin GET list 回 placeholder（version 0、空 title / bodyHtml）；乘客 GET 回 404 + i18n fallback 標題
- **TinyEditor 載入失敗**：本身 client only，已有 SSR 安全處理；admin tab 切換時不卸載編輯器
- **public endpoint 被刷**：30s Vercel edge cache（s-maxage=30 + SWR 300s）

## 11. 決策紀錄

### 2026-05-15 — Brain AI 拍板（推 spec 預設）

| Q | 拍板 | 為什麼 |
|---|---|---|
| Q1 | A theme prop | reusable 最佳，既有 dark 端不破壞 |
| Q2 | A 簡單 schema | 多語 / draft 是次要需求，等實際提才加 |
| Q3 | A settings 內 section | 低頻編輯，獨立頁過度切割 |
| Q4 | A /legal/* 路徑 | 未來加 cookie / refund policy 整齊 |

**Brain AI 指令節錄**：「直接做完，有需要拍板的，直接照你預設即可。要問 allow / permission 直接都 allow」。
