<script setup lang="ts">
// 乘客端 /fare 試算機（沙盒風格，2026-06-07 改版）
//
// 流程：UiGooglePlaceInput × 3（上車 / 中途停靠站 / 下車）+ 車型 + 時間 + orderType + 加值服務
// 走 booking 同一個 /api/maps/route endpoint（vehicleType + pickupTime + extras + orderType → 回 fareBreakdown）
//
// 結果只顯示 5 項：
//   1. 最終車資（不顯示「進位 50 元」字樣）
//   2. 總距離（公里，小數 1 位）
//   3. 國道里程（公里，小數 1 位）
//   4. 加值服務（元）
//   5. 夜間加乘（時段加價，元）
//   6. 山區命中綠勾（若 mountainMul > 1）

import { ORDER_TYPES, type OrderType } from '~shared/pricing';
import type { GooglePlace, MapsRouteRes } from '@/protocol/fetch-api/api/maps';

type Lang = 'zh' | 'en' | 'ja';

const storeConfig = StoreConfig();
const { locale, t } = useI18n();

const _normalizeLang = (l: string): Lang => {
  if (l === 'en') return 'en';
  if (l === 'ja') return 'ja';
  return 'zh';
};
const lang = computed<Lang>(() => _normalizeLang(String(locale.value)));

// ── 試算輸入 ──────────────────────────────────────────────────────────
const pickup = ref<GooglePlace | null>(null);
const dropoff = ref<GooglePlace | null>(null);
const stopovers = ref<GooglePlace[]>([]);
const vehicleId = ref('');
const pickupDate = ref(_todayDate());
const pickupTime = ref(_nextTenMinSlot());
const orderType = ref<OrderType>('airport-pickup');
const extraIds = ref<string[]>([]);

const result = ref<MapsRouteRes | null>(null);
const error = ref('');
const calcing = ref(false);

/** 今日 YYYY-MM-DD */
function _todayDate(): string {
  return $dayjs().format('YYYY-MM-DD');
}
/** 下一個 10 分鐘整點 HH:mm */
function _nextTenMinSlot(): string {
  const now = $dayjs().second(0).millisecond(0);
  return now.minute(Math.ceil(now.minute() / 10) * 10).format('HH:mm');
}

// 車型載入後若 vehicleId 仍為空 → 補預設首選
watch(
  () => storeConfig.EnabledVehicles,
  (list) => {
    if (!vehicleId.value && list.length > 0) vehicleId.value = list[0].id;
  },
  { immediate: true },
);

// ── 中途停靠站操作 ────────────────────────────────────────────────────
const ClickAddStopover = () => {
  stopovers.value = [...stopovers.value, { name: '', lat: 0, lng: 0, placeId: '' } as GooglePlace];
};
const ClickRemoveStopover = (idx: number) => {
  stopovers.value = stopovers.value.filter((_, i) => i !== idx);
};
const UpdateStopover = (idx: number, val: GooglePlace | null) => {
  if (!val) {
    ClickRemoveStopover(idx);
    return;
  }
  const next = [...stopovers.value];
  next[idx] = val;
  stopovers.value = next;
};

// ── 試算 ──────────────────────────────────────────────────────────────
const ClickCalculate = async () => {
  error.value = '';
  if (!pickup.value || pickup.value.lat === 0) {
    error.value = t('fare.calc.error.pickupLocation');
    return;
  }
  if (!dropoff.value || dropoff.value.lat === 0) {
    error.value = t('fare.calc.error.dropoffLocation');
    return;
  }
  if (!vehicleId.value) {
    error.value = t('fare.calc.error.vehicle');
    return;
  }
  if (!pickupDate.value || !pickupTime.value) {
    error.value = t('fare.calc.error.pickup');
    return;
  }

  const validWps = stopovers.value.filter((s) => s.lat !== 0);
  const pickupIso = `${pickupDate.value}T${pickupTime.value}:00`;
  const d = new Date(pickupIso);
  if (Number.isNaN(d.getTime())) {
    error.value = t('fare.calc.error.pickup');
    return;
  }

  calcing.value = true;
  try {
    const res = await $api.GetMapsRoute({
      origin: `${pickup.value.lat},${pickup.value.lng}`,
      destination: `${dropoff.value.lat},${dropoff.value.lng}`,
      ...(validWps.length ? { waypoints: validWps.map((s) => `${s.lat},${s.lng}`).join('|') } : {}),
      vehicleType: vehicleId.value,
      pickupTime: d.toISOString(),
      ...(extraIds.value.length ? { extras: extraIds.value.join(',') } : {}),
      orderType: orderType.value,
    });
    if (res.status?.code !== $enum.apiStatus.success || !res.data) {
      error.value = res.status?.message?.zh_tw ?? t('fare.calc.error.fetch');
      result.value = null;
      return;
    }
    result.value = res.data;
  } catch {
    error.value = t('fare.calc.error.fetch');
    result.value = null;
  } finally {
    calcing.value = false;
  }
};

