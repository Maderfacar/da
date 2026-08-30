<script setup lang="ts">
// PassengerFareBreakdownCard — 預估車資卡（可就地展開明細）
//
// 待辦③（口袋航廈第四版留尾）：第三步顯示車資，點卡片就地展開明細，不用等到第四步。
// 明細資料一律來自 server 回應（GetMapsRoute 的 fareBreakdown / routeMetrics；
// charter 則是 client 引擎算出的 CharterFareBreakdownV2）—— 卡片自己不重算任何金額。
//
// ⚠ 平面道路加成刻意不單列（2026-06-07 決策：乘客端不加平面加成解釋），
//   金額併進「里程」那一行（variableScaled + surfaceSurcharge）。
import type { CharterFareBreakdownV2, FareBreakdownV2, RouteMetrics } from '~shared/pricing';

interface Props {
  /** 顯示的預估車資（已套折扣時由呼叫端傳折後金額）；尚未估出為 null */
  fareTotal: number | null;
  loading?: boolean;
  /** 非 charter：server 回應的 fareBreakdown（有值才可展開） */
  breakdown?: FareBreakdownV2 | null;
  /** 非 charter：server 回應的 routeMetrics（供 km / 縣市數顯示） */
  metrics?: RouteMetrics | null;
  /** charter：client 引擎的完整明細（有值才可展開） */
  charterBreakdown?: CharterFareBreakdownV2 | null;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  breakdown: null,
  metrics: null,
  charterBreakdown: null,
});

const open = ref(false);

const hasDetail = computed(() => !!props.breakdown || !!props.charterBreakdown);

const ClickToggle = () => {
  if (!hasDetail.value) return;
  open.value = !open.value;
};

const fmtNtd = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtKm = (n: number): string => n.toFixed(1);

// 里程行金額：variableScaled（含山區係數）+ surfaceSurcharge（不單列，見檔頭）
const distanceLineAmount = computed(() => {
  if (!props.breakdown) return 0;
  return props.breakdown.variableScaled + props.breakdown.surfaceSurcharge;
});
</script>

