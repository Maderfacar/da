<script setup lang="ts">
// 司機端公告詳情
//
// - 沿用乘客 /notifications/[id] 結構（封面 / 標題 / 發佈時間 / 內文 v-html / CTA）
// - dark theme 對齊其他 driver 頁
// - 載入即寫已讀（後端 idempotent）
import type { AnnouncementDetail } from '@/protocol/fetch-api/api/announcement';

definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const route = useRoute();

const detail = ref<AnnouncementDetail | null>(null);
const loading = ref(false);
const notFound = ref(false);

const ApiLoad = async () => {
  const id = route.params.id as string;
  if (!id) return;
  loading.value = true;
  try {
    const res = await $api.GetDriverAnnouncementDetail(id);
    if (res.status.code !== $enum.apiStatus.success) {
      if (res.status.code === 404) {
        notFound.value = true;
      } else {
        ElMessage({ message: res.status.message?.zh_tw || '載入失敗', type: 'error' });
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
    navigateTo('/driver/announcements');
  }
};

const FormatTime = (iso: string | null): string => {
  if (!iso) return '';
  return $dayjs(iso).format('YYYY/MM/DD HH:mm');
};

// defence-in-depth：server 已 sanitize，前端再過一次
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
.PageDriverAnnouncementDetail
  button.PageDriverAnnouncementDetail__back(
    type="button"
    @click="ClickBack"
  )
    span ←
    | 返回公告欄

  .PageDriverAnnouncementDetail__loading(v-if="loading")
    .PageDriverAnnouncementDetail__spinner

  .PageDriverAnnouncementDetail__empty(v-else-if="notFound")
    .PageDriverAnnouncementDetail__emptyIcon 🔍
    p.PageDriverAnnouncementDetail__emptyText 公告不存在或已下架

  article.PageDriverAnnouncementDetail__article(v-else-if="detail")
    img.PageDriverAnnouncementDetail__cover(
      v-if="detail.coverImageUrl"
      :src="detail.coverImageUrl"
      :alt="detail.title"
    )
    .PageDriverAnnouncementDetail__content
      h1.PageDriverAnnouncementDetail__title {{ detail.title }}
      time.PageDriverAnnouncementDetail__time {{ FormatTime(detail.publishedAt) }}
      .PageDriverAnnouncementDetail__body(v-html="safeBody")
      a.PageDriverAnnouncementDetail__cta(
        v-if="detail.ctaButton && detail.ctaButton.label && detail.ctaButton.url"
        :href="detail.ctaButton.url"
        target="_blank"
        rel="noopener noreferrer"
      ) {{ detail.ctaButton.label }}
</template>

<style lang="scss" scoped>
$bg:      #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border:  rgba(255, 255, 255, 0.08);
$amber:   #d4860a;
$muted:   rgba(255, 255, 255, 0.55);
$muted-2: rgba(255, 255, 255, 0.35);

.PageDriverAnnouncementDetail {
  min-height: 100svh;
  padding: 56px 0 100px;
  background: $bg;
  color: #fff;
}

.PageDriverAnnouncementDetail__back {
  position: sticky;
  top: 56px;
  z-index: 5;
  margin: 12px 16px 0;
  padding: 8px 14px 8px 10px;
  border-radius: 100px;
  border: 1px solid $border;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: color 0.15s, border-color 0.15s, background 0.15s;

  &:hover {
    color: $amber;
    border-color: rgba(212, 134, 10, 0.45);
    background: rgba(0, 0, 0, 0.7);
  }

  span { font-size: 16px; line-height: 1; }
}

.PageDriverAnnouncementDetail__loading {
  display: flex;
  justify-content: center;
  padding: 80px 0;
}

.PageDriverAnnouncementDetail__spinner {
  width: 32px; height: 32px;
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.PageDriverAnnouncementDetail__empty {
  text-align: center;
  padding: 80px 20px;
}

.PageDriverAnnouncementDetail__emptyIcon { font-size: 48px; margin-bottom: 16px; }

.PageDriverAnnouncementDetail__emptyText {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: $muted-2;
}

.PageDriverAnnouncementDetail__article {
  max-width: 720px;
  margin: 16px auto 0;
}

.PageDriverAnnouncementDetail__cover {
  display: block;
  width: 100%;
  max-height: 360px;
  object-fit: cover;
}

.PageDriverAnnouncementDetail__content {
  padding: 24px 20px 40px;
}

.PageDriverAnnouncementDetail__title {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  line-height: 1.4;
  margin: 0 0 10px;
  word-break: break-word;
}

.PageDriverAnnouncementDetail__time {
  display: block;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: $muted-2;
  margin-bottom: 24px;
}

.PageDriverAnnouncementDetail__body {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.88);
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
  :deep(img) { max-width: 100%; border-radius: 12px; margin: 10px 0; }
  :deep(blockquote) {
    border-left: 3px solid rgba(212, 134, 10, 0.5);
    padding: 4px 14px;
    margin: 12px 0;
    color: $muted;
    background: rgba(212, 134, 10, 0.05);
    border-radius: 0 8px 8px 0;
  }
}

.PageDriverAnnouncementDetail__cta {
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

  &:hover { background: lighten($amber, 8%); }
}
</style>