const ClickReset = () => {
  pickup.value = null;
  dropoff.value = null;
  stopovers.value = [];
  pickupDate.value = _todayDate();
  pickupTime.value = _nextTenMinSlot();
  orderType.value = 'airport-pickup';
  extraIds.value = [];
  result.value = null;
  error.value = '';
};

// ── 結果欄位（精簡 5 項）─────────────────────────────────────────────
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtKm = (n: number): string => n.toFixed(1);

const finalFare = computed<number | null>(() => {
  if (!result.value) return null;
  return result.value.fareTotal ?? null;
});
const distanceKm = computed<number>(() => {
  if (!result.value) return 0;
  return result.value.routeMetrics?.distanceKm ?? result.value.distance_km ?? 0;
});
const freewayKm = computed<number>(() => {
  if (!result.value) return 0;
  return result.value.routeMetrics?.freewayKm ?? 0;
});
const extrasSum = computed<number>(() => {
  if (!result.value?.fareBreakdown) return 0;
  return result.value.fareBreakdown.extrasSum ?? 0;
});
const nightSurcharge = computed<number>(() => {
  if (!result.value?.fareBreakdown) return 0;
  return result.value.fareBreakdown.surcharge ?? 0;
});
const mountainHit = computed<boolean>(() => {
  if (!result.value?.fareBreakdown) return false;
  return (result.value.fareBreakdown.mountainMul ?? 1) > 1;
});
</script>