<template lang="pug">
.PassengerFareBreakdownCard(:class="{ 'is-expandable': hasDetail, 'is-open': open }")
  button.PassengerFareBreakdownCard__head(
    type="button"
    :disabled="!hasDetail"
    :aria-expanded="hasDetail ? open : undefined"
    @click="ClickToggle"
  )
    span.PassengerFareBreakdownCard__label {{ $t('booking.fareBreakdown.title') }}
    .PassengerFareBreakdownCard__head-right
      NuxtIcon.PassengerFareBreakdownCard__spin(v-if="loading" name="mdi:loading")
      span.PassengerFareBreakdownCard__total(v-else)
        | NT$ {{ fareTotal !== null ? fareTotal.toLocaleString() : '—' }}
      NuxtIcon.PassengerFareBreakdownCard__chevron(v-if="hasDetail" name="mdi:chevron-down")

  //- ── 就地展開的明細 ─────────────────────────────────────────
  .PassengerFareBreakdownCard__detail(v-if="open && breakdown && !charterBreakdown")
    .PassengerFareBreakdownCard__line
      span {{ $t('booking.fareBreakdown.distanceFee', { km: fmtKm(metrics?.distanceKm ?? 0) }) }}
      span.u-data NT$ {{ fmtNtd(distanceLineAmount) }}
    .PassengerFareBreakdownCard__line.is-hint(v-if="breakdown.mountainMul > 1")
      span {{ $t('booking.fareBreakdown.mountainIncluded', { mul: breakdown.mountainMul }) }}
      span
    .PassengerFareBreakdownCard__line(v-if="breakdown.crossCountyFee > 0")
      span {{ $t('booking.fareBreakdown.crossCounty', { n: metrics?.countiesVisited?.length ?? 0 }) }}
      span.u-data +NT$ {{ fmtNtd(breakdown.crossCountyFee) }}
    .PassengerFareBreakdownCard__line(v-if="breakdown.freewayToll > 0")
      span {{ $t('booking.fareBreakdown.freewayToll', { km: fmtKm(metrics?.freewayKm ?? 0) }) }}
      span.u-data +NT$ {{ fmtNtd(breakdown.freewayToll) }}
    .PassengerFareBreakdownCard__line(v-if="breakdown.extrasSum > 0")
      span {{ $t('booking.fareBreakdown.extras') }}
      span.u-data +NT$ {{ fmtNtd(breakdown.extrasSum) }}
    .PassengerFareBreakdownCard__line(v-if="breakdown.surcharge > 0")
      span {{ $t('booking.fareBreakdown.timeSurcharge') }}
      span.u-data +NT$ {{ fmtNtd(breakdown.surcharge) }}
    .PassengerFareBreakdownCard__line(v-if="breakdown.promoDiscount > 0")
      span {{ $t('booking.fareBreakdown.promoDiscount') }}
      span.u-data −NT$ {{ fmtNtd(breakdown.promoDiscount) }}
    .PassengerFareBreakdownCard__line.is-total
      span {{ $t('booking.fareBreakdown.rounded', { round: breakdown.rounding }) }}
      span.u-data NT$ {{ fmtNtd(breakdown.final) }}

  //- charter：復用 confirm 的 charter 明細 key（daysBreakdown 表格留給第四步，這裡收層級）
  .PassengerFareBreakdownCard__detail(v-if="open && charterBreakdown")
    .PassengerFareBreakdownCard__line
      span {{ $t('booking.confirm.charterPlanSum') }}
      span.u-data NT$ {{ fmtNtd(charterBreakdown.planBasePriceSum) }}
    .PassengerFareBreakdownCard__line(v-if="charterBreakdown.extraKmCharge > 0")
      span {{ $t('booking.confirm.charterExtraKm') }}
      span.u-data +NT$ {{ fmtNtd(charterBreakdown.extraKmCharge) }}
    .PassengerFareBreakdownCard__line(v-if="charterBreakdown.mountainMul !== 1")
      span {{ $t('booking.confirm.charterMountain', { mul: charterBreakdown.mountainMul }) }}
      span.u-data NT$ {{ fmtNtd(charterBreakdown.mountainScaled) }}
    .PassengerFareBreakdownCard__line(v-if="charterBreakdown.roundTripFee > 0")
      span {{ $t('booking.confirm.charterRoundTrip') }}
      span.u-data +NT$ {{ fmtNtd(charterBreakdown.roundTripFee) }}
    .PassengerFareBreakdownCard__line(v-if="charterBreakdown.overnightFee > 0")
      span {{ $t('booking.confirm.charterOvernight') }}
      span.u-data +NT$ {{ fmtNtd(charterBreakdown.overnightFee) }}
    .PassengerFareBreakdownCard__line(v-if="charterBreakdown.extrasTotal > 0")
      span {{ $t('booking.confirm.charterExtras') }}
      span.u-data +NT$ {{ fmtNtd(charterBreakdown.extrasTotal) }}
    .PassengerFareBreakdownCard__line(v-if="charterBreakdown.surcharge > 0")
      span {{ $t('booking.confirm.charterSurcharge') }}
      span.u-data +NT$ {{ fmtNtd(charterBreakdown.surcharge) }}
    .PassengerFareBreakdownCard__line(v-if="charterBreakdown.promoDiscount > 0")
      span {{ $t('booking.confirm.charterPromo') }}
      span.u-data −NT$ {{ fmtNtd(charterBreakdown.promoDiscount) }}
    .PassengerFareBreakdownCard__line.is-total
      span {{ $t('booking.confirm.finalFare') }}
      span.u-data NT$ {{ fmtNtd(charterBreakdown.final) }}
</template>

<style lang="scss" scoped>
.PassengerFareBreakdownCard {
  background: var(--da-dark);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.PassengerFareBreakdownCard__head {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: transparent;
  border: none;
  cursor: default;
  text-align: left;

  .is-expandable & { cursor: pointer; }
}

.PassengerFareBreakdownCard__label {
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  color: var(--da-gray-light);
}

.PassengerFareBreakdownCard__head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.PassengerFareBreakdownCard__total {
  /* ⚠ 金額不換襯線（見規則三；提案的 .li.total b 亦為 --f-data）。
     大字保留 —— --fs-h1 就是「數字本身成了裝飾」該有的份量。 */
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h1);
  color: var(--da-amber-light);
  letter-spacing: var(--ls-label);
}

.PassengerFareBreakdownCard__chevron {
  font-size: var(--fs-h3);
  color: var(--da-gray-light);
  transition: transform var(--dur-base) var(--ease-out);

  .is-open & { transform: rotate(180deg); }
}

.PassengerFareBreakdownCard__spin {
  font-size: var(--fs-h2);
  color: var(--da-amber-light);
  animation: fare-breakdown-spin 0.8s linear infinite;
}

@keyframes fare-breakdown-spin {
  to { transform: rotate(360deg); }
}

// ── 明細（深色卡內：淡字 + 古銅金額）─────────────────────────
.PassengerFareBreakdownCard__detail {
  padding: 2px 20px 16px;
  border-top: 1px solid var(--surface-a12);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
}

.PassengerFareBreakdownCard__line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--da-gray-light);

  .u-data {
    font-variant-numeric: lining-nums tabular-nums;
    color: var(--da-cream);
  }

  &.is-hint {
    font-size: var(--fs-label);
    opacity: 0.75;
  }

  &.is-total {
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px dashed var(--surface-a20);
    color: var(--da-cream);

    .u-data { color: var(--da-amber-light); font-weight: 700; }
  }
}
</style>
