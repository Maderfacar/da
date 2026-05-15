<script setup lang="ts">
// 司機端「公告欄」列表
//
// - clone /notifications 流程：30s polling + visibility refresh + cursor 分頁
// - server 端只回傳 targetType in [all, driver] 的 published 公告
// - dark theme 對齊其他 driver 頁
import type { AnnouncementListItem } from '@/protocol/fetch-api/api/announcement';

definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const items = ref<AnnouncementListItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);

const ApiLoad = async (cursor: string | null = null) => {
  if (cursor) loadingMore.value = true;
  else loading.value = true;
  try {
    const res = await $api.GetDriverAnnouncements({ limit: 20, cursor });
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || '載入失敗', type: 'error' });
      return;
    }
    if (cursor) {
      items.value = [...items.value, ...(res.data?.items ?? [])];
    } else {
      items.value = res.data?.items ?? [];
    }
    nextCursor.value = res.data?.nextCursor ?? null;
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
};

const ClickLoadMore = () => {
  if (loadingMore.value || !nextCursor.value) return;
  ApiLoad(nextCursor.value);
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL = 30_000;
const onVisibility = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') ApiLoad();
};

onMounted(() => {
  ApiLoad();
  pollTimer = setInterval(() => ApiLoad(), POLL_INTERVAL);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
});

const FormatTime = (iso: string | null): string => {
  if (!iso) return '';
  return $dayjs(iso).format('YYYY/MM/DD HH:mm');
};
</script>

<template lang="pug">
.PageDriverAnnouncements
  header.PageDriverAnnouncements__header
    .PageDriverAnnouncements__headerLabel BOARD
    h1.PageDriverAnnouncements__headerTitle 公告欄

  //- 載入中（首次）
  .PageDriverAnnouncements__loading(v-if="loading")
    .PageDriverAnnouncements__spinner

  //- 空狀態
  .PageDriverAnnouncements__empty(v-else-if="items.length === 0")
    .PageDriverAnnouncements__emptyIcon 📣
    p.PageDriverAnnouncements__emptyText 目前還沒有公告

  //- 列表
  .PageDriverAnnouncements__list(v-else)
    NuxtLink.PageDriverAnnouncements__card(
      v-for="ann in items"
      :key="ann.id"
      :to="`/driver/announcements/${ann.id}`"
      :class="{ 'is-unread': !ann.isRead }"
    )
      img.PageDriverAnnouncements__cover(
        v-if="ann.coverImageUrl"
        :src="ann.coverImageUrl"
        :alt="ann.title"
      )
      .PageDriverAnnouncements__coverPlaceholder(v-else) 📢
      .PageDriverAnnouncements__cardBody
        .PageDriverAnnouncements__cardTop
          .PageDriverAnnouncements__cardTitle {{ ann.title }}
          span.PageDriverAnnouncements__cardDot(v-if="!ann.isRead")
        .PageDriverAnnouncements__cardTime {{ FormatTime(ann.publishedAt) }}

    //- 載入更多
    button.PageDriverAnnouncements__loadMore(
      v-if="nextCursor"
      type="button"
      :disabled="loadingMore"
      @click="ClickLoadMore"
    ) {{ loadingMore ? '載入中…' : '載入更多' }}
</template>

<style lang="scss" scoped>
$bg:      #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border:  rgba(255, 255, 255, 0.08);
$amber:   #d4860a;
$muted:   rgba(255, 255, 255, 0.55);
$muted-2: rgba(255, 255, 255, 0.35);

.PageDriverAnnouncements {
  padding: 80px 20px 32px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageDriverAnnouncements__header { margin-bottom: 20px; }

.PageDriverAnnouncements__headerLabel {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: $amber;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  &::before { content: ''; width: 20px; height: 1.5px; background: $amber; }
}

.PageDriverAnnouncements__headerTitle {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 36px;
  letter-spacing: 0.04em;
  color: #fff;
  margin: 0;
}

.PageDriverAnnouncements__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageDriverAnnouncements__spinner {
  width: 32px; height: 32px;
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.PageDriverAnnouncements__empty {
  text-align: center;
  padding: 80px 20px;
}

.PageDriverAnnouncements__emptyIcon { font-size: 48px; margin-bottom: 16px; }

.PageDriverAnnouncements__emptyText {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: $muted-2;
}

.PageDriverAnnouncements__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageDriverAnnouncements__card {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: $surface;
  border: 1px solid $border;
  text-decoration: none;
  color: inherit;
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(212, 134, 10, 0.32);
  }

  &.is-unread {
    background: rgba($amber, 0.08);
    border-color: rgba(212, 134, 10, 0.35);
  }
}

.PageDriverAnnouncements__cover {
  width: 80px;
  height: 60px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
}

.PageDriverAnnouncements__coverPlaceholder {
  width: 80px;
  height: 60px;
  border-radius: 10px;
  background: rgba($amber, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  flex-shrink: 0;
}

.PageDriverAnnouncements__cardBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 4px;
}

.PageDriverAnnouncements__cardTop {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.PageDriverAnnouncements__cardTitle {
  flex: 1;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.PageDriverAnnouncements__cardDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f87171;
  flex-shrink: 0;
  margin-top: 6px;
}

.PageDriverAnnouncements__cardTime {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: $muted-2;
}

.PageDriverAnnouncements__loadMore {
  margin: 18px auto 0;
  padding: 10px 22px;
  border-radius: 100px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.04);
  color: $muted;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  align-self: center;
  transition: background 0.15s, color 0.15s, border-color 0.15s;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.07);
    color: $amber;
    border-color: rgba(212, 134, 10, 0.32);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
