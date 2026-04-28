<script setup lang="ts">
import { VEHICLE_CONFIGS, ORDER_TYPES } from '~shared/pricing';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

type TripStatus = 'pending' | 'confirmed' | 'in-progress' | 'completed' | 'cancelled';

interface TripItem {
  id: string;
  from: string;
  to: string;
  status: TripStatus;
  date: string;
  time: string;
  vehicle: string;
  passengerCount: number;
  estimatedFare: number;
  orderType: string;
}

const _locationLabel = (loc: GooglePlace): string =>
  (loc.displayName ?? loc.address).split(',')[0].trim();

const _mapToTripItem = (o: OrderItem): TripItem => {
  const dt = $dayjs(o.pickupDateTime);
  const vehicleCfg = VEHICLE_CONFIGS[o.vehicleType as keyof typeof VEHICLE_CONFIGS];
  const orderTypeCfg = ORDER_TYPES.find((t) => t.value === o.orderType);
  return {
    id: o.orderId.slice(-8).toUpperCase(),
    from: _locationLabel(o.pickupLocation),
    to: _locationLabel(o.dropoffLocation),
    status: (o.orderStatus as TripStatus) ?? 'pending',
    date: dt.isValid() ? dt.format('YYYY.MM.DD') : '',
    time: dt.isValid() ? dt.format('HH:mm') : '',
    vehicle: vehicleCfg ? `${vehicleCfg.label} ${vehicleCfg.labelEn}` : o.vehicleType,
    passengerCount: o.passengerCount ?? 1,
    estimatedFare: o.estimatedFare,
    orderType: orderTypeCfg?.label ?? o.orderType,
  };
};

const loading = ref(false);
const trips = ref<TripItem[]>([]);
const STATUS_TAB_KEYS: Array<TripStatus | 'all'> = ['all', 'pending', 'confirmed', 'in-progress', 'completed'];

const STATUS_CLS: Record<TripStatus, string> = {
  pending:       'is-pending',
  confirmed:     'is-confirmed',
  'in-progress': 'is-progress',
  completed:     'is-done',
  cancelled:     'is-cancelled',
};

const activeTab = ref<TripStatus | 'all'>('all');

const filteredTrips = computed(() =>
  activeTab.value === 'all'
    ? trips.value
    : trips.value.filter((t) => t.status === activeTab.value)
);

const upcomingTrips = computed(() =>
  filteredTrips.value.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
);

const pastTrips = computed(() =>
  filteredTrips.value.filter((t) => t.status === 'completed' || t.status === 'cancelled')
);

const ApiLoadOrders = async () => {
  const authStore = StoreAuth();
  const userId = authStore.user?.uid;
  if (!userId) return;

  loading.value = true;
  const res = await $api.GetOrderList({ userId });
  loading.value = false;

  if (res.status.code !== $enum.apiStatus.success && res.status.code !== 0) return;
  trips.value = (res.data as OrderItem[]).map(_mapToTripItem);
};

onMounted(ApiLoadOrders);
</script>

