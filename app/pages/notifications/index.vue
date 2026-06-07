<script setup lang="ts">
// P37 Phase 5.1：乘客最新消息列表
//
// - 卡片：封面縮圖 80×60 + 標題 + 發佈時間 + 未讀紅點
// - 點擊卡片 → /notifications/[id]
// - 分頁：cursor-based（後端依 publishedAt desc）
// - 30s polling + visibility refresh（沿用 orders 端模式）
import type { AnnouncementListItem } from '@/protocol/fetch-api/api/announcement';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

const items = ref<AnnouncementListItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);

const ApiLoad = async (cursor: string | null = null) => {
  if (cursor) {
    loadingMore.value = true;
  } else {
    loading.value = true;
  }
  try {
    const res = await $api.GetAnnouncements({ limit: 20, cursor });
    if (res.status.code !== $enum.apiStatus.success) {
      ElMessage({ message: res.status.message?.zh_tw || t('notifications.loadFailed'), type: 'error' });
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

// 30s polling + visibility refresh
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
.PageNotifications
  header.PageNotifications__header
    .PageNotifications__headerLabel {{ $t('notifications.label') }}
    h1.PageNotifications__headerTitle {{ $t('notifications.title') }}

  //- 載入中（首次）
  .PageNotifications__loading(v-if="loading")
    .PageNotifications__spinner

  //- 空狀態
  .PageNotifications__empty(v-else-if="items.length === 0")
    .PageNotifications__emptyIcon 📣
    p.PageNotifications__emptyText {{ $t('notifications.empty') }}

  //- 列表
  .PageNotifications__list(v-else)
    NuxtLink.PageNotifications__card(
      v-for="ann in items"
      :key="ann.id"
      :to="`/notifications/${ann.id}`"
      :class="{ 'is-unread': !ann.isRead }"
    )
      img.PageNotifications__cover(
        v-if="ann.coverImageUrl"
        :src="ann.coverImageUrl"
        :alt="ann.title"
      )
      .PageNotifications__coverPlaceholder(v-else) 📢
      .PageNotifications__cardBody
        .PageNotifications__cardTop
          .PageNotifications__cardTitle {{ ann.title }}
          span.PageNotifications__cardDot(v-if="!ann.isRead")
        .PageNotifications__cardTime {{ FormatTime(ann.publishedAt) }}

    //- 載入更多
    button.PageNotifications__loadMore(
      v-if="nextCursor"
      type="button"
      :disabled="loadingMore"
      @click="ClickLoadMore"
    ) {{ loadingMore ? $t('notifications.loading') : $t('notifications.loadMore') }}
</template>

<style lang="scss" scoped>
// Wave 3-P1：cream theme 對齊 booking 家族
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageNotifications {
  padding: 72px 24px 0;
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
}

// ── 頁首 ───────────────────────────────────────────────────
.PageNotifications__header { padding: 32px 0; }

.PageNotifications__headerLabel {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 10px;
}

.PageNotifications__headerTitle {
  font-family: $font-display;
  font-size: clamp(48px, 14vw, 64px);
  line-height: 0.92;
  color: var(--da-dark);
  margin: 0;
}

// ── 載入中 ────────────────────────────────────────────────
.PageNotifications__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageNotifications__spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: var(--da-amber);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 空狀態 ────────────────────────────────────────────────
.PageNotifications__empty {
  text-align: center;
  padding: 80px 20px;
}

.PageNotifications__emptyIcon { font-size: 48px; margin-bottom: 16px; }

.PageNotifications__emptyText {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: var(--da-gray);
}

// ── 列表 ──────────────────────────────────────────────────
.PageNotifications__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageNotifications__card {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 18px;
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  text-decoration: none;
  color: inherit;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;

  &:hover {
    background: rgba(250, 248, 244, 0.92);
    border-color: rgba(212, 134, 10, 0.32);
    box-shadow: 0 6px 24px rgba(26, 24, 20, 0.08);
  }

  &.is-unread {
    background: var(--da-amber-pale);
    border-color: rgba(212, 134, 10, 0.35);
  }
}

.PageNotifications__cover {
  width: 80px;
  height: 60px;
  border-radius: 10px;
  object-fit: cover;
  flex-shrink: 0;
}

.PageNotifications__coverPlaceholder {
  width: 80px;
  height: 60px;
  border-radius: 10px;
  background: var(--da-amber-pale);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  flex-shrink: 0;
}

.PageNotifications__cardBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 4px;
}

.PageNotifications__cardTop {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.PageNotifications__cardTitle {
  flex: 1;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--da-dark);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.PageNotifications__cardDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #dc2626;
  flex-shrink: 0;
  margin-top: 6px;
}

.PageNotifications__cardTime {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--da-gray-light);
}

// ── 載入更多 ──────────────────────────────────────────────
.PageNotifications__loadMore {
  margin: 18px auto 0;
  padding: 10px 22px;
  border-radius: 100px;
  border: 1px solid var(--da-gray-pale);
  background: rgba(250, 248, 244, 0.6);
  color: var(--da-gray);
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  align-self: center;
  transition: background 0.15s, color 0.15s, border-color 0.15s;

  &:hover:not(:disabled) {
    background: rgba(250, 248, 244, 0.95);
    color: var(--da-amber);
    border-color: rgba(212, 134, 10, 0.32);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