<template lang="pug">
.PassengerFareEstimator
  //- ── 行程輸入 ────────────────────────────────────────────────
  .PassengerFareEstimator__inputs
    //- 上車
    UiGooglePlaceInput(
      v-model="pickup"
      :label="$t('fare.calc.field.pickupLocation')"
      :placeholder="$t('fare.calc.field.pickupLocationPlaceholder')"
    )

    //- 中途停靠站（上下車中間）
    .PassengerFareEstimator__stopovers(v-if="stopovers.length")
      .PassengerFareEstimator__stopover(v-for="(_, idx) in stopovers" :key="idx")
        UiGooglePlaceInput.PassengerFareEstimator__stopover-input(
          :model-value="stopovers[idx] && stopovers[idx].lat !== 0 ? stopovers[idx] : null"
          :label="$t('fare.calc.field.stopover', { n: idx + 1 })"
          :placeholder="$t('fare.calc.field.stopoverPlaceholder')"
          @update:model-value="(v: GooglePlace | null) => UpdateStopover(idx, v)"
        )
        button.PassengerFareEstimator__remove-btn(
          type="button"
          @click="ClickRemoveStopover(idx)"
          :aria-label="$t('fare.calc.field.removeStopover')"
        )
          NuxtIcon(name="mdi:close-circle-outline")

    button.PassengerFareEstimator__add-btn(type="button" @click="ClickAddStopover")
      NuxtIcon(name="mdi:plus-circle-outline")
      span {{ $t('fare.calc.field.addStopover') }}

    //- 下車
    UiGooglePlaceInput(
      v-model="dropoff"
      :label="$t('fare.calc.field.dropoffLocation')"
      :placeholder="$t('fare.calc.field.dropoffLocationPlaceholder')"
    )

  //- ── 選項 ─────────────────────────────────────────────────────
  .PassengerFareEstimator__grid
    .PassengerFareEstimator__field
      label.PassengerFareEstimator__field-label {{ $t('fare.calc.field.vehicle') }}
      ElSelect(
        v-model="vehicleId"
        :placeholder="$t('fare.calc.field.vehicle')"
      )
        ElOption(
          v-for="v in storeConfig.EnabledVehicles"
          :key="v.id"
          :label="storeConfig.LabelOf(v.label, lang)"
          :value="v.id"
        )

    .PassengerFareEstimator__field
      label.PassengerFareEstimator__field-label {{ $t('fare.calc.field.orderType') }}
      ElSelect(v-model="orderType")
        ElOption(
          v-for="o in ORDER_TYPES.filter((o) => o.value !== 'charter')"
          :key="o.value"
          :label="$t(`orderType.${o.value}`)"
          :value="o.value"
        )

    .PassengerFareEstimator__field.is-wide
      label.PassengerFareEstimator__field-label {{ $t('fare.calc.field.pickup') }}
      .PassengerFareEstimator__datetime
        ElDatePicker.PassengerFareEstimator__date(
          v-model="pickupDate"
          type="date"
          format="YYYY/MM/DD"
          value-format="YYYY-MM-DD"
          :clearable="false"
        )
        ElTimeSelect.PassengerFareEstimator__time(
          v-model="pickupTime"
          start="00:00"
          end="23:50"
          step="00:10"
          :clearable="false"
        )

    .PassengerFareEstimator__field.is-wide
      label.PassengerFareEstimator__field-label {{ $t('fare.calc.field.extras') }}
      ElSelect(
        v-model="extraIds"
        multiple
        clearable
        value-on-clear=""
        :placeholder="$t('fare.calc.field.extras')"
      )
        ElOption(
          v-for="e in storeConfig.EnabledExtras"
          :key="e.id"
          :label="`${storeConfig.LabelOf(e.label, lang)}（NT$ ${e.price}）`"
          :value="e.id"
        )

  //- ── 動作 ─────────────────────────────────────────────────────
  .PassengerFareEstimator__actions
    button.PassengerFareEstimator__btn.is-secondary(type="button" @click="ClickReset")
      | {{ $t('fare.calc.btn.reset') }}
    button.PassengerFareEstimator__btn.is-primary(
      type="button"
      :disabled="calcing"
      @click="ClickCalculate"
    )
      NuxtIcon.spin(v-if="calcing" name="mdi:loading")
      span(v-else) {{ $t('fare.calc.btn.calculate') }}

  //- ── 錯誤 ─────────────────────────────────────────────────────
  .PassengerFareEstimator__error(v-if="error") ⚠ {{ error }}

  //- ── 結果（5 項精簡）────────────────────────────────────────
  .PassengerFareEstimator__result(v-if="finalFare !== null")
    //- 1. 最終車資（無「進位 50 元」字樣）
    .PassengerFareEstimator__final
      span.PassengerFareEstimator__final-label {{ $t('fare.calc.result.finalNoRounding') }}
      span.PassengerFareEstimator__final-val NT$ {{ fmt(finalFare) }}

    //- 明細：distanceKm / freewayKm / extras / 夜間加乘 / 山區命中
    .PassengerFareEstimator__lines
      .PassengerFareEstimator__line
        span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.distanceLabel') }}
        span.PassengerFareEstimator__line-val {{ fmtKm(distanceKm) }} {{ $t('fare.calc.result.kmUnit') }}
      .PassengerFareEstimator__line
        span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.freewayLabel') }}
        span.PassengerFareEstimator__line-val {{ fmtKm(freewayKm) }} {{ $t('fare.calc.result.kmUnit') }}
      .PassengerFareEstimator__line(v-if="extrasSum > 0")
        span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.extrasLabel') }}
        span.PassengerFareEstimator__line-val +NT$ {{ fmt(extrasSum) }}
      .PassengerFareEstimator__line(v-if="nightSurcharge > 0")
        span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.nightSurcharge') }}
        span.PassengerFareEstimator__line-val +NT$ {{ fmt(nightSurcharge) }}
      .PassengerFareEstimator__line(v-if="mountainHit")
        span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.mountainHit') }}
        span.PassengerFareEstimator__line-val.is-check
          NuxtIcon(name="mdi:check-circle")

  //- ── Disclaimer ──────────────────────────────────────────────
  p.PassengerFareEstimator__disclaimer {{ $t('fare.calc.disclaimer') }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PassengerFareEstimator {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 18px;
  padding: 22px;
  box-shadow: var(--da-glass-shadow);
}

// ── 行程輸入 ────────────────────────────────────────────────
.PassengerFareEstimator__inputs {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 18px;
}

.PassengerFareEstimator__stopovers {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PassengerFareEstimator__stopover {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.PassengerFareEstimator__stopover-input {
  flex: 1;
  min-width: 0;
}

.PassengerFareEstimator__remove-btn {
  flex-shrink: 0;
  margin-top: 18px;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--da-gray);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;

  &:hover { color: var(--da-dark); }
}

.PassengerFareEstimator__add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px dashed var(--da-gray-pale);
  background: transparent;
  border-radius: 100px;
  padding: 8px 16px;
  color: var(--da-dark);
  cursor: pointer;
  font-family: $font-body;
  font-size: 13px;
  align-self: flex-start;
  transition: all 0.15s;

  &:hover {
    background: var(--da-off-white);
    border-color: var(--da-gray);
  }
}

// ── 選項區 ──────────────────────────────────────────────────
.PassengerFareEstimator__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}

