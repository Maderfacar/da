<script setup lang="ts">
// 共用 legal page 渲染（terms.vue / privacy.vue 兩個 page 共用本元件）
//
// 行為：
//   - 載入 GET /nuxt-api/legal-pages/[key]（公開 endpoint，無 auth）
//   - 載入成功 → cream theme 渲染 title + bodyHtml（v-html 信任 admin 輸入）
//   - 404 / 失敗 → 顯示 i18n fallback
//   - useHead 設 title（SEO）
import type { LegalPageDto, LegalPageKey } from '@/protocol/fetch-api/api/legal-page';

interface Props {
  pageKey: LegalPageKey;
}
const props = defineProps<Props>();

const { t } = useI18n();
const doc = ref<LegalPageDto | null>(null);
const loading = ref(false);
const loadError = ref<string>('');

const ApiLoad = async () => {
  loading.value = true;
  loadError.value = '';
  try {
    const res = await $api.GetLegalPage(props.pageKey);
    if (res.status?.code !== $enum.apiStatus.success || !res.data) {
      if (res.status?.code === 404) {
        loadError.value = t('legal.notPublished');
      } else {
        loadError.value = res.status?.message?.zh_tw ?? t('legal.loadFailed');
      }
      return;
    }
    doc.value = res.data;
  } finally {
    loading.value = false;
  }
};

const FormatTime = (iso: string | null) => (iso ? $dayjs(iso).format('YYYY-MM-DD HH:mm') : '');

const titleFallback = computed(() => t(`legal.title.${props.pageKey}`));
const displayTitle = computed(() => doc.value?.title?.trim() || titleFallback.value);

useHead({ title: () => displayTitle.value });

onMounted(() => { void ApiLoad(); });
</script>

<template lang="pug">
.LegalPageView
  .LegalPageView__header
    .LegalPageView__header-label LEGAL
    h1.LegalPageView__header-title {{ displayTitle }}
    .LegalPageView__header-meta(v-if="doc?.updatedAt")
      | {{ $t('legal.lastUpdated') }}：{{ FormatTime(doc.updatedAt) }} · v{{ doc.version }}

  .LegalPageView__loading(v-if="loading")
    .LegalPageView__spinner

  .LegalPageView__error(v-else-if="loadError")
    span.LegalPageView__error-icon ⚠️
    p.LegalPageView__error-text {{ loadError }}

  article.LegalPageView__body(v-else v-html="doc?.bodyHtml || ''")

  CommonFooter
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.LegalPageView {
  padding: 72px 24px 0;
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
}

// 對齊 fare：頁尾 CommonFooter，負 margin 破出 24px 水平 padding 達全幅
.CommonFooter {
  margin: 48px -24px 0;
}

.LegalPageView__header {
  padding: 32px 0;
}

.LegalPageView__header-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 10px;
}

.LegalPageView__header-title {
  font-family: $font-display;
  font-size: clamp(48px, 14vw, 64px);
  line-height: 0.92;
  color: var(--da-dark);
  margin: 0 0 6px;
}

.LegalPageView__header-meta {
  font-family: $font-condensed;
  font-size: 11px;
  color: var(--da-gray);
  letter-spacing: 0.05em;
}

.LegalPageView__loading {
  display: flex;
  justify-content: center;
  padding: 80px 0;
}

.LegalPageView__spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: var(--da-amber);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.LegalPageView__error {
  text-align: center;
  padding: 60px 20px;

  &-icon { font-size: 40px; margin-bottom: 12px; }
  &-text {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 14px;
    color: var(--da-gray);
  }
}

.LegalPageView__body {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  line-height: 1.75;
  color: var(--da-dark);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid var(--da-glass-border, rgba(26, 24, 20, 0.10));
  border-radius: 18px;
  padding: 24px 22px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);

  // TinyEditor 內容渲染樣式（v-html 後的常見 tag）
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    font-family: $font-condensed;
    color: var(--da-dark);
    margin: 28px 0 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  :deep(h1) { font-size: 22px; }
  :deep(h2) { font-size: 19px; }
  :deep(h3) { font-size: 16px; }
  :deep(h4) { font-size: 15px; }

  :deep(p) { margin: 0 0 14px; }
  :deep(ul),
  :deep(ol) {
    padding-left: 22px;
    margin: 0 0 14px;
    li { margin-bottom: 6px; }
  }

  :deep(a) {
    color: var(--da-amber);
    text-decoration: underline;
    text-underline-offset: 2px;
    &:hover { color: #b8730a; }
  }

  :deep(strong),
  :deep(b) { color: var(--da-dark); font-weight: 700; }

  :deep(blockquote) {
    margin: 14px 0;
    padding: 10px 14px;
    border-left: 3px solid var(--da-amber);
    background: rgba(212, 134, 10, 0.06);
    color: var(--da-gray);
    border-radius: 0 8px 8px 0;
  }

  :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 13px;
    th, td {
      border: 1px solid rgba(26, 24, 20, 0.12);
      padding: 8px 10px;
      text-align: left;
    }
    th {
      background: rgba(212, 134, 10, 0.08);
      font-weight: 700;
    }
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid rgba(26, 24, 20, 0.1);
    margin: 20px 0;
  }

  :deep(img) {
    max-width: 100%;
    border-radius: 8px;
  }

  :deep(code) {
    font-family: 'Menlo', monospace;
    font-size: 12px;
    background: rgba(26, 24, 20, 0.06);
    padding: 1px 5px;
    border-radius: 4px;
  }
}
</style>
