<script setup lang="ts">
// Admin Dashboard — 維運總覽
// 線上名單 + 訂單狀態計數 + 啟用中折扣碼（30 秒輪詢）；今日機場人流（進頁取一次）。

import type { DashboardSummaryRes } from '@/protocol/fetch-api/api/admin/dashboard';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const { t } = useI18n();

const summary = ref<DashboardSummaryRes | null>(null);
const loading = ref(false);
const error = ref('');

// 今日機場人流（總入境 / 總出境）
interface AirportFlowRes {
  data?: { hours?: Array<{ forecastCount?: number }>; isMock?: boolean };
}
const airport = ref<{ arrival: number; departure: number; isMock: boolean } | null>(null);

const REFRESH_INTERVAL_MS = 30 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

const ApiGetSummary = async () => {
  loading.value = true;
  try {
    const res = await $api.GetDashboardSummary();
    if (res.status.code !== 200) {
      error.value = res.status.message?.zh_tw || t('adminDashboard.loadError');
      return;
    }
    summary.value = res.data;
    error.value = '';
  } catch {
    error.value = t('adminDashboard.loadError');
  } finally {
    loading.value = false;
  }
};

const ApiGetAirport = async () => {
  try {
    const date = $dayjs().format('YYYY-MM-DD');
    const sumFlow = (r: AirportFlowRes): number =>
      (r?.data?.hours ?? []).reduce((s, h) => s + (h.forecastCount ?? 0), 0);
    const [arr, dep] = await Promise.all([
      $fetch<AirportFlowRes>('/api/airport/flow', { query: { date, terminal: 'all', direction: 'arrival' } }),
      $fetch<AirportFlowRes>('/api/airport/flow', { query: { date, terminal: 'all', direction: 'departure' } }),
    ]);
    airport.value = {
      arrival: sumFlow(arr),
      departure: sumFlow(dep),
      isMock: Boolean(arr?.data?.isMock || dep?.data?.isMock),
    };
  } catch {
    airport.value = null;
  }
};

const RefreshFlow = () => {
  void ApiGetSummary();
};

const airportTotal = computed(() =>
  airport.value ? airport.value.arrival + airport.value.departure : 0,
);

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

const FormatDate = (iso: string): string => (iso ? $dayjs(iso).format('YYYY-MM-DD') : '—');

const DiscountDetail = (c: { discountAmount: number; validFrom: string; validUntil: string; redemptionCount: number; maxRedemptions: number | null }): string => {
  const amount = t('adminDashboard.discount.amount', { n: c.discountAmount.toLocaleString() });
  const range = `${FormatDate(c.validFrom)} ~ ${FormatDate(c.validUntil)}`;
  const used = c.maxRedemptions === null
    ? t('adminDashboard.discount.usedUnlimited', { used: c.redemptionCount })
    : t('adminDashboard.discount.used', { used: c.redemptionCount, max: c.maxRedemptions });
  return `${amount} · ${range} · ${used}`;
};

const DriverStatusLabel = (status: string): string => {
  const key = `adminDashboard.driverStatus.${status}`;
  const label = t(key);
  return label === key ? status : label;
};

