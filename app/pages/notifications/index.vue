<script setup lang="ts">
// P37 Phase 5.1：乘客最新消息列表
//
// - 卡片：封面縮圖 80×60 + 標題 + 發佈時間 + 未讀紅點
// - 點擊卡片 → /notifications/[id]
// - 分頁：cursor-based（後端依 publishedAt desc）
// - 30s polling + visibility refresh（沿用 orders 端模式）
import type { AnnouncementCategory, AnnouncementListItem } from '@/protocol/fetch-api/api/announcement';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const items = ref<AnnouncementListItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);

// ── 分類 chips（提案第四張畫面：全部 / 公告 / 我的行程）──────
// category 是 targetType 的衍生檢視（trip = 針對我某張訂單的訊息），server 過濾。
// 選中的分類進 URL query（?cat=trip），分享 / 重整不掉狀態。
type CategoryFilter = 'all' | AnnouncementCategory;
const CATEGORY_FILTERS: readonly CategoryFilter[] = ['all', 'announcement', 'trip'];
const _initialCat = ((): CategoryFilter => {
  const q = route.query.cat;
  return q === 'announcement' || q === 'trip' ? q : 'all';
})();
const activeCategory = ref<CategoryFilter>(_initialCat);

const ClickCategory = (cat: CategoryFilter) => {
  if (activeCategory.value === cat) return;
  activeCategory.value = cat;
  router.replace({ query: { ...route.query, cat: cat === 'all' ? undefined : cat } });
  ApiLoad();
};

// 換分類時舊請求可能晚到 —— 用序號擋掉過期回應，避免 chips 快速切換時列表閃回上一類
let _loadSeq = 0;

const ApiLoad = async (cursor: string | null = null) => {
  const seq = ++_loadSeq;
  if (cursor) {
    loadingMore.value = true;
  } else {
    loading.value = true;
  }
  try {
    const res = await $api.GetAnnouncements({
      limit: 20,
      cursor,
      ...(activeCategory.value !== 'all' ? { category: activeCategory.value } : {}),
    });
    if (seq !== _loadSeq) return;
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
    if (seq === _loadSeq) {
      loading.value = false;
      loadingMore.value = false;
    }
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

// 列表只給 MM/DD —— 提案第四張畫面：日期靠右、等高等寬，用途是「一眼掃時間」而不是精讀。
// 完整時間戳留在詳情頁（notifications/[id] 的 publishedAt）。
const FormatTime = (iso: string | null): string => {
  if (!iso) return '';
  return $dayjs(iso).format('MM/DD');
};
</script>

<template lang="pug">
.PageNotifications
  //- 提案總則 02：巨大襯線標題拿掉 —— 頁名已經在頂欄。

  //- 分類 chips（提案第四張畫面）：category 衍生自 targetType（trip = order-targeted），
  //- server 過濾。注意「我的行程」目前只有 admin 手動發 order-targeted 公告時才有內容 ——
  //- 行程狀態變更本身仍只走 LINE 推播，沒有自動落一則站內訊息。
  .PageNotifications__chips
    button.PageNotifications__chip(
      v-for="cat in CATEGORY_FILTERS"
      :key="cat"
      type="button"
      :class="{ 'is-active': activeCategory === cat }"
      @click="ClickCategory(cat)"
    ) {{ $t(`notifications.filter.${cat}`) }}

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
          //- 未讀：左側一顆古銅點（提案第四張畫面）—— 原本是右側紅點
          span.PageNotifications__cardDot(v-if="!ann.isRead")
          .PageNotifications__cardTitle {{ ann.title }}
        .PageNotifications__cardTime.u-data {{ FormatTime(ann.publishedAt) }}

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

.PageNotifications {
  padding-block: 72px 0;
  /* 桌機：底色留滿版，內容收進 --shell 置中（手機時 max() 取回原本的邊距）*/
  padding-inline: max(24px, calc((100% - var(--shell)) / 2));
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
}

// ── 頁首 ───────────────────────────────────────────────────
.PageNotifications__header { padding: 32px 0; }

.PageNotifications__headerLabel {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  text-transform: uppercase;
  color: var(--accent-text);
  margin-bottom: 10px;
}

.PageNotifications__headerTitle {
  font-family: var(--ff-display);
  font-size: clamp(48px, 14vw, 64px);
  line-height: var(--lh-flat);
  color: var(--da-dark);
  margin: 0;
}

// ── 分類 chips（與 /orders 狀態 chips 同語彙：pill、選中換 ink 底）──
.PageNotifications__chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px 0 14px;
  scrollbar-width: none;
}

.PageNotifications__chips::-webkit-scrollbar { display: none; }

.PageNotifications__chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-pill);
  background: var(--surface-raised);
  color: var(--ink-soft);
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  cursor: pointer;
  white-space: nowrap;
  /* 選中只換顏色，不動 border-width —— 動了會造成 0.5px 重排 */
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.PageNotifications__chip.is-active {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--surface-raised);
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
  border: 2px solid var(--accent-a20);
  border-top-color: var(--da-amber);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 空狀態 ────────────────────────────────────────────────
.PageNotifications__empty {
  text-align: center;
  padding: 80px 20px;
}

.PageNotifications__emptyIcon { font-size: var(--fs-display); margin-bottom: 16px; }

.PageNotifications__emptyText {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
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
  border-radius: var(--r-lg);
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  text-decoration: none;
  color: inherit;
  box-shadow: var(--shadow-soft);
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--surface-a88);
    border-color: var(--accent-a30);
    box-shadow: var(--shadow-pop);
  }

  &.is-unread {
    background: var(--da-amber-pale);
    border-color: var(--accent-a30);
  }
}

.PageNotifications__cover {
  width: 80px;
  height: 60px;
  border-radius: var(--r-md);
  object-fit: cover;
  flex-shrink: 0;
}

.PageNotifications__coverPlaceholder {
  width: 80px;
  height: 60px;
  border-radius: var(--r-md);
  background: var(--da-amber-pale);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-h1);
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
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--da-dark);
  line-height: var(--lh-normal);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

/* 未讀點：提案改成左側一顆**古銅**點。
   語意四色只標狀態（good/wait/note/stop），「還沒看」不是錯誤狀態，
   用紅點是把注意力等級拉得比它該有的高；主色才是「這裡有東西」的既有語彙。 */
.PageNotifications__cardDot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-round);
  background: var(--accent);
  flex-shrink: 0;
  margin-top: 8px;
}

/* 日期靠右等高等寬，一眼掃時間（提案第四張畫面） */
.PageNotifications__cardTime {
  align-self: flex-end;
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--da-gray-light);
}

// ── 載入更多 ──────────────────────────────────────────────
.PageNotifications__loadMore {
  margin: 18px auto 0;
  padding: 10px 22px;
  border-radius: var(--r-pill);
  border: 1px solid var(--da-gray-pale);
  background: var(--surface-a60);
  color: var(--da-gray);
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  cursor: pointer;
  align-self: center;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) {
    background: var(--surface-a96);
    color: var(--accent-text);
    border-color: var(--accent-a30);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
