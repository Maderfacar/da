<script setup lang="ts">
import { ORDER_TYPES } from '~shared/pricing';
import type { OrderType } from '~shared/pricing';
import type { FlightInfo } from '@@/api/flight.get';

interface Props {
  orderType: OrderType | undefined;
  pickupDateTime: string;
  flightNo: string;
  flightInfo: FlightInfo | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:orderType', val: OrderType): void;
  (e: 'update:pickupDateTime', val: string): void;
  (e: 'update:flightNo', val: string): void;
  (e: 'update:flightInfo', val: FlightInfo | null): void;
  (e: 'next'): void;
}>();

const selectedType = ref<OrderType | undefined>(props.orderType);
const dateTime = ref(props.pickupDateTime ?? '');
const flightNoInput = ref(props.flightNo ?? '');

// 是否需要航班資訊
const needsFlight = computed(() =>
  selectedType.value === 'airport-pickup' || selectedType.value === 'airport-dropoff',
);

// ── 航班查詢 ──────────────────────────────────────────────────────────────────
const flightLoading = ref(false);
const flightError = ref('');
const localFlightInfo = ref<FlightInfo | null>(props.flightInfo);

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

const _LookupFlight = async (no: string) => {
  const cleaned = no.toUpperCase().replace(/\s/g, '');
  if (cleaned.length < 3) {
    localFlightInfo.value = null;
    flightError.value = '';
    emit('update:flightInfo', null);
    return;
  }
  flightLoading.value = true;
  flightError.value = '';
  try {
    const res = await $fetch<{ ok: boolean; data?: FlightInfo; message?: string }>(
      `/api/flight?flightNo=${cleaned}`,
    );
    if (res.ok && res.data) {
      // 送機：預計起飛時間必須 >= 現在 + 3 小時
      if (selectedType.value === 'airport-dropoff') {
        const minDeparture = $dayjs().add(3, 'hour');
        if ($dayjs(res.data.estimatedTime).isBefore(minDeparture)) {
          localFlightInfo.value = null;
          flightError.value = `航班 ${cleaned} 起飛時間不足 3 小時，無法受理送機`;
          emit('update:flightInfo', null);
          return;
        }
      }
      localFlightInfo.value = res.data;
      emit('update:flightInfo', res.data);
    } else {
      localFlightInfo.value = null;
      flightError.value = `找不到航班 ${cleaned}`;
      emit('update:flightInfo', null);
    }
  } catch {
    localFlightInfo.value = null;
    flightError.value = '查詢失敗，請稍後再試';
    emit('update:flightInfo', null);
  } finally {
    flightLoading.value = false;
  }
};

watch(flightNoInput, (val) => {
  emit('update:flightNo', val);
  if (_debounceTimer) clearTimeout(_debounceTimer);
  if (!val.trim()) {
    localFlightInfo.value = null;
    flightError.value = '';
    emit('update:flightInfo', null);
    return;
  }
  _debounceTimer = setTimeout(() => _LookupFlight(val), 600);
});

// 切換行程類型時清除航班資訊
watch(selectedType, (val) => {
  if (val) emit('update:orderType', val);
  if (val !== 'airport-pickup' && val !== 'airport-dropoff') {
    flightNoInput.value = '';
    localFlightInfo.value = null;
    flightError.value = '';
    emit('update:flightNo', '');
    emit('update:flightInfo', null);
  }
});

watch(dateTime, (val) => emit('update:pickupDateTime', val));

// ── 航班狀態標籤 ─────────────────────────────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  scheduled: { label: '準時',   cls: 'is-ok' },
  active:    { label: '起飛中', cls: 'is-ok' },
  landed:    { label: '已落地', cls: 'is-ok' },
  delayed:   { label: '誤點',   cls: 'is-warn' },
  cancelled: { label: '取消',   cls: 'is-error' },
};

const statusBadge = computed(() =>
  localFlightInfo.value ? (STATUS_MAP[localFlightInfo.value.status] ?? { label: '未知', cls: '' }) : null,
);

const formatTime = (iso: string) =>
  $dayjs(iso).format('HH:mm');

const minDate = computed(() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
});

const canNext = computed(() => {
  if (!selectedType.value || !dateTime.value) return false;
  if (needsFlight.value && !localFlightInfo.value) return false;
  return true;
});

const ClickNext = () => {
  if (!canNext.value) return;
  emit('next');
};
</script>

