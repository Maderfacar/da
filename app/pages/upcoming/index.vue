<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

type TripStatus = 'pending' | 'confirmed' | 'in-progress' | 'completed' | 'cancelled';

interface TripItem {
  id: string;
  from: string;
  to: string;
  status: TripStatus;
  statusLabel: string;
  date: string;
  time: string;
  vehicle: string;
  passengerCount: number;
  estimatedFare: number;
  orderType: string;
}

const STATUS_TABS: Array<{ key: TripStatus | 'all'; label: string }> = [
  { key: 'all',         label: '全部' },
  { key: 'pending',     label: '待確認' },
  { key: 'confirmed',   label: '已確認' },
  { key: 'in-progress', label: '進行中' },
  { key: 'completed',   label: '已完成' },
];

const STATUS_CONFIG: Record<TripStatus, { label: string; cls: string }> = {
  pending:     { label: '待確認', cls: 'is-pending' },
  confirmed:   { label: '已確認', cls: 'is-confirmed' },
  'in-progress': { label: '進行中', cls: 'is-progress' },
  completed:   { label: '已完成', cls: 'is-done' },
  cancelled:   { label: '已取消', cls: 'is-cancelled' },
};

// Stage 5 接 Firestore；目前使用 mock 資料
const mockTrips: TripItem[] = [
  {
    id: 'A1B2C3D4',
    from: 'TPE', to: '台北市信義區',
    status: 'confirmed', statusLabel: '已確認',
    date: '2025.07.14', time: '14:30',
    vehicle: '休旅車 SUV', passengerCount: 3, estimatedFare: 1550,
    orderType: '接機',
  },
  {
    id: 'E5F6G7H8',
    from: '台北市大安區', to: 'TPE',
    status: 'pending', statusLabel: '待確認',
    date: '2025.07.18', time: '06:00',
    vehicle: '轎車 Sedan', passengerCount: 2, estimatedFare: 950,
    orderType: '送機',
  },
  {
    id: 'I9J0K1L2',
    from: 'TPE', to: '台中市西屯區',
    status: 'completed', statusLabel: '已完成',
    date: '2025.06.30', time: '10:00',
    vehicle: '豪華轎車 Premium', passengerCount: 2, estimatedFare: 3800,
    orderType: '接機',
  },
];

const activeTab = ref<TripStatus | 'all'>('all');

const filteredTrips = computed(() =>
  activeTab.value === 'all'
    ? mockTrips
    : mockTrips.filter((t) => t.status === activeTab.value)
);

const upcomingTrips = computed(() =>
  filteredTrips.value.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
);

const pastTrips = computed(() =>
  filteredTrips.value.filter((t) => t.status === 'completed' || t.status === 'cancelled')
);
</script>

<template lang="pug">
.PageUpcoming
  .PageUpcoming__watermark TRIPS

  //- 頁首
  .PageUpcoming__header
    .PageUpcoming__header-label DEPARTURE & ARRIVAL
    h1.PageUpcoming__header-title 我的行程
    p.PageUpcoming__header-sub MY JOURNEYS

  //- 狀態篩選 Tab
  .PageUpcoming__tabs
    button.PageUpcoming__tab(
      v-for="tab in STATUS_TABS"
      :key="tab.key"
      :class="{ 'is-active': activeTab === tab.key }"
      @click="activeTab = tab.key"
    ) {{ tab.label }}

  //- 即將出發
  template(v-if="upcomingTrips.length")
    .PageUpcoming__section-label 即將出發
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
          span.PageUpcoming__status(:class="STATUS_CONFIG[trip.status].cls")
            | {{ STATUS_CONFIG[trip.status].label }}
        .PageUpcoming__card-meta
          .PageUpcoming__meta-row
            .PageUpcoming__meta-item
              span.PageUpcoming__meta-label 行程類型
              span.PageUpcoming__meta-val {{ trip.orderType }}
            .PageUpcoming__meta-item
              span.PageUpcoming__meta-label 日期
              span.PageUpcoming__meta-val {{ trip.date }}
          .PageUpcoming__meta-row
            .PageUpcoming__meta-item
              span.PageUpcoming__meta-label 時間
              span.PageUpcoming__meta-val {{ trip.time }}
            .PageUpcoming__meta-item
              span.PageUpcoming__meta-label 車種
              span.PageUpcoming__meta-val {{ trip.vehicle }}
          .PageUpcoming__meta-row
            .PageUpcoming__meta-item
              span.PageUpcoming__meta-label 人數
              span.PageUpcoming__meta-val {{ trip.passengerCount }} 人
            .PageUpcoming__meta-item
              span.PageUpcoming__meta-label 預估車資
              span.PageUpcoming__meta-val.is-fare NT$ {{ trip.estimatedFare.toLocaleString() }}
        .PageUpcoming__card-footer
          span.PageUpcoming__card-id # {{ trip.id }}
          button.PageUpcoming__detail-btn 查看詳情

  //- 過去行程
  template(v-if="pastTrips.length")
    .PageUpcoming__section-label.is-muted 過去行程
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
          span.PageUpcoming__status(:class="STATUS_CONFIG[trip.status].cls")
            | {{ STATUS_CONFIG[trip.status].label }}
        .PageUpcoming__card-meta
          .PageUpcoming__meta-row
            .PageUpcoming__meta-item
              span.PageUpcoming__meta-label 日期
              span.PageUpcoming__meta-val {{ trip.date }}
            .PageUpcoming__meta-item
              span.PageUpcoming__meta-label 車資
              span.PageUpcoming__meta-val NT$ {{ trip.estimatedFare.toLocaleString() }}

  //- 空狀態
  .PageUpcoming__empty(v-if="!filteredTrips.length")
    NuxtIcon.PageUpcoming__empty-icon(name="mdi:airplane-off")
    p.PageUpcoming__empty-text 尚無符合的行程紀錄
    UiButton(type="primary" @click="navigateTo('/booking')") 立即預約

  //- 底部 CTA
  .PageUpcoming__cta(v-if="filteredTrips.length")
    UiButton(type="primary" style="width:100%" @click="navigateTo('/booking')")
      | ✈ 預約新行程
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
</style>