<template lang="pug">
.PageUpcoming
  .PageUpcoming__watermark TRIPS

  //- 頁首
  .PageUpcoming__header
    .PageUpcoming__header-label DEPARTURE & ARRIVAL
    h1.PageUpcoming__header-title {{ $t('upcoming.title') }}
    p.PageUpcoming__header-sub MY JOURNEYS

  //- 狀態篩選 Tab
  .PageUpcoming__tabs
    button.PageUpcoming__tab(
      v-for="key in STATUS_TAB_KEYS"
      :key="key"
      :class="{ 'is-active': activeTab === key }"
      @click="activeTab = key"
    ) {{ $t('upcoming.tab.' + key) }}

  //- Loading 骨架
  template(v-if="loading")
    .PageUpcoming__skeleton(v-for="n in 2" :key="n")

  template(v-else)
    //- 即將出發
    template(v-if="upcomingTrips.length")
      .PageUpcoming__section-label {{ $t('upcoming.section.upcoming') }}
      .PageUpcoming__list
        .PageUpcoming__card(v-for="trip in upcomingTrips" :key="trip.id")
          .PageUpcoming__card-top
            .PageUpcoming__route
              span.PageUpcoming__route-code {{ trip.from }}
              .PageUpcoming__route-arrow
                .PageUpcoming__route-line
                NuxtIcon(name="mdi:airplane")
                .PageUpcoming__route-line
              span.PageUpcoming__route-code {{ trip.to }}
            span.PageUpcoming__status(:class="STATUS_CLS[trip.status]")
              | {{ $t('status.' + trip.status) }}
          .PageUpcoming__card-meta
            .PageUpcoming__meta-row
              .PageUpcoming__meta-item
                span.PageUpcoming__meta-label {{ $t('upcoming.meta.type') }}
                span.PageUpcoming__meta-val {{ trip.orderType }}
              .PageUpcoming__meta-item
                span.PageUpcoming__meta-label {{ $t('upcoming.meta.date') }}
                span.PageUpcoming__meta-val {{ trip.date }}
            .PageUpcoming__meta-row
              .PageUpcoming__meta-item
                span.PageUpcoming__meta-label {{ $t('upcoming.meta.time') }}
                span.PageUpcoming__meta-val {{ trip.time }}
              .PageUpcoming__meta-item
                span.PageUpcoming__meta-label {{ $t('upcoming.meta.vehicle') }}
                span.PageUpcoming__meta-val {{ trip.vehicle }}
            .PageUpcoming__meta-row
              .PageUpcoming__meta-item
                span.PageUpcoming__meta-label {{ $t('upcoming.meta.passengers') }}
                span.PageUpcoming__meta-val {{ trip.passengerCount }} {{ $t('upcoming.unit.person') }}
              .PageUpcoming__meta-item
                span.PageUpcoming__meta-label {{ $t('upcoming.meta.fare') }}
                span.PageUpcoming__meta-val.is-fare NT$ {{ trip.estimatedFare.toLocaleString() }}
          .PageUpcoming__card-footer
            span.PageUpcoming__card-id # {{ trip.id }}
            button.PageUpcoming__detail-btn(@click="navigateTo('/orders')") {{ $t('upcoming.detail') }}

    //- 過去行程
    template(v-if="pastTrips.length")
      .PageUpcoming__section-label.is-muted {{ $t('upcoming.section.past') }}
      .PageUpcoming__list.is-past
        .PageUpcoming__card.is-past(v-for="trip in pastTrips" :key="trip.id")
          .PageUpcoming__card-top
            .PageUpcoming__route
              span.PageUpcoming__route-code {{ trip.from }}
              .PageUpcoming__route-arrow
                .PageUpcoming__route-line
                NuxtIcon(name="mdi:airplane")
                .PageUpcoming__route-line
              span.PageUpcoming__route-code {{ trip.to }}
            span.PageUpcoming__status(:class="STATUS_CLS[trip.status]")
              | {{ $t('status.' + trip.status) }}
          .PageUpcoming__card-meta
            .PageUpcoming__meta-row
              .PageUpcoming__meta-item
                span.PageUpcoming__meta-label {{ $t('upcoming.meta.date') }}
                span.PageUpcoming__meta-val {{ trip.date }}
              .PageUpcoming__meta-item
                span.PageUpcoming__meta-label {{ $t('upcoming.meta.fare') }}
                span.PageUpcoming__meta-val NT$ {{ trip.estimatedFare.toLocaleString() }}

    //- 空狀態
    .PageUpcoming__empty(v-if="!filteredTrips.length")
      NuxtIcon.PageUpcoming__empty-icon(name="mdi:airplane-off")
      p.PageUpcoming__empty-text {{ $t('upcoming.empty.text') }}
      UiButton(type="primary" @click="navigateTo('/booking')") {{ $t('upcoming.empty.btn') }}

  //- 底部 CTA
  .PageUpcoming__cta(v-if="filteredTrips.length && !loading")
    UiButton(type="primary" style="width:100%" @click="navigateTo('/booking')")
      | {{ $t('upcoming.cta') }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageUpcoming {
  position: relative;
  min-height: 100vh;
  background: var(--da-cream);
  padding: 76px 16px 120px;
  overflow: hidden;
}

.PageUpcoming__watermark {
  position: fixed;
  top: 80px; right: -10px;
  font-family: $font-display;
  font-size: 100px;
  color: var(--da-dark);
  opacity: 0.04;
  pointer-events: none;
  user-select: none;
  letter-spacing: 0.04em;
}

// ── 頁首 ──────────────────────────────────────────────────
.PageUpcoming__header {
  margin-bottom: 24px;
}

.PageUpcoming__header-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  &::before {
    content: '';
    width: 20px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageUpcoming__header-title {
  font-family: $font-display;
  font-size: 48px;
  color: var(--da-dark);
  letter-spacing: 0.02em;
  line-height: 0.9;
}

.PageUpcoming__header-sub {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--da-gray-light);
  margin-top: 4px;
}

// ── 篩選 Tab ─────────────────────────────────────────────
.PageUpcoming__tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  margin-bottom: 24px;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

.PageUpcoming__tab {
  flex-shrink: 0;
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 7px 16px;
  border-radius: 100px;
  border: 1.5px solid var(--da-gray-pale);
  background: transparent;
  color: var(--da-gray);
  cursor: pointer;
  transition: all 0.2s;

  &.is-active {
    background: var(--da-dark);
    color: var(--da-cream);
    border-color: var(--da-dark);
  }
}

// ── Section Label ─────────────────────────────────────────
.PageUpcoming__section-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--da-amber);
  margin-bottom: 12px;
  margin-top: 4px;

  &.is-muted { color: var(--da-gray-light); margin-top: 28px; }
}