<template lang="pug">
.PassengerBookingStepType
  .PassengerBookingStepType__section-label ORDER TYPE
  h2.PassengerBookingStepType__title 選擇行程類型

  .PassengerBookingStepType__grid
    .PassengerBookingStepType__card(
      v-for="t in ORDER_TYPES"
      :key="t.value"
      :class="{ 'is-active': selectedType === t.value }"
      @click="selectedType = t.value"
    )
      NuxtIcon.PassengerBookingStepType__card-icon(:name="t.icon")
      span.PassengerBookingStepType__card-en {{ t.labelEn }}
      span.PassengerBookingStepType__card-zh {{ t.label }}

  //- 航班號碼輸入（接機 / 送機）
  Transition(name="flight-slide")
    .PassengerBookingStepType__flight(v-if="needsFlight")
      .PassengerBookingStepType__section-label.mt FLIGHT INFO
      h2.PassengerBookingStepType__title 輸入航班號碼

      .PassengerBookingStepType__flight-input-wrap
        input.PassengerBookingStepType__flight-input(
          v-model="flightNoInput"
          placeholder="例：CI102、BR12"
          maxlength="8"
          autocomplete="off"
          autocapitalize="characters"
        )
        .PassengerBookingStepType__flight-spinner(v-if="flightLoading")

      p.PassengerBookingStepType__flight-error(v-if="flightError") {{ flightError }}

      //- 航班資訊卡片
      Transition(name="card-pop")
        .PassengerBookingStepType__flight-card(v-if="localFlightInfo")
          .PassengerBookingStepType__flight-card-head
            .PassengerBookingStepType__flight-no {{ localFlightInfo.flightNo }}
            .PassengerBookingStepType__flight-airline {{ localFlightInfo.airline.name }}
            .PassengerBookingStepType__flight-badge(:class="statusBadge?.cls") {{ statusBadge?.label }}

          .PassengerBookingStepType__flight-card-body
            .PassengerBookingStepType__flight-row
              span.PassengerBookingStepType__flight-label 航廈
              span.PassengerBookingStepType__flight-val T{{ localFlightInfo.terminal }}
            .PassengerBookingStepType__flight-row
              span.PassengerBookingStepType__flight-label 預計時間
              span.PassengerBookingStepType__flight-val {{ formatTime(localFlightInfo.estimatedTime) }}
            .PassengerBookingStepType__flight-row(v-if="localFlightInfo.direction === 'arrival'")
              span.PassengerBookingStepType__flight-label 出發地
              span.PassengerBookingStepType__flight-val {{ localFlightInfo.origin.cityName }}（{{ localFlightInfo.origin.iataCode }}）
            .PassengerBookingStepType__flight-row(v-else)
              span.PassengerBookingStepType__flight-label 目的地
              span.PassengerBookingStepType__flight-val {{ localFlightInfo.destination.cityName }}（{{ localFlightInfo.destination.iataCode }}）

  .PassengerBookingStepType__section-label.mt DATE &amp; TIME
  h2.PassengerBookingStepType__title 用車日期與時間

  ElDatePicker.PassengerBookingStepType__picker(
    v-model="dateTime"
    type="datetime"
    placeholder="選擇日期與時間"
    format="YYYY/MM/DD HH:mm"
    value-format="YYYY-MM-DDTHH:mm:ss"
    :min="minDate"
    :minute-step="15"
    style="width: 100%"
  )

  UiButton(
    type="primary"
    :disabled="!canNext"
    @click="ClickNext"
    style="margin-top: 28px; width: 100%"
  ) 下一步 NEXT →
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PassengerBookingStepType {
  &__section-label {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--da-amber);
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;

    &::before { content: ''; width: 24px; height: 1.5px; background: var(--da-amber); }
    &.mt { margin-top: 28px; }
  }

  &__title {
    font-family: $font-display;
    font-size: 28px;
    color: var(--da-dark);
    margin-bottom: 20px;
    letter-spacing: 0.02em;
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  &__card {
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 16px;
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s, transform 0.15s;
    user-select: none;

    &:active { transform: scale(0.97); }
    &.is-active { border-color: var(--da-amber); background: var(--da-amber-pale); }
  }

  &__card-icon { font-size: 32px; color: var(--da-amber); }

  &__card-en {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--da-gray);
  }

  &__card-zh {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--da-dark);
  }

  // ── 航班區塊 ──────────────────────────────────────────────────
  &__flight { overflow: hidden; }

  &__flight-input-wrap {
    position: relative;
    margin-bottom: 8px;
  }

  &__flight-input {
    font-family: $font-condensed;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    width: 100%;
    padding: 12px 44px 12px 16px;
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 12px;
    background: var(--da-glass-bg);
    color: var(--da-dark);
    outline: none;
    transition: border-color 0.2s;
    box-sizing: border-box;

    &::placeholder { color: var(--da-gray); font-weight: 400; letter-spacing: 0.05em; }
    &:focus { border-color: var(--da-amber); }
  }

  &__flight-spinner {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    border: 2px solid rgba(212, 134, 10, 0.2);
    border-top-color: var(--da-amber);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  &__flight-error {
    font-family: $font-body;
    font-size: 12px;
    color: #e74c3c;
    margin: 0 0 8px;
  }

  // ── 航班資訊卡片 ──────────────────────────────────────────────
  &__flight-card {
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-amber);
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  &__flight-card-head {
    background: var(--da-amber-pale);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__flight-no {
    font-family: $font-display;
    font-size: 22px;
    color: var(--da-dark);
    letter-spacing: 0.05em;
  }

  &__flight-airline {
    font-family: $font-condensed;
    font-size: 12px;
    font-weight: 700;
    color: var(--da-gray);
    flex: 1;
  }

  &__flight-badge {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    padding: 3px 10px;
    border-radius: 100px;

    &.is-ok    { background: rgba(39, 174, 96, 0.12); color: #27ae60; border: 1px solid rgba(39, 174, 96, 0.3); }
    &.is-warn  { background: rgba(230, 126, 34, 0.12); color: #e67e22; border: 1px solid rgba(230, 126, 34, 0.3); }
    &.is-error { background: rgba(231, 76, 60, 0.12);  color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3); }
  }

  &__flight-card-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }

  &__flight-row { display: flex; justify-content: space-between; align-items: center; }

  &__flight-label {
    font-family: $font-condensed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--da-gray);
  }

  &__flight-val {
    font-family: $font-body;
    font-size: 14px;
    font-weight: 700;
    color: var(--da-dark);
  }
}

// ── Transitions ──────────────────────────────────────────────
.flight-slide-enter-active,
.flight-slide-leave-active { transition: all 0.3s ease; }
.flight-slide-enter-from,
.flight-slide-leave-to { opacity: 0; transform: translateY(-12px); }

.card-pop-enter-active  { transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
.card-pop-leave-active  { transition: all 0.2s ease; }
.card-pop-enter-from    { opacity: 0; transform: scale(0.92) translateY(8px); }
.card-pop-leave-to      { opacity: 0; transform: scale(0.96); }

@keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
</style>
