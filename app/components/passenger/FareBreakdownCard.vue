<script setup lang="ts">
import type { FareBreakdownV2, RouteMetrics } from '~shared/pricing';

interface Props {
  breakdown: FareBreakdownV2 | null;
  metrics: RouteMetrics | null;
  fareVersion: 'v1' | 'v2' | null;
  fareTotal: number | null;
  /** step 3 預設收合、step 4 預設展開 */
  defaultExpanded?: boolean;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  defaultExpanded: false,
  loading: false,
});

const { t } = useI18n();

const expanded = ref(props.defaultExpanded);
const ClickToggle = () => { expanded.value = !expanded.value; };

const fmt = (n: number) => Math.round(n).toLocaleString();

// 基本項：起跳費 / 里程 / 顛峰塞車
const itemRows = computed(() => {
  const b = props.breakdown;
  const m = props.metrics;
  if (!b) return [];
  const rows: { key: string; label: string; amount: number }[] = [
    { key: 'baseFare', label: t('booking.fareBreakdown.baseFare'), amount: b.baseFare },
    {
      key: 'distanceFee',
      label: t('booking.fareBreakdown.distanceFee', { km: (m?.distanceKm ?? 0).toFixed(1) }),
      amount: b.distanceFee,
    },
  ];
  if (b.jamFee > 0) {
    rows.push({
      key: 'jamFee',
      label: t('booking.fareBreakdown.jamFee', { min: Math.round(m?.pureJamMinutes ?? 0) }),
      amount: b.jamFee,
    });
  }
  return rows;
});

// 小計 = 起跳費 + (里程費 + 塞車費)
const subtotal = computed(() => {
  const b = props.breakdown;
  return b ? b.baseFare + b.variableSubtotal : 0;
});

// 加項：山區係數 / 跨縣市 / 國道 / 加值服務
const adjustRows = computed(() => {
  const b = props.breakdown;
  const m = props.metrics;
  if (!b) return [];
  const rows: { key: string; label: string; amount: number }[] = [];
  if (b.mountainMul !== 1) {
    rows.push({
      key: 'mountain',
      label: t('booking.fareBreakdown.mountainMul', { mul: b.mountainMul.toFixed(2) }),
      amount: b.variableScaled - b.variableSubtotal,
    });
  }
  if (b.crossCountyFee > 0) {
    const crossings = Math.max(0, (m?.countiesVisited?.length ?? 0) - 1);
    rows.push({
      key: 'crossCounty',
      label: t('booking.fareBreakdown.crossCounty', { n: crossings }),
      amount: b.crossCountyFee,
    });
  }
  if (b.freewayToll > 0) {
    rows.push({
      key: 'freewayToll',
      label: t('booking.fareBreakdown.freewayToll', { km: (m?.freewayKm ?? 0).toFixed(1) }),
      amount: b.freewayToll,
    });
  }
  if (b.extrasSum > 0) {
    rows.push({ key: 'extras', label: t('booking.fareBreakdown.extras'), amount: b.extrasSum });
  }
  return rows;
});

const hasDetail = computed(() => props.fareVersion === 'v2' && props.breakdown !== null);
</script>

