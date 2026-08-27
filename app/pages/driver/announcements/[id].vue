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





.PageDriverAnnouncementDetail {
  min-height: 100svh;
  padding: 56px 0 100px;
  background: var(--ink);
  color: var(--surface-raised);
}

.PageDriverAnnouncementDetail__back {
  position: sticky;
  top: 56px;
  z-index: 5;
  margin: 12px 16px 0;
  padding: 8px 14px 8px 10px;
  border-radius: var(--r-pill);
  border: 1px solid var(--surface-a06);
  background: var(--ink-a60);
  color: var(--surface-raised);
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);

  &:hover {
    color: var(--accent);
    border-color: var(--accent-a40);
    background: var(--ink-a70);
  }

  span { font-size: var(--fs-body-lg); line-height: var(--lh-flat); }
}

.PageDriverAnnouncementDetail__loading {
  display: flex;
  justify-content: center;
  padding: 80px 0;
}

.PageDriverAnnouncementDetail__spinner {
  width: 32px; height: 32px;
  border: 2px solid var(--accent-a20);
  border-top-color: var(--accent);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.PageDriverAnnouncementDetail__empty {
  text-align: center;
  padding: 80px 20px;
}

.PageDriverAnnouncementDetail__emptyIcon { font-size: var(--fs-display); margin-bottom: 16px; }

.PageDriverAnnouncementDetail__emptyText {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  color: var(--surface-a30);
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
  font-family: var(--ff-ui);
  font-size: var(--fs-h2);
  font-weight: 700;
  color: var(--surface-raised);
  line-height: var(--lh-normal);
  margin: 0 0 10px;
  word-break: break-word;
}

.PageDriverAnnouncementDetail__time {
  display: block;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
  color: var(--surface-a30);
  margin-bottom: 24px;
}

.PageDriverAnnouncementDetail__body {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  color: var(--surface-a88);
  line-height: var(--lh-relaxed);
  word-break: break-word;

  :deep(p) { margin: 0 0 12px; }
  :deep(a) { color: var(--accent); text-decoration: underline; }
  :deep(strong) { font-weight: 700; color: var(--surface-raised); }
  :deep(em) { font-style: italic; }
  :deep(ul), :deep(ol) { margin: 8px 0 12px 22px; }
  :deep(li) { margin: 4px 0; }
  :deep(h1), :deep(h2), :deep(h3) {
    color: var(--surface-raised);
    margin: 18px 0 10px;
    line-height: var(--lh-normal);
  }
  :deep(h1) { font-size: var(--fs-h3); }
  :deep(h2) { font-size: var(--fs-body-lg); }
  :deep(h3) { font-size: var(--fs-body); }
  :deep(img) { max-width: 100%; border-radius: var(--r-md); margin: 10px 0; }
  :deep(blockquote) {
    border-left: 3px solid var(--accent-a50);
    padding: 4px 14px;
    margin: 12px 0;
    color: var(--surface-a60);
    background: var(--accent-a06);
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }
}

.PageDriverAnnouncementDetail__cta {
  display: inline-block;
  margin-top: 24px;
  padding: 12px 28px;
  border-radius: var(--r-pill);
  background: var(--accent);
  color: var(--surface-raised);
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-out);

  &:hover { background: var(--accent-lit); }
}
</style>
