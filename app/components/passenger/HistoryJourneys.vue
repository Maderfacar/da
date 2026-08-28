<script setup lang="ts">
// PassengerHistoryJourneys — 歷史訂單頁「我的旅程」累積統計（原 /profile P35 section）
import type { PassengerStats } from '@/protocol/fetch-api/api/passenger';

const { isSignIn } = storeToRefs(StoreAuth());

const stats = ref<PassengerStats | null>(null);
const statsLoading = ref(false);

const ApiLoadStats = async () => {
  // GetPassengerStats() 由 server 從 session（cookie / Bearer）解身分，不需 client 帶 uid；
  // 認證根治 P3 後 user 可能為 null（server OAuth 登入），故只用 isSignIn 當閘，不再卡 user.uid。
  if (!isSignIn.value) return;
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

.PassengerHistoryJourneys {
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: 18px 16px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-soft);
}

.PassengerHistoryJourneys__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--accent-text);
  margin-bottom: 6px;
}

.PassengerHistoryJourneys__title {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-label);
  color: var(--da-dark);
  margin-bottom: 14px;
}

.PassengerHistoryJourneys__loading {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
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
  background: var(--surface-a50);
  border: 1px solid var(--da-gray-pale);
  border-radius: var(--r-md);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.PassengerHistoryJourneys__stat-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  color: var(--da-gray);
}

.PassengerHistoryJourneys__stat-val {
  font-family: var(--ff-data);
  font-size: var(--fs-h2);
  line-height: var(--lh-flat);
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;
}

.PassengerHistoryJourneys__stat-unit {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--da-gray);
}

.PassengerHistoryJourneys__hint {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-label);
  color: var(--da-gray);
  margin-top: 12px;
  text-align: center;
}

.PassengerHistoryJourneys__link {
  color: var(--accent-text);
  text-decoration: none;
  &:hover { text-decoration: underline; }
}
</style>
