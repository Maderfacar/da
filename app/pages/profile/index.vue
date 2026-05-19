<script setup lang="ts">
import type { PassengerStats } from '@/protocol/fetch-api/api/passenger';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const authStore = StoreAuth();
const { lineProfile, user, isFriend, isSignIn } = storeToRefs(authStore);

const config = useRuntimeConfig().public;
const lineOaUrl = config.lineOaAddUrl as string;
const customerServicePhone = config.customerServicePhone as string;
const customerServiceHours = config.customerServiceHours as string;

// P35：累積統計
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
      console.warn('[profile] stats load failed:', res.status?.message?.zh_tw);
    }
  } finally {
    statsLoading.value = false;
  }
};

onMounted(() => {
  if (isSignIn.value) ApiLoadStats();
});

// 首次行程年份（給 hint 用）
const memberSinceYear = computed(() => {
  if (!stats.value?.firstTripAt) return null;
  return new Date(stats.value.firstTripAt).getFullYear();
});

// 撥號連結（tel:）— 把 +886 ( ) - 空白都去掉
const phoneTelLink = computed(() => {
  if (!customerServicePhone) return '';
  return `tel:${customerServicePhone.replace(/[^\d+]/g, '')}`;
});
</script>

<template lang="pug">
.PageProfile
  .PageProfile__header
    .PageProfile__header-label MY ACCOUNT
    h1.PageProfile__header-title 個人資料

  //- 使用者資訊卡
  .PageProfile__card(v-if="isSignIn && lineProfile")
    img.PageProfile__avatar(
      :src="lineProfile.pictureUrl"
      :alt="lineProfile.displayName"
    )
    .PageProfile__info
      .PageProfile__name {{ lineProfile.displayName }}
      .PageProfile__uid UID: {{ user?.uid }}

    //- LINE 好友狀態
    .PageProfile__friend-status(v-if="isFriend !== null")
      span.PageProfile__friend-dot(:class="{ 'is-friend': isFriend }")
      span {{ isFriend ? '已加入 LINE 官方帳號' : '尚未加入 LINE 官方帳號' }}

    //- 加好友連結
    a.PageProfile__add-friend(
      v-if="isFriend === false && lineOaUrl"
      :href="lineOaUrl"
      target="_blank"
      rel="noopener"
    ) + 加入官方帳號（接收訂單通知）

  //- P35：我的旅程統計（僅登入時顯示）
  section.PageProfile__section(v-if="isSignIn")
    .PageProfile__section-label MY JOURNEYS
    h2.PageProfile__section-title 我的旅程

    .PageProfile__stat-loading(v-if="statsLoading && !stats")
      span 載入中...

    template(v-else)
      .PageProfile__stat-grid
        .PageProfile__stat
          .PageProfile__stat-label TRIPS
          .PageProfile__stat-val {{ stats?.totalTrips ?? 0 }}
          .PageProfile__stat-unit 已完成趟數
        .PageProfile__stat
          .PageProfile__stat-label DISTANCE
          .PageProfile__stat-val {{ (stats?.totalDistanceKm ?? 0).toLocaleString() }}
          .PageProfile__stat-unit 累計里程 · km
        .PageProfile__stat
          .PageProfile__stat-label SPENT
          .PageProfile__stat-val NT$ {{ (stats?.totalSpent ?? 0).toLocaleString() }}
          .PageProfile__stat-unit 累計消費

      .PageProfile__stat-hint(v-if="memberSinceYear")
        | 自 {{ memberSinceYear }} 年起與我們同行
      .PageProfile__stat-hint(v-else-if="(stats?.totalTrips ?? 0) === 0")
        | 還沒有完成的行程 ·
        NuxtLink.PageProfile__inline-link(to="/booking")  立即訂車

  //- P35：客服資訊
  section.PageProfile__section
    .PageProfile__section-label SUPPORT
    h2.PageProfile__section-title 客服資訊

    .PageProfile__support-list
      //- LINE OA（一定顯示，是最主要聯絡管道）
      a.PageProfile__support-row(
        v-if="lineOaUrl"
        :href="lineOaUrl"
        target="_blank"
        rel="noopener"
      )
        .PageProfile__support-icon 💬
        .PageProfile__support-body
          .PageProfile__support-label LINE OFFICIAL
          .PageProfile__support-val 透過 LINE 官方帳號聯繫
        .PageProfile__support-arrow ›

      //- 客服電話（env 有設才顯示）
      a.PageProfile__support-row(
        v-if="customerServicePhone"
        :href="phoneTelLink"
      )
        .PageProfile__support-icon 📞
        .PageProfile__support-body
          .PageProfile__support-label PHONE
          .PageProfile__support-val {{ customerServicePhone }}
          .PageProfile__support-sub(v-if="customerServiceHours") {{ customerServiceHours }}
        .PageProfile__support-arrow ›

  //- 未登入
  .PageProfile__unauth(v-if="!isSignIn")
    .PageProfile__unauth-icon 👤
    p.PageProfile__unauth-text 尚未登入

  CommonFooter
