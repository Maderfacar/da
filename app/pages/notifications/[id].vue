<script setup lang="ts">
// P37 Phase 5.2：乘客最新消息詳情
//
// - 封面全寬圖（有就顯示）
// - 標題 + 發佈時間
// - 內文 v-html（server 已 sanitize；前端再過一次輕量 strip 防漏網之魚）
// - CTA 按鈕（有就顯示）
// - 返回按鈕
import type { AnnouncementDetail } from '@/protocol/fetch-api/api/announcement';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const route = useRoute();
const { t } = useI18n();

const detail = ref<AnnouncementDetail | null>(null);
const loading = ref(false);
const notFound = ref(false);

const ApiLoad = async () => {
  const id = route.params.id as string;
  if (!id) return;
  loading.value = true;
  try {
    const res = await $api.GetAnnouncementDetail(id);
    if (res.status.code !== $enum.apiStatus.success) {
      if (res.status.code === 404) {
        notFound.value = true;
      } else {
        ElMessage({ message: res.status.message?.zh_tw || t('notifications.loadFailed'), type: 'error' });
      }
      return;
    }
    detail.value = res.data;
  } finally {
    loading.value = false;
  }
};

const ClickBack = () => {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    window.history.back();
  } else {
    navigateTo('/notifications');
  }
};

const FormatTime = (iso: string | null): string => {
  if (!iso) return '';
  return $dayjs(iso).format('YYYY/MM/DD HH:mm');
};

// 前端額外輕量 sanitize（server 已 strip script/iframe/on*；這裡是 defence-in-depth）
const safeBody = computed(() => {
  if (!detail.value?.body) return '';
  return detail.value.body
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
});

onMounted(() => {
  ApiLoad();
});
</script>

<template lang="pug">
.PageNotificationDetail
  //- 返回按鈕（fixed 在頂部 nav 下方）
  button.PageNotificationDetail__back(
    type="button"
    @click="ClickBack"
  )
    span ←
    | {{ $t('notifications.back') }}

  //- 載入中
  .PageNotificationDetail__loading(v-if="loading")
    .PageNotificationDetail__spinner

  //- 不存在 / 無權查看
  .PageNotificationDetail__empty(v-else-if="notFound")
    .PageNotificationDetail__emptyIcon 🔍
    p.PageNotificationDetail__emptyText {{ $t('notifications.empty') }}

  //- 詳情
  article.PageNotificationDetail__article(v-else-if="detail")
    img.PageNotificationDetail__cover(
      v-if="detail.coverImageUrl"
      :src="detail.coverImageUrl"
      :alt="detail.title"
    )
    .PageNotificationDetail__content
      h1.PageNotificationDetail__title {{ detail.title }}
      time.PageNotificationDetail__time {{ FormatTime(detail.publishedAt) }}
      .PageNotificationDetail__body(v-html="safeBody")
      a.PageNotificationDetail__cta(
        v-if="detail.ctaButton && detail.ctaButton.label && detail.ctaButton.url"
        :href="detail.ctaButton.url"
        target="_blank"
        rel="noopener noreferrer"
      ) {{ detail.ctaButton.label }}
</template>

<style lang="scss" scoped>
$bg: #0d1117;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.07);
$amber: #d4860a;

.PageNotificationDetail {
  min-height: 100svh;
  padding: 56px 0 100px;
  background: $bg;
  color: #fff;
}

// ── 返回按鈕 ───────────────────────────────────────────────
.PageNotificationDetail__back {
  position: sticky;
  top: 56px;
  z-index: 5;
  margin: 12px 16px 0;
  padding: 8px 14px 8px 10px;
  border-radius: 100px;
  border: 1px solid $border;
  background: rgba(13, 17, 23, 0.85);
  backdrop-filter: blur(8px);
  color: rgba(255, 255, 255, 0.85);
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;

  &:hover { color: #fff; border-color: rgba(255, 255, 255, 0.18); }

  span { font-size: 16px; line-height: 1; }
}

// ── 載入中 ────────────────────────────────────────────────
.PageNotificationDetail__loading {
  display: flex;
  justify-content: center;
  padding: 80px 0;
}

.PageNotificationDetail__spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 空狀態 / 404 ──────────────────────────────────────────
.PageNotificationDetail__empty {
  text-align: center;
  padding: 80px 20px;
}

.PageNotificationDetail__emptyIcon { font-size: 48px; margin-bottom: 16px; }

.PageNotificationDetail__emptyText {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.4);
}

// ── 文章本體 ──────────────────────────────────────────────
.PageNotificationDetail__article {
  max-width: 720px;
  margin: 16px auto 0;
}

.PageNotificationDetail__cover {
  display: block;
  width: 100%;
  max-height: 360px;
  object-fit: cover;
}

.PageNotificationDetail__content {
  padding: 24px 20px 40px;
}

.PageNotificationDetail__title {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  line-height: 1.4;
  margin: 0 0 10px;
  word-break: break-word;
}

.PageNotificationDetail__time {
  display: block;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 24px;
}

.PageNotificationDetail__body {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.75;
  word-break: break-word;

  :deep(p) { margin: 0 0 12px; }
  :deep(a) { color: $amber; text-decoration: underline; }
  :deep(strong) { font-weight: 700; color: #fff; }
  :deep(em) { font-style: italic; }
  :deep(ul), :deep(ol) { margin: 8px 0 12px 22px; }
  :deep(li) { margin: 4px 0; }
  :deep(h1), :deep(h2), :deep(h3) {
    color: #fff;
    margin: 18px 0 10px;
    line-height: 1.4;
  }
  :deep(h1) { font-size: 20px; }
  :deep(h2) { font-size: 17px; }
  :deep(h3) { font-size: 15px; }
  :deep(img) { max-width: 100%; border-radius: 8px; margin: 10px 0; }
  :deep(blockquote) {
    border-left: 3px solid rgba($amber, 0.5);
    padding: 4px 14px;
    margin: 12px 0;
    color: rgba(255, 255, 255, 0.7);
  }
}

.PageNotificationDetail__cta {
  display: inline-block;
  margin-top: 24px;
  padding: 12px 28px;
  border-radius: 100px;
  background: $amber;
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-decoration: none;
  transition: background 0.15s;

  &:hover { background: darken(#d4860a, 8%); }
}
</style>
