<script setup lang="ts">
import { VEHICLE_CONFIGS, EXTRA_SERVICES, ORDER_TYPES } from '~shared/pricing';

interface Props {
  draft: Partial<CreateOrderParams>;
  distanceKm: number;
  durationMinutes: number;
  estimatedFare: number;
  isLoading: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'submit' | 'back'): void }>();

const orderTypeLabel = computed(() =>
  ORDER_TYPES.find((t) => t.value === props.draft.orderType)?.label ?? '',
);

const vehicleLabel = computed(() =>
  props.draft.vehicleType ? VEHICLE_CONFIGS[props.draft.vehicleType]?.label : '',
);

const extraLabels = computed(() =>
  (props.draft.extraServices ?? [])
    .map((s) => EXTRA_SERVICES.find((e) => e.value === s)?.label ?? s)
    .join('、'),
);

const formattedDateTime = computed(() => {
  if (!props.draft.pickupDateTime) return '';
  return $dayjs(props.draft.pickupDateTime).format('YYYY/MM/DD HH:mm');
});
</script>

<template lang="pug">
.PassengerBookingStepConfirm
  .PassengerBookingStepConfirm__section-label CONFIRM ORDER
  h2.PassengerBookingStepConfirm__title 確認訂單資訊

  .PassengerBookingStepConfirm__card
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 行程類型
      span.PassengerBookingStepConfirm__row-value {{ orderTypeLabel }}
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 用車時間
      span.PassengerBookingStepConfirm__row-value {{ formattedDateTime }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 上車地點
      span.PassengerBookingStepConfirm__row-value {{ draft.pickupLocation?.displayName ?? draft.pickupLocation?.address }}
    .PassengerBookingStepConfirm__row(v-if="draft.stopovers?.length")
      span.PassengerBookingStepConfirm__row-label 停靠站
      span.PassengerBookingStepConfirm__row-value {{ draft.stopovers.map(s => s.displayName ?? s.address).join(' → ') }}
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 下車地點
      span.PassengerBookingStepConfirm__row-value {{ draft.dropoffLocation?.displayName ?? draft.dropoffLocation?.address }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 乘客人數
      span.PassengerBookingStepConfirm__row-value {{ draft.passengerCount }} 人
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 行李數量
      span.PassengerBookingStepConfirm__row-value {{ draft.luggageCount }} 件
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 車種
      span.PassengerBookingStepConfirm__row-value {{ vehicleLabel }}
    .PassengerBookingStepConfirm__row(v-if="extraLabels")
      span.PassengerBookingStepConfirm__row-label 額外服務
      span.PassengerBookingStepConfirm__row-value {{ extraLabels }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 行駛距離
      span.PassengerBookingStepConfirm__row-value {{ distanceKm }} km
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label 預估時間
      span.PassengerBookingStepConfirm__row-value 約 {{ durationMinutes }} 分鐘

  .PassengerBookingStepConfirm__fare-box
    .PassengerBookingStepConfirm__fare-label
      span 預估車資
      span.PassengerBookingStepConfirm__fare-note 現金支付
    .PassengerBookingStepConfirm__fare-amount NT$ {{ estimatedFare.toLocaleString() }}

  .PassengerBookingStepConfirm__notice
    NuxtIcon(name="mdi:information-outline")
    span 實際車資可能依行程調整，以現場為準。

  .PassengerBookingStepConfirm__actions
    UiButton(type="secondary" :disabled="isLoading" @click="$emit('back')") ← 上一步
    UiButton(type="primary" :loading="isLoading" @click="$emit('submit')") 確認送出訂單
</template>

<style lang="scss" scoped>
.PassengerBookingStepConfirm {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__section-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--da-amber);
    display: flex;
    align-items: center;
    gap: 10px;

    &::before {
      content: '';
      width: 24px;
      height: 1.5px;
      background: var(--da-amber);
    }
  }

  &__title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    color: var(--da-dark);
    letter-spacing: 0.02em;
    margin-top: -8px;
  }

  &__card {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-glass-border);
    border-radius: 16px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    backdrop-filter: blur(12px);
  }

  &__row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-family: 'Barlow', 'Noto Sans TC', sans-serif;
    font-size: 14px;
  }

  &__row-label {
    color: var(--da-gray);
    flex-shrink: 0;
    min-width: 72px;
  }

  &__row-value {
    color: var(--da-dark);
    font-weight: 500;
    text-align: right;
  }

  &__divider {
    height: 1px;
    background: var(--da-gray-pale);
  }

  &__fare-box {
    background: var(--da-dark);
    border-radius: 16px;
    padding: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  &__fare-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--da-gray-light);
  }

  &__fare-note {
    font-size: 11px;
    color: var(--da-gray);
    letter-spacing: 0.05em;
  }

  &__fare-amount {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 36px;
    color: var(--da-amber-light);
    letter-spacing: 0.05em;
  }

  &__notice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 12px;
    color: var(--da-gray);
    font-family: 'Noto Sans TC', sans-serif;
    line-height: 1.6;

    .nuxt-icon { flex-shrink: 0; margin-top: 1px; color: var(--da-gray-light); }
  }

  &__actions {
    display: flex;
    gap: 12px;
  }
}
</style>
