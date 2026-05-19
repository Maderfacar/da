<script setup lang="ts">
// PassengerHistoryJourneys — 歷史訂單頁「我的旅程」累積統計（原 /profile P35 section）
import type { PassengerStats } from '@/protocol/fetch-api/api/passenger';

const { user, isSignIn } = storeToRefs(StoreAuth());

const stats = ref<PassengerStats | null>(null);
const statsLoading = ref(false);

const ApiLoadStats = async () => {
  if (!user.value?.uid) return;
  statsLoading.value = true;
  try {
    const res = await $api.GetPassengerStats();
    if (res.status?.code === $enum.apiStatus.success) {
      stats.value = res.data as PassengerStats;
    } else {
      console.warn('[history/journeys] stats load failed:', res.status?.message?.zh_tw);
    }
  } finally {
    statsLoading.value = false;
  }
};

// 首次行程年份（給 hint 用）
const memberSinceYear = computed(() => {
  if (!stats.value?.firstTripAt) return null;
  return new Date(stats.value.firstTripAt).getFullYear();
});

onMounted(() => {
  if (isSignIn.value) ApiLoadStats();
});
</script>

<template lang="pug">
section.PassengerHistoryJourneys(v-if="isSignIn")
  .PassengerHistoryJourneys__label MY JOURNEYS
  h2.PassengerHistoryJourneys__title 我的旅程

  .PassengerHistoryJourneys__loading(v-if="statsLoading && !stats")
    span 載入中...

  template(v-else)
    .PassengerHistoryJourneys__grid
      .PassengerHistoryJourneys__stat
        .PassengerHistoryJourneys__stat-label TRIPS
        .PassengerHistoryJourneys__stat-val {{ stats?.totalTrips ?? 0 }}
        .PassengerHistoryJourneys__stat-unit 已完成趟數
      .PassengerHistoryJourneys__stat
        .PassengerHistoryJourneys__stat-label DISTANCE
        .PassengerHistoryJourneys__stat-val {{ (stats?.totalDistanceKm ?? 0).toLocaleString() }}
        .PassengerHistoryJourneys__stat-unit 累計里程 · km
      .PassengerHistoryJourneys__stat
        .PassengerHistoryJourneys__stat-label SPENT
        .PassengerHistoryJourneys__stat-val NT$ {{ (stats?.totalSpent ?? 0).toLocaleString() }}
        .PassengerHistoryJourneys__stat-unit 累計消費

    .PassengerHistoryJourneys__hint(v-if="memberSinceYear")
      | 自 {{ memberSinceYear }} 年起與我們同行
    .PassengerHistoryJourneys__hint(v-else-if="(stats?.totalTrips ?? 0) === 0")
      | 還沒有完成的行程 ·
      NuxtLink.PassengerHistoryJourneys__link(to="/booking")  立即訂車
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PassengerHistoryJourneys {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 18px;
  padding: 18px 16px;
  margin-bottom: 16px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
}

.PassengerHistoryJourneys__label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  color: var(--da-amber);
  margin-bottom: 6px;
}

.PassengerHistoryJourneys__title {
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.04em;
  color: var(--da-dark);
  margin-bottom: 14px;
}

.PassengerHistoryJourneys__loading {
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--da-gray);
  text-align: center;
  padding: 20px 0;
}

.PassengerHistoryJourneys__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

@media (max-width: 480px) {
  .PassengerHistoryJourneys__grid {
    grid-template-columns: 1fr;
  }
}

.PassengerHistoryJourneys__stat {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid var(--da-gray-pale);
  border-radius: 12px;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.PassengerHistoryJourneys__stat-label {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--da-gray);
}

.PassengerHistoryJourneys__stat-val {
  font-family: $font-display;
  font-size: 24px;
  line-height: 1;
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;
}

.PassengerHistoryJourneys__stat-unit {
  font-family: $font-condensed;
  font-size: 10px;
  color: var(--da-gray);
}

.PassengerHistoryJourneys__hint {
  font-family: $font-body;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--da-gray);
  margin-top: 12px;
  text-align: center;
}

.PassengerHistoryJourneys__link {
  color: var(--da-amber);
  text-decoration: none;
  &:hover { text-decoration: underline; }
}
</style>