onMounted(() => {
  RefreshFlow();
  void ApiGetAirport();
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
      span.PageDashboard__data-time(v-if="summary")
        | {{ t('adminDashboard.dataTime') }}：{{ FormatDataTime(summary.generatedAt) }}
      UiButton(type="secondary" @click="RefreshFlow" :loading="loading") {{ t('adminDashboard.refresh') }}

  p.PageDashboard__error(v-if="error") {{ error }}

  //- ── 訂單狀態 ─────────────────────────────────────────────
  .PageDashboard__section-label {{ t('adminDashboard.orders.title') }}
  .PageDashboard__stats
    .PageDashboard__stat
      span.PageDashboard__stat-label {{ t('adminDashboard.orders.pendingConfirm') }}
      span.PageDashboard__stat-value {{ summary ? summary.orderCounts.pendingConfirm : '—' }}
    .PageDashboard__stat
      span.PageDashboard__stat-label {{ t('adminDashboard.orders.inProgress') }}
      span.PageDashboard__stat-value {{ summary ? summary.orderCounts.inProgress : '—' }}

  //- ── 今日機場人流 ─────────────────────────────────────────
  .PageDashboard__section-label
    | {{ t('adminDashboard.airport.title') }}
    span.PageDashboard__tag(v-if="airport && airport.isMock") {{ t('adminDashboard.airport.mock') }}
  .PageDashboard__stats
    .PageDashboard__stat
      span.PageDashboard__stat-label {{ t('adminDashboard.airport.arrival') }}
      span.PageDashboard__stat-value {{ airport ? airport.arrival.toLocaleString() : '—' }}
    .PageDashboard__stat
      span.PageDashboard__stat-label {{ t('adminDashboard.airport.departure') }}
      span.PageDashboard__stat-value {{ airport ? airport.departure.toLocaleString() : '—' }}
    .PageDashboard__stat.is-accent
      span.PageDashboard__stat-label {{ t('adminDashboard.airport.total') }}
      span.PageDashboard__stat-value {{ airport ? airportTotal.toLocaleString() : '—' }}

  //- ── 啟用中折扣碼 ─────────────────────────────────────────
  .PageDashboard__section-label {{ t('adminDashboard.discount.title') }}
  .PageDashboard__card
    .PageDashboard__discount-list(v-if="summary && summary.discountCodes.length")
      .PageDashboard__discount-row(v-for="c in summary.discountCodes" :key="c.code")
        span.PageDashboard__discount-code {{ c.code }}
        span.PageDashboard__discount-detail {{ DiscountDetail(c) }}
    .PageDashboard__empty(v-else-if="summary") {{ t('adminDashboard.discount.empty') }}
    .PageDashboard__empty(v-else) {{ t('adminDashboard.loading') }}

  //- ── 線上名單 ─────────────────────────────────────────────
  .PageDashboard__section-label {{ t('adminDashboard.online.title') }}
  .PageDashboard__cards
    .PageDashboard__card
      .PageDashboard__card-head
        span.PageDashboard__card-icon 🧍
        span.PageDashboard__card-label {{ t('adminDashboard.online.passengers') }}
        span.PageDashboard__card-count {{ summary ? summary.passengers.count : '—' }}
      p.PageDashboard__card-hint {{ t('adminDashboard.passengerHint') }}
      .PageDashboard__list(v-if="summary && summary.passengers.list.length")
        .PageDashboard__row(v-for="p in summary.passengers.list" :key="p.uid")
          .PageDashboard__avatar-wrap
            img.PageDashboard__avatar(v-if="p.pictureUrl" :src="p.pictureUrl" :alt="p.displayName")
            .PageDashboard__avatar-fallback(v-else) {{ (p.displayName || '?').slice(0, 1) }}
          .PageDashboard__row-main
            span.PageDashboard__row-name {{ p.displayName || p.uid }}
            span.PageDashboard__row-time {{ FormatRelative(p.lastSeenAt) }}
      .PageDashboard__empty(v-else-if="summary") {{ t('adminDashboard.empty.passengers') }}
      .PageDashboard__empty(v-else) {{ t('adminDashboard.loading') }}

    .PageDashboard__card
      .PageDashboard__card-head
        span.PageDashboard__card-icon 🚗
        span.PageDashboard__card-label {{ t('adminDashboard.online.drivers') }}
        span.PageDashboard__card-count {{ summary ? summary.drivers.count : '—' }}
      p.PageDashboard__card-hint {{ t('adminDashboard.windowHint') }}
      .PageDashboard__list(v-if="summary && summary.drivers.list.length")
        .PageDashboard__row(v-for="d in summary.drivers.list" :key="d.uid")
          .PageDashboard__avatar-wrap
            img.PageDashboard__avatar(v-if="d.pictureUrl" :src="d.pictureUrl" :alt="d.displayName")
            .PageDashboard__avatar-fallback(v-else) {{ (d.displayName || '?').slice(0, 1) }}
          .PageDashboard__row-main
            span.PageDashboard__row-name {{ d.displayName || d.uid }}
            span.PageDashboard__row-time {{ FormatRelative(d.lastActiveAt) }}
          span.PageDashboard__status(v-if="d.driverStatus" :class="`is-${d.driverStatus}`") {{ DriverStatusLabel(d.driverStatus) }}
      .PageDashboard__empty(v-else-if="summary") {{ t('adminDashboard.empty.drivers') }}
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

.PageDashboard__section-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--da-gray);
  margin: 24px 0 12px;
}

.PageDashboard__tag {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--da-amber);
  background: rgba(212, 134, 10, 0.12);
  border: 1px solid rgba(212, 134, 10, 0.3);
  padding: 2px 8px;
  border-radius: 100px;
}

// ── 統計卡 ─────────────────────────────────────────────────
.PageDashboard__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.PageDashboard__stat {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-gray-pale);
  border-radius: 16px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &.is-accent {
    border-color: rgba(212, 134, 10, 0.4);
    background: rgba(212, 134, 10, 0.06);
  }
}

.PageDashboard__stat-label {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--da-gray);
}

.PageDashboard__stat-value {
  font-family: $font-display;
  font-size: 44px;
  line-height: 1;
  color: var(--da-dark);
}

.PageDashboard__stat.is-accent .PageDashboard__stat-value {
  color: var(--da-amber);
}

// ── 卡片 ───────────────────────────────────────────────────
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

// ── 折扣碼清單 ─────────────────────────────────────────────
.PageDashboard__discount-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageDashboard__discount-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 12px 14px;
  background: var(--da-cream);
  border: 1px solid var(--da-gray-pale);
  border-radius: 10px;
  flex-wrap: wrap;
}

.PageDashboard__discount-code {
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--da-dark);
}

.PageDashboard__discount-detail {
  font-family: $font-body;
  font-size: 13px;
  color: var(--da-gray);
}

// ── 線上名單 ───────────────────────────────────────────────
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

  &.is-online  { background: rgba(59, 130, 246, 0.12); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); }
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
