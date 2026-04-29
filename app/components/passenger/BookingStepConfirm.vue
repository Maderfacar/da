<script setup lang="ts">
import { VEHICLE_CONFIGS, EXTRA_SERVICES, ORDER_TYPES } from '~shared/pricing';
import type { FlightInfo } from '@@/api/flight.get';

interface Props {
  draft: Partial<CreateOrderParams>;
  distanceKm: number;
  durationMinutes: number;
  estimatedFare: number;
  isLoading: boolean;
  flightInfo?: FlightInfo | null;
}

const props = defineProps<Props>();

const { t } = useI18n();
const emit = defineEmits<{ (e: 'submit' | 'back'): void }>();

const orderTypeLabel = computed(() =>
  ORDER_TYPES.find((t) => t.value === props.draft.orderType)?.label ?? '',
);

const vehicleLabel = computed(() =>
  props.draft.vehicleType ? VEHICLE_CONFIGS[props.draft.vehicleType]?.label : '',
);

const extraLabels = computed(() =>
  (props.draft.extraServices ?? [])
    .map((s) => t(`fleet.extras.${s}`))
    .join(t('booking.confirm.extrasSep')),
);

const formattedDateTime = computed(() => {
  if (!props.draft.pickupDateTime) return '';
  return $dayjs(props.draft.pickupDateTime).format('YYYY/MM/DD HH:mm');
});
</script>

<template lang="pug">
.PassengerBookingStepConfirm
  .PassengerBookingStepConfirm__section-label CONFIRM ORDER
  h2.PassengerBookingStepConfirm__title {{ $t('booking.confirm.title') }}

  .PassengerBookingStepConfirm__card
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.orderType') }}
      span.PassengerBookingStepConfirm__row-value {{ orderTypeLabel }}
    .PassengerBookingStepConfirm__row(v-if="flightInfo")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.flightNo') }}
      span.PassengerBookingStepConfirm__row-value {{ flightInfo.flightNo }} · T{{ flightInfo.terminal }}
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.pickupTime') }}
      span.PassengerBookingStepConfirm__row-value {{ formattedDateTime }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.pickup') }}
      span.PassengerBookingStepConfirm__row-value {{ draft.pickupLocation?.displayName ?? draft.pickupLocation?.address }}
    .PassengerBookingStepConfirm__row(v-if="draft.stopovers?.length")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.stopover') }}
      span.PassengerBookingStepConfirm__row-value {{ draft.stopovers.map(s => s.displayName ?? s.address).join(' → ') }}
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.dropoff') }}
      span.PassengerBookingStepConfirm__row-value {{ draft.dropoffLocation?.displayName ?? draft.dropoffLocation?.address }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.passengers') }}
      span.PassengerBookingStepConfirm__row-value {{ $t('booking.confirm.passengerUnit', { n: draft.passengerCount }) }}
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.luggage') }}
      span.PassengerBookingStepConfirm__row-value {{ $t('booking.confirm.luggageUnit', { n: draft.luggageCount }) }}
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.vehicle') }}
      span.PassengerBookingStepConfirm__row-value {{ vehicleLabel }}
    .PassengerBookingStepConfirm__row(v-if="extraLabels")
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.extras') }}
      span.PassengerBookingStepConfirm__row-value {{ extraLabels }}
    .PassengerBookingStepConfirm__divider
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.distance') }}
      span.PassengerBookingStepConfirm__row-value {{ distanceKm }} km
    .PassengerBookingStepConfirm__row
      span.PassengerBookingStepConfirm__row-label {{ $t('booking.confirm.durationLabel') }}
      span.PassengerBookingStepConfirm__row-value {{ $t('booking.confirm.durationVal', { min: durationMinutes }) }}

  .PassengerBookingStepConfirm__fare-box
    .PassengerBookingStepConfirm__fare-label
      span {{ $t('booking.confirm.fareLabel') }}
      span.PassengerBookingStepConfirm__fare-note {{ $t('booking.confirm.cashNote') }}
    .PassengerBookingStepConfirm__fare-amount NT$ {{ estimatedFare.toLocaleString() }}

  .PassengerBookingStepConfirm__notice
    NuxtIcon(name="mdi:information-outline")
    span {{ $t('booking.confirm.notice') }}

  .PassengerBookingStepConfirm__actions
    UiButton(type="secondary" :disabled="isLoading" @click="$emit('back')") {{ $t('booking.confirm.back') }}
    UiButton(type="primary" :loading="isLoading" @click="$emit('submit')") {{ $t('booking.confirm.submit') }}
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
