<script setup lang="ts">
// Admin Dashboard — 線上名單（admin-auto-notify-dashboard 變更）
// 第一版僅顯示 5 分鐘內活躍的乘客 / 司機；30 秒輪詢自動刷新。

import type { DashboardOnlineRes } from '@/protocol/fetch-api/api/admin/dashboard';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const { t } = useI18n();

const data = ref<DashboardOnlineRes | null>(null);
const loading = ref(false);
const error = ref('');

const REFRESH_INTERVAL_MS = 30 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

const ApiGetOnline = async () => {
  loading.value = true;
  try {
    const res = await $api.GetDashboardOnline();
    if (res.status.code !== 200) {
      error.value = res.status.message?.zh_tw || t('adminDashboard.loadError');
      return;
    }
    data.value = res.data;
    error.value = '';
  } catch {
    error.value = t('adminDashboard.loadError');
  } finally {
    loading.value = false;
  }
};

const RefreshFlow = () => {
  void ApiGetOnline();
};

// 相對活躍時間：剛剛 / N 分鐘前
const FormatRelative = (iso: string): string => {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '—';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('adminDashboard.justNow');
  return t('adminDashboard.minutesAgo', { n: mins });
};

const FormatDataTime = (iso: string): string => {
  if (!iso) return '—';
  return $dayjs(iso).format('YYYY/MM/DD HH:mm:ss');
};

const DriverStatusLabel = (status: string): string => {
  const key = `adminDashboard.driverStatus.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

onMounted(() => {
  RefreshFlow();
  timer = setInterval(RefreshFlow, REFRESH_INTERVAL_MS);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template lang="pug">
.PageDashboard
  .PageDashboard__header
    div
      h1.PageDashboard__title {{ t('adminDashboard.title') }}
      p.PageDashboard__sub {{ t('adminDashboard.subtitle') }}
    .PageDashboard__header-right
      span.PageDashboard__data-time(v-if="data")
        | {{ t('adminDashboard.dataTime') }}：{{ FormatDataTime(data.generatedAt) }}
      UiButton(type="secondary" @click="RefreshFlow" :loading="loading") {{ t('adminDashboard.refresh') }}

  p.PageDashboard__error(v-if="error") {{ error }}

  .PageDashboard__cards
    //- ── 線上乘客 ─────────────────────────────────────────
    .PageDashboard__card
      .PageDashboard__card-head
        span.PageDashboard__card-icon 🧍
        span.PageDashboard__card-label {{ t('adminDashboard.online.passengers') }}
        span.PageDashboard__card-count {{ data ? data.passengers.count : '—' }}
      p.PageDashboard__card-hint {{ t('adminDashboard.passengerHint') }}
      .PageDashboard__list(v-if="data && data.passengers.list.length")
        .PageDashboard__row(v-for="p in data.passengers.list" :key="p.uid")
          .PageDashboard__avatar-wrap
            img.PageDashboard__avatar(v-if="p.pictureUrl" :src="p.pictureUrl" :alt="p.displayName")
            .PageDashboard__avatar-fallback(v-else) {{ (p.displayName || '?').slice(0, 1) }}
          .PageDashboard__row-main
            span.PageDashboard__row-name {{ p.displayName || p.uid }}
            span.PageDashboard__row-time {{ FormatRelative(p.lastSeenAt) }}
      .PageDashboard__empty(v-else-if="data") {{ t('adminDashboard.empty.passengers') }}
      .PageDashboard__empty(v-else) {{ t('adminDashboard.loading') }}

    //- ── 線上司機 ─────────────────────────────────────────
    .PageDashboard__card
      .PageDashboard__card-head
        span.PageDashboard__card-icon 🚗
        span.PageDashboard__card-label {{ t('adminDashboard.online.drivers') }}
        span.PageDashboard__card-count {{ data ? data.drivers.count : '—' }}
      p.PageDashboard__card-hint {{ t('adminDashboard.windowHint') }}
      .PageDashboard__list(v-if="data && data.drivers.list.length")
        .PageDashboard__row(v-for="d in data.drivers.list" :key="d.uid")
          .PageDashboard__avatar-wrap
            img.PageDashboard__avatar(v-if="d.pictureUrl" :src="d.pictureUrl" :alt="d.displayName")
            .PageDashboard__avatar-fallback(v-else) {{ (d.displayName || '?').slice(0, 1) }}
          .PageDashboard__row-main
            span.PageDashboard__row-name {{ d.displayName || d.uid }}
            span.PageDashboard__row-time {{ FormatRelative(d.lastActiveAt) }}
          span.PageDashboard__status(v-if="d.driverStatus" :class="`is-${d.driverStatus}`") {{ DriverStatusLabel(d.driverStatus) }}
      .PageDashboard__empty(v-else-if="data") {{ t('adminDashboard.empty.drivers') }}
      .PageDashboard__empty(v-else) {{ t('adminDashboard.loading') }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageDashboard {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.PageDashboard__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.PageDashboard__title {
  font-family: $font-display;
  font-size: 32px;
  color: var(--da-dark);
  letter-spacing: 0.04em;
}

.PageDashboard__sub {
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--da-gray);
  text-transform: uppercase;
  margin-top: 4px;
}

.PageDashboard__header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.PageDashboard__data-time {
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--da-gray);
}

.PageDashboard__error {
  color: #e74c3c;
  font-family: $font-body;
  font-size: 14px;
  margin: 8px 0;
}

.PageDashboard__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.PageDashboard__card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-gray-pale);
  border-radius: 16px;
  padding: 20px;
}

.PageDashboard__card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.PageDashboard__card-icon { font-size: 22px; line-height: 1; }

.PageDashboard__card-label {
  flex: 1;
  font-family: $font-condensed;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--da-dark);
}

.PageDashboard__card-count {
  font-family: $font-display;
  font-size: 36px;
  line-height: 1;
  color: var(--da-amber);
}

.PageDashboard__card-hint {
  font-family: $font-body;
  font-size: 12px;
  color: var(--da-gray);
  margin-bottom: 14px;
}

.PageDashboard__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 480px;
  overflow-y: auto;
}

.PageDashboard__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--da-cream);
  border: 1px solid var(--da-gray-pale);
  border-radius: 10px;
}

.PageDashboard__avatar-wrap { flex-shrink: 0; }

.PageDashboard__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.PageDashboard__avatar-fallback {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--da-dark);
  color: var(--da-cream);
  font-family: $font-condensed;
  font-size: 18px;
  font-weight: 700;
  text-transform: uppercase;
}

.PageDashboard__row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.PageDashboard__row-name {
  font-family: $font-body;
  font-size: 14px;
  font-weight: 600;
  color: var(--da-dark);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.PageDashboard__row-time {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--da-gray);
}

.PageDashboard__status {
  flex-shrink: 0;
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 100px;

  &.is-online  { background: rgba(46, 160, 67, 0.12);  color: #2ea043; border: 1px solid rgba(46, 160, 67, 0.3); }
  &.is-busy    { background: rgba(212, 134, 10, 0.12); color: var(--da-amber); border: 1px solid rgba(212, 134, 10, 0.3); }
  &.is-offline { background: rgba(127, 140, 141, 0.12); color: #7f8c8d; border: 1px solid rgba(127, 140, 141, 0.3); }
}

.PageDashboard__empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--da-gray);
  font-family: $font-body;
  font-size: 13px;
}

@media (max-width: 768px) {
  .PageDashboard {
    padding: 16px;
  }

  .PageDashboard__header {
    flex-direction: column;
    align-items: flex-start;
  }

  .PageDashboard__cards {
    grid-template-columns: 1fr;
  }
}
</style>