</template>

<style lang="scss" scoped>
// Wave 3-P1：cream theme 對齊 booking 家族
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageProfile {
  padding: 72px 24px 0;
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
}

// 對齊 fare：頁尾 CommonFooter，負 margin 破出 24px 水平 padding 達全幅
.CommonFooter {
  margin: 48px -24px 0;
}

// ── 頁首（對齊 fare）──────────────────────────────────────────
.PageProfile__header {
  padding: 32px 0;

  &-label {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--da-amber);
    margin-bottom: 10px;
  }

  &-title {
    font-family: $font-display;
    font-size: clamp(48px, 14vw, 64px);
    line-height: 0.92;
    color: var(--da-dark);
  }
}

// ── 使用者卡（cream 主卡）─────────────────────────────────────
.PageProfile__card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 24px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  margin-bottom: 16px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
}

.PageProfile__avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba(212, 134, 10, 0.5);
}

.PageProfile__name {
  font-family: $font-condensed;
  font-size: 20px;
  font-weight: 700;
  color: var(--da-dark);
  letter-spacing: 0.04em;
}

.PageProfile__uid {
  font-size: 10px;
  color: var(--da-gray-light);
  font-family: $font-condensed;
  letter-spacing: 0.05em;
}

// ── LINE 好友狀態 ──────────────────────────────────────────────
.PageProfile__friend-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: var(--da-gray);
}

.PageProfile__friend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--da-gray-pale);
  flex-shrink: 0;

  &.is-friend { background: #16a34a; }
}

.PageProfile__add-friend {
  display: inline-block;
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 18px;
  border-radius: 100px;
  background: #06C755;
  color: #fff;
  text-decoration: none;
}

// ── P35：通用 section ─────────────────────────────────────────
.PageProfile__section {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 18px;
  padding: 18px 16px;
  margin-bottom: 16px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
}

.PageProfile__section-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  color: var(--da-amber);
  margin-bottom: 6px;
}

.PageProfile__section-title {
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.04em;
  color: var(--da-dark);
  margin-bottom: 14px;
}

// ── P35：我的旅程 ─────────────────────────────────────────────
.PageProfile__stat-loading {
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--da-gray);
  text-align: center;
  padding: 20px 0;
}

.PageProfile__stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

@media (max-width: 480px) {
  .PageProfile__stat-grid {
    grid-template-columns: 1fr;
  }
}

.PageProfile__stat {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid var(--da-gray-pale);
  border-radius: 12px;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.PageProfile__stat-label {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--da-gray);
}

.PageProfile__stat-val {
  font-family: $font-display;
  font-size: 24px;
  line-height: 1;
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;
}

.PageProfile__stat-unit {
  font-family: $font-condensed;
  font-size: 10px;
  color: var(--da-gray);
}

.PageProfile__stat-hint {
  font-family: $font-body;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--da-gray);
  margin-top: 12px;
  text-align: center;
}

.PageProfile__inline-link {
  color: var(--da-amber);
  text-decoration: none;
  &:hover { text-decoration: underline; }
}

// ── P35：客服資訊 ─────────────────────────────────────────────
.PageProfile__support-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageProfile__support-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid var(--da-gray-pale);
  border-radius: 12px;
  color: inherit;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.8);
    border-color: rgba(212, 134, 10, 0.35);
  }
}

.PageProfile__support-icon {
  font-size: 22px;
  flex-shrink: 0;
}

.PageProfile__support-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.PageProfile__support-label {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--da-amber);
}

.PageProfile__support-val {
  font-family: $font-condensed;
  font-size: 14px;
  color: var(--da-dark);
  letter-spacing: 0.04em;
}

.PageProfile__support-sub {
  font-family: $font-body;
  font-size: 11px;
  color: var(--da-gray);
}

.PageProfile__support-arrow {
  font-size: 20px;
  color: var(--da-gray-light);
  flex-shrink: 0;
}

// ── 未登入 ────────────────────────────────────────────────────
.PageProfile__unauth {
  text-align: center;
  padding: 60px 20px;

  &-icon { font-size: 48px; margin-bottom: 12px; }

  &-text {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 14px;
    color: var(--da-gray);
  }
}
</style>