// ── 行程卡片 ──────────────────────────────────────────────
.PageUpcoming__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 8px;
}

.PageUpcoming__card {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 20px;
  padding: 18px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.05);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0;
    width: 4px; height: 100%;
    background: var(--da-amber);
    border-radius: 20px 0 0 20px;
  }

  &.is-past {
    opacity: 0.7;
    &::before { background: var(--da-gray-pale); }
  }
}

.PageUpcoming__card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.PageUpcoming__route {
  display: flex;
  align-items: center;
  gap: 8px;
}

.PageUpcoming__route-code {
  font-family: $font-display;
  font-size: 24px;
  letter-spacing: 0.04em;
  color: var(--da-dark);
  line-height: 1;
}

.PageUpcoming__route-arrow {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--da-amber);
  font-size: 14px;
}

.PageUpcoming__route-line {
  width: 18px; height: 1.5px;
  background: var(--da-amber);
}

// ── 狀態 Badge ────────────────────────────────────────────
.PageUpcoming__status {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 100px;

  &.is-pending   { background: rgba(26,24,20,0.06);  color: var(--da-dark);   border: 1px solid rgba(26,24,20,0.15); }
  &.is-confirmed { background: rgba(212,134,10,0.12); color: var(--da-amber);  border: 1px solid rgba(212,134,10,0.25); }
  &.is-progress  { background: rgba(27,79,138,0.1);  color: #1B4F8A;          border: 1px solid rgba(27,79,138,0.2); }
  &.is-done      { background: rgba(34,197,94,0.1);  color: #16a34a;          border: 1px solid rgba(34,197,94,0.2); }
  &.is-cancelled { background: rgba(239,68,68,0.08); color: #dc2626;          border: 1px solid rgba(239,68,68,0.15); }
}

// ── Card Meta ─────────────────────────────────────────────
.PageUpcoming__card-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageUpcoming__meta-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.PageUpcoming__meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.PageUpcoming__meta-label {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PageUpcoming__meta-val {
  font-family: $font-body;
  font-size: 13px;
  font-weight: 500;
  color: var(--da-dark);

  &.is-fare {
    font-family: $font-condensed;
    font-size: 15px;
    font-weight: 700;
    color: var(--da-amber);
  }
}

// ── Card Footer ───────────────────────────────────────────
.PageUpcoming__card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--da-glass-border);
}

.PageUpcoming__card-id {
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--da-gray-light);
  text-transform: uppercase;
}

.PageUpcoming__detail-btn {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--da-amber);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;

  &:hover { opacity: 0.7; }
}

// ── 空狀態 ────────────────────────────────────────────────
.PageUpcoming__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 16px;
  gap: 16px;
  text-align: center;
}

.PageUpcoming__empty-icon {
  font-size: 48px;
  color: var(--da-gray-pale);
}

.PageUpcoming__empty-text {
  font-family: $font-condensed;
  font-size: 14px;
  letter-spacing: 0.1em;
  color: var(--da-gray-light);
}

// ── 底部 CTA ─────────────────────────────────────────────
.PageUpcoming__cta {
  margin-top: 32px;
}

// ── Loading 骨架 ──────────────────────────────────────────
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}

.PageUpcoming__skeleton {
  height: 180px;
  border-radius: 20px;
  margin-bottom: 12px;
  background: linear-gradient(90deg, var(--da-glass-border) 25%, rgba(255,255,255,0.5) 50%, var(--da-glass-border) 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
}
</style>