@media (max-width: 479.98px) {
  .PassengerFareEstimator__grid { grid-template-columns: 1fr; }
}

.PassengerFareEstimator__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PassengerFareEstimator__field.is-wide {
  grid-column: 1 / -1;
}

.PassengerFareEstimator__datetime {
  display: flex;
  gap: 10px;
}

.PassengerFareEstimator__date,
.PassengerFareEstimator__time {
  flex: 1;
  min-width: 0;
}

.PassengerFareEstimator__field-label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--da-gray);
}

// ── 動作 ────────────────────────────────────────────────────
.PassengerFareEstimator__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: 12px;
}

.PassengerFareEstimator__btn {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 10px 22px;
  border-radius: 100px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: var(--da-dark);
    color: var(--da-white);
    border-color: var(--da-dark);

    &:hover:not(:disabled) { background: var(--da-amber-light, #d4860a); border-color: var(--da-amber-light, #d4860a); }
  }

  &.is-secondary {
    background: transparent;
    color: var(--da-dark);
    border-color: var(--da-gray-pale);

    &:hover:not(:disabled) { background: var(--da-off-white); }
  }

  .spin { animation: PassengerFareEstimator-spin 0.8s linear infinite; font-size: 16px; }
}

@keyframes PassengerFareEstimator-spin {
  to { transform: rotate(360deg); }
}

// ── 錯誤 ────────────────────────────────────────────────────
.PassengerFareEstimator__error {
  margin: 8px 0 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(220, 70, 70, 0.1);
  border: 1px solid rgba(220, 70, 70, 0.3);
  color: #c0392b;
  font-family: $font-body;
  font-size: 13px;
}

// ── 結果 ────────────────────────────────────────────────────
.PassengerFareEstimator__result {
  margin-top: 6px;
  padding-top: 18px;
  border-top: 1px solid var(--da-gray-pale);
}

.PassengerFareEstimator__final {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}

.PassengerFareEstimator__final-label {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--da-gray);
}

.PassengerFareEstimator__final-val {
  font-family: $font-display;
  font-size: 36px;
  letter-spacing: 0.04em;
  color: var(--da-amber-light, #d4860a);
}

.PassengerFareEstimator__lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.PassengerFareEstimator__line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: $font-body;
  font-size: 14px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--da-gray-pale);

  &:last-child { border-bottom: none; }
}

.PassengerFareEstimator__line-key {
  color: var(--da-dark);
}

.PassengerFareEstimator__line-val {
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;

  &.is-check {
    display: inline-flex;
    align-items: center;
    color: #2ecc71;
    font-size: 22px;
  }
}

// ── Disclaimer ──────────────────────────────────────────────
.PassengerFareEstimator__disclaimer {
  margin: 18px 0 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.03);
  color: var(--da-gray);
  font-family: $font-body;
  font-size: 12px;
  line-height: 1.6;
}
</style>
