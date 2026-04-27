<script setup lang="ts">
import { VEHICLE_CONFIGS, EXTRA_SERVICES, calculateFare } from '~shared/pricing';
import type { VehicleType, ExtraService } from '~shared/pricing';

interface Props {
  passengerCount: number;
  luggageCount: number;
  vehicleType: VehicleType;
  extraServices: ExtraService[];
  distanceKm: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:passengerCount' | 'update:luggageCount' | 'fareCalc', val: number): void;
  (e: 'update:vehicleType', val: VehicleType): void;
  (e: 'update:extraServices', val: ExtraService[]): void;
  (e: 'next' | 'back'): void;
}>();

const passengers = ref(props.passengerCount);
const luggage = ref(props.luggageCount);
const vehicle = ref<VehicleType>(props.vehicleType);
const extras = ref<ExtraService[]>([...props.extraServices]);

const vehicles = computed(() => Object.values(VEHICLE_CONFIGS));

const fare = computed(() => calculateFare(vehicle.value, props.distanceKm || 25, extras.value));

watch(fare, (val) => emit('fareCalc', val), { immediate: true });
watch(passengers, (val) => emit('update:passengerCount', val));
watch(luggage, (val) => emit('update:luggageCount', val));
watch(vehicle, (val) => emit('update:vehicleType', val));
watch(extras, (val) => emit('update:extraServices', val), { deep: true });

const ClickVehicle = (type: VehicleType) => {
  vehicle.value = type;
};

const ToggleExtra = (val: ExtraService) => {
  const idx = extras.value.indexOf(val);
  if (idx === -1) extras.value.push(val);
  else extras.value.splice(idx, 1);
};

const isExtraSelected = (val: ExtraService) => extras.value.includes(val);

// 若乘客人數超出車種容量，自動切回合適車種
watch([passengers, vehicle], ([p, v]) => {
  if (p > VEHICLE_CONFIGS[v].capacity) {
    const suitable = vehicles.value.find((cfg) => cfg.capacity >= p);
    if (suitable) vehicle.value = suitable.type;
  }
});
</script>

<template lang="pug">
.PassengerBookingStepOptions
  .PassengerBookingStepOptions__section-label PASSENGERS
  h2.PassengerBookingStepOptions__title 乘車需求

  //- 人數行李
  .PassengerBookingStepOptions__counters
    .PassengerBookingStepOptions__counter
      span.PassengerBookingStepOptions__counter-label 乘客人數
      .PassengerBookingStepOptions__counter-ctrl
        button(@click="passengers = Math.max(1, passengers - 1)") −
        span {{ passengers }}
        button(@click="passengers = Math.min(8, passengers + 1)") +
    .PassengerBookingStepOptions__counter
      span.PassengerBookingStepOptions__counter-label 行李數量
      .PassengerBookingStepOptions__counter-ctrl
        button(@click="luggage = Math.max(0, luggage - 1)") −
        span {{ luggage }}
        button(@click="luggage = Math.min(8, luggage + 1)") +

  .PassengerBookingStepOptions__section-label.mt VEHICLE
  h2.PassengerBookingStepOptions__title 選擇車種

  .PassengerBookingStepOptions__vehicles
    .PassengerBookingStepOptions__vehicle-card(
      v-for="cfg in vehicles"
      :key="cfg.type"
      :class="{ 'is-active': vehicle === cfg.type, 'is-disabled': passengers > cfg.capacity }"
      @click="passengers <= cfg.capacity && ClickVehicle(cfg.type)"
    )
      .PassengerBookingStepOptions__vehicle-name {{ cfg.label }}
      .PassengerBookingStepOptions__vehicle-sub {{ cfg.labelEn }}
      .PassengerBookingStepOptions__vehicle-specs
        span
          NuxtIcon(name="mdi:account-group")
          | {{ cfg.capacity }}人
        span
          NuxtIcon(name="mdi:bag-suitcase")
          | {{ cfg.luggageCapacity }}件
      .PassengerBookingStepOptions__vehicle-fare
        | 起跳 NT${{ cfg.baseFare }}
        span + NT${{ cfg.perKmRate }}/km

  .PassengerBookingStepOptions__section-label.mt EXTRAS
  h2.PassengerBookingStepOptions__title 額外服務

  .PassengerBookingStepOptions__extras
    .PassengerBookingStepOptions__extra-card(
      v-for="svc in EXTRA_SERVICES"
      :key="svc.value"
      :class="{ 'is-active': isExtraSelected(svc.value) }"
      @click="ToggleExtra(svc.value)"
    )
      NuxtIcon(:name="svc.icon")
      span {{ svc.label }}
      span.PassengerBookingStepOptions__extra-price +NT$200

  .PassengerBookingStepOptions__fare-preview
    span.PassengerBookingStepOptions__fare-label 預估車資
    span.PassengerBookingStepOptions__fare-value NT$ {{ fare.toLocaleString() }}

  .PassengerBookingStepOptions__actions
    UiButton(type="secondary" @click="$emit('back')") ← 上一步
    UiButton(type="primary" @click="$emit('next')") 下一步 NEXT →