<template lang="pug">
.PassengerFareBreakdownCard
  //- 頂部：標題 + 總額 +（v2）展開鈕
  .PassengerFareBreakdownCard__head(:class="{ 'is-clickable': hasDetail }" @click="hasDetail && ClickToggle()")
    .PassengerFareBreakdownCard__head-left
      span.PassengerFareBreakdownCard__label {{ $t('booking.fareBreakdown.title') }}
      span.PassengerFareBreakdownCard__simplified(v-if="fareVersion === 'v1'") {{ $t('booking.fareBreakdown.simplified') }}
    .PassengerFareBreakdownCard__head-right
      template(v-if="loading")
        NuxtIcon.PassengerFareBreakdownCard__spin(name="mdi:loading")
      template(v-else)
        span.PassengerFareBreakdownCard__total NT$ {{ fareTotal !== null ? fareTotal.toLocaleString() : '—' }}
        NuxtIcon.PassengerFareBreakdownCard__chevron(
          v-if="hasDetail"
          :class="{ 'is-open': expanded }"
          name="mdi:chevron-down"
        )

  //- 明細（v2 + 展開）
  Transition(name="detail-expand")
    .PassengerFareBreakdownCard__detail(v-if="hasDetail && expanded && breakdown")
      .PassengerFareBreakdownCard__row(v-for="row in itemRows" :key="row.key")
        span.PassengerFareBreakdownCard__row-label {{ row.label }}
        span.PassengerFareBreakdownCard__row-amount NT$ {{ fmt(row.amount) }}

      .PassengerFareBreakdownCard__rule

      .PassengerFareBreakdownCard__row.is-subtotal
        span.PassengerFareBreakdownCard__row-label {{ $t('booking.fareBreakdown.subtotal') }}
        span.PassengerFareBreakdownCard__row-amount NT$ {{ fmt(subtotal) }}

      .PassengerFareBreakdownCard__row.is-adjust(v-for="row in adjustRows" :key="row.key")
        span.PassengerFareBreakdownCard__row-label {{ row.label }}
        span.PassengerFareBreakdownCard__row-amount +NT$ {{ fmt(row.amount) }}

      .PassengerFareBreakdownCard__rule

      .PassengerFareBreakdownCard__row.is-total
        span.PassengerFareBreakdownCard__row-label {{ $t('booking.fareBreakdown.rounded', { round: breakdown.rounding }) }}
        span.PassengerFareBreakdownCard__row-amount NT$ {{ breakdown.final.toLocaleString() }}
</template>

<style lang="scss" scoped>
.PassengerFareBreakdownCard {
  background: var(--da-dark);
  border-radius: 16px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
}

.PassengerFareBreakdownCard__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.PassengerFareBreakdownCard__head.is-clickable {
  cursor: pointer;
}

.PassengerFareBreakdownCard__head-left {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.PassengerFareBreakdownCard__label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PassengerFareBreakdownCard__simplified {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: var(--da-amber-light);
  opacity: 0.8;
}

.PassengerFareBreakdownCard__head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.PassengerFareBreakdownCard__total {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 32px;
  color: var(--da-amber-light);
  letter-spacing: 0.05em;
}

.PassengerFareBreakdownCard__chevron {
  font-size: 22px;
  color: var(--da-gray-light);
  transition: transform 0.25s var(--da-ease, ease);
}

.PassengerFareBreakdownCard__chevron.is-open {
  transform: rotate(180deg);
}

.PassengerFareBreakdownCard__spin {
  font-size: 22px;
  color: var(--da-amber-light);
  animation: fare-breakdown-spin 0.8s linear infinite;
}

.PassengerFareBreakdownCard__detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
  overflow: hidden;
}

.PassengerFareBreakdownCard__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 13px;
}

.PassengerFareBreakdownCard__row-label {
  color: var(--da-gray-light);
}

.PassengerFareBreakdownCard__row-amount {
  color: #fff;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.PassengerFareBreakdownCard__row.is-subtotal {
  font-size: 14px;
}

.PassengerFareBreakdownCard__row.is-subtotal .PassengerFareBreakdownCard__row-label,
.PassengerFareBreakdownCard__row.is-subtotal .PassengerFareBreakdownCard__row-amount {
  color: #fff;
  font-weight: 600;
}

.PassengerFareBreakdownCard__row.is-adjust .PassengerFareBreakdownCard__row-label {
  color: var(--da-amber-light);
}

.PassengerFareBreakdownCard__row.is-adjust .PassengerFareBreakdownCard__row-amount {
  color: var(--da-amber-light);
}

.PassengerFareBreakdownCard__row.is-total {
  font-size: 15px;
}

.PassengerFareBreakdownCard__row.is-total .PassengerFareBreakdownCard__row-label {
  color: var(--da-gray-light);
  font-family: 'Barlow Condensed', sans-serif;
  letter-spacing: 0.05em;
}

.PassengerFareBreakdownCard__row.is-total .PassengerFareBreakdownCard__row-amount {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 26px;
  color: var(--da-amber-light);
  letter-spacing: 0.04em;
}

.PassengerFareBreakdownCard__rule {
  height: 1px;
  background: rgba(255, 255, 255, 0.12);
}

@keyframes fare-breakdown-spin {
  to { transform: rotate(360deg); }
}

.detail-expand-enter-active,
.detail-expand-leave-active {
  transition: opacity 0.2s ease, max-height 0.28s ease;
  max-height: 400px;
}

.detail-expand-enter-from,
.detail-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