</template>

<style lang="scss" scoped>
.PassengerBookingStepOptions {
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

    &.mt { margin-top: 12px; }
  }

  &__title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    color: var(--da-dark);
    letter-spacing: 0.02em;
    margin-top: -8px;
  }

  &__counters {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  &__counter {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-gray-pale);
    border-radius: 14px;
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }

  &__counter-label {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 13px;
    color: var(--da-gray);
  }

  &__counter-ctrl {
    display: flex;
    align-items: center;
    gap: 16px;

    button {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1.5px solid var(--da-amber);
      background: none;
      color: var(--da-amber);
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover { background: var(--da-amber-pale); }
    }

    span {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 28px;
      color: var(--da-dark);
      min-width: 24px;
      text-align: center;
    }
  }

  &__vehicles {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__vehicle-card {
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 14px;
    padding: 14px 16px;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    gap: 4px 12px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;

    &.is-active {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);
    }

    &.is-disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__vehicle-name {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--da-dark);
    grid-column: 1;
    grid-row: 1;
  }

  &__vehicle-sub {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 0.1em;
    color: var(--da-gray);
    grid-column: 1;
    grid-row: 2;
  }

  &__vehicle-specs {
    display: flex;
    gap: 10px;
    font-size: 13px;
    color: var(--da-gray);
    grid-column: 2;
    grid-row: 1 / 3;
    align-items: center;

    span {
      display: flex;
      align-items: center;
      gap: 3px;
    }
  }

  &__vehicle-fare {
    font-size: 13px;
    color: var(--da-gray);
    grid-column: 1 / 3;
    display: flex;
    gap: 6px;
    align-items: center;
    font-family: 'Barlow', sans-serif;

    span { color: var(--da-amber); font-size: 12px; }
  }

  &__extras {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  &__extra-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 10px;
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 14px;
    cursor: pointer;
    font-size: 13px;
    color: var(--da-dark);
    text-align: center;
    transition: border-color 0.2s, background 0.2s;
    font-family: 'Noto Sans TC', sans-serif;

    .nuxt-icon { font-size: 24px; color: var(--da-gray-light); }

    &.is-active {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);

      .nuxt-icon { color: var(--da-amber); }
    }
  }

  &__extra-price {
    font-size: 11px;
    color: var(--da-amber);
    font-family: 'Barlow', sans-serif;
  }

  &__fare-preview {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--da-dark);
    border-radius: 14px;
    padding: 16px 20px;
    margin-top: 4px;
  }

  &__fare-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--da-gray-light);
  }

  &__fare-value {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 32px;
    color: var(--da-amber-light);
    letter-spacing: 0.05em;
  }

  &__actions {
    display: flex;
    gap: 12px;
  }
}
</style>
