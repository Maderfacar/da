<script setup lang="ts">
import type { VehicleType, FleetVehicle, OrderType } from '~shared/pricing';
import type { GooglePlace, MapsRouteRes } from '~/protocol/fetch-api/api/maps';

export interface LuggageItem { typeId: string; count: number }

interface Props {
  passengerCount: number;
  luggageItems: LuggageItem[];
  vehicleType: VehicleType;
  extraServices: string[];
  // Fare V2：明細由 server 計算，需路線 + 上車時間
  pickupLocation: GooglePlace | null;
  dropoffLocation: GooglePlace | null;
  stopovers: GooglePlace[];
  pickupDateTime: string;
  /** 行程類型 — 供 Fare V2 時段規則的行程過濾 */
  orderType: OrderType | undefined;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:passengerCount' | 'fareCalc', val: number): void;
  (e: 'update:luggageItems', val: LuggageItem[]): void;
  (e: 'update:vehicleType', val: VehicleType): void;
  (e: 'update:extraServices', val: string[]): void;
  (e: 'fareResult', val: MapsRouteRes): void;
  (e: 'next' | 'back'): void;
}>();

const { t, locale } = useI18n();

const storeConfig = StoreConfig();

const passengers = ref(props.passengerCount);
const vehicle = ref<VehicleType>(props.vehicleType);
const extras = ref<string[]>([...props.extraServices]);

// ── 行李 SU 邏輯 ─────────────────────────────────────────────────────────────
const luggage = ref<LuggageItem[]>([...props.luggageItems]);

const _GetLuggageCount = (typeId: string): number =>
  luggage.value.find((i) => i.typeId === typeId)?.count ?? 0;

const _SetLuggageCount = (typeId: string, count: number) => {
  const clamped = Math.max(0, Math.min(20, count));
  const idx = luggage.value.findIndex((i) => i.typeId === typeId);
  if (clamped === 0) {
    if (idx !== -1) luggage.value.splice(idx, 1);
  } else if (idx === -1) {
    luggage.value.push({ typeId, count: clamped });
  } else {
    luggage.value[idx].count = clamped;
  }
};

const totalSU = computed(() =>
  luggage.value.reduce((sum, item) => {
    const t = storeConfig.GetLuggageType(item.typeId);
    return sum + (t?.su ?? 0) * item.count;
  }, 0),
);

const Loc = (label: { zh: string; en: string; ja: string } | undefined) =>
  storeConfig.LabelOf(label, locale.value as 'zh' | 'en' | 'ja');

// ── 車型容量 vs 行李 SU 校驗 ─────────────────────────────────────────────────
type VehicleStatus = 'ok' | 'warn' | 'disabled';
const _GetVehicleStatus = (v: FleetVehicle): VehicleStatus => {
  // 乘客數超出 → 直接 disabled
  if (passengers.value > v.capacity) return 'disabled';
  // SU 超出 1.5 倍 → disabled + 紅字
  if (totalSU.value > v.luggageSU * 1.5) return 'disabled';
  // SU 介於 1.0x ~ 1.5x → 警告
  if (totalSU.value > v.luggageSU) return 'warn';
  return 'ok';
};

const _GetVehicleHint = (v: FleetVehicle): string => {
  if (passengers.value > v.capacity) return t('booking.options.exceedCapacity', { n: v.capacity });
  if (totalSU.value > v.luggageSU * 1.5) return t('booking.options.exceedLuggage');
  if (totalSU.value > v.luggageSU) return t('booking.options.warnLuggage');
  return '';
};

const vehicles = computed(() =>
  storeConfig.EnabledVehicles.map((v) => ({
    ...v,
    status: _GetVehicleStatus(v),
    hint: _GetVehicleHint(v),
  })),
);

const luggageTypes = computed(() => storeConfig.luggageTypes);

// ── 車資試算（Fare V2：明細由 server 計算）──────────────────────────────────
const fareResult = ref<MapsRouteRes | null>(null);
const fareLoading = ref(false);
let _fareTimer: ReturnType<typeof setTimeout> | null = null;

const ApiFetchFare = async () => {
  if (!props.pickupLocation || !props.dropoffLocation || !vehicle.value) return;
  fareLoading.value = true;
  const validWps = props.stopovers.filter((s) => s.lat !== 0);
  const res = await $api.GetMapsRoute({
    origin: `${props.pickupLocation.lat},${props.pickupLocation.lng}`,
    destination: `${props.dropoffLocation.lat},${props.dropoffLocation.lng}`,
    ...(validWps.length ? { waypoints: validWps.map((s) => `${s.lat},${s.lng}`).join('|') } : {}),
    vehicleType: vehicle.value,
    pickupTime: props.pickupDateTime
      ? $dayjs(props.pickupDateTime).toISOString()
      : new Date().toISOString(),
    ...(extras.value.length ? { extras: extras.value.join(',') } : {}),
    ...(props.orderType ? { orderType: props.orderType } : {}),
  });
  fareLoading.value = false;
  if (res.status.code !== 200 || !res.data) return;
  fareResult.value = res.data;
  emit('fareCalc', res.data.fareTotal ?? 0);
  emit('fareResult', res.data);
};

// vehicle / extras 變動 → debounce 重新估價
const FareFetchFlow = () => {
  if (_fareTimer) clearTimeout(_fareTimer);
  _fareTimer = setTimeout(ApiFetchFare, 400);
};

// ── Sync ────────────────────────────────────────────────────────────────────
watch(passengers, (val) => emit('update:passengerCount', val));
watch(luggage, (val) => emit('update:luggageItems', val), { deep: true });
watch(vehicle, (val) => { emit('update:vehicleType', val); FareFetchFlow(); });
watch(extras, (val) => { emit('update:extraServices', val); FareFetchFlow(); }, { deep: true });

onMounted(ApiFetchFare);

const ClickVehicle = (v: FleetVehicle) => {
  const status = _GetVehicleStatus(v);
  if (status === 'disabled') return;
  vehicle.value = v.id;
};

const ToggleExtra = (id: string) => {
  const idx = extras.value.indexOf(id);
  if (idx === -1) extras.value.push(id);
  else extras.value.splice(idx, 1);
};

const isExtraSelected = (id: string) => extras.value.includes(id);

// 若當前選擇的車型變 disabled（乘客數或 SU 超出），自動切到第一個 ok 車型
watch([passengers, totalSU], () => {
  const current = vehicles.value.find((v) => v.id === vehicle.value);
  if (current && current.status === 'disabled') {
    const next = vehicles.value.find((v) => v.status !== 'disabled');
    if (next) vehicle.value = next.id;
  }
});

// store 載入後若 vehicle 仍空，自動選第一台
watch(() => storeConfig.EnabledVehicles, (list) => {
  if (!vehicle.value && list.length > 0) vehicle.value = list[0].id;
}, { immediate: true });
</script>

<template lang="pug">
.PassengerBookingStepOptions
  .PassengerBookingStepOptions__section-label PASSENGERS
  h2.PassengerBookingStepOptions__title {{ $t('booking.options.title') }}

  //- 乘客人數 stepper
  .PassengerBookingStepOptions__counters
    .PassengerBookingStepOptions__counter
      span.PassengerBookingStepOptions__counter-label {{ $t('booking.options.passengers') }}
      .PassengerBookingStepOptions__counter-ctrl
        button(@click="passengers = Math.max(1, passengers - 1)") −
        span {{ passengers }}
        button(@click="passengers = Math.min(8, passengers + 1)") +

  //- 行李 SU 區塊
  .PassengerBookingStepOptions__section-label.mt LUGGAGE
  h2.PassengerBookingStepOptions__title {{ $t('booking.options.luggage') }}

  .PassengerBookingStepOptions__luggage-list
    .PassengerBookingStepOptions__luggage-row(
      v-for="lt in luggageTypes"
      :key="lt.id"
    )
      .PassengerBookingStepOptions__luggage-info
        span.PassengerBookingStepOptions__luggage-name {{ Loc(lt.label) }}
        span.PassengerBookingStepOptions__luggage-su {{ lt.su }} SU
      .PassengerBookingStepOptions__luggage-ctrl
        button(@click="_SetLuggageCount(lt.id, _GetLuggageCount(lt.id) - 1)") −
        span {{ _GetLuggageCount(lt.id) }}
        button(@click="_SetLuggageCount(lt.id, _GetLuggageCount(lt.id) + 1)") +

  .PassengerBookingStepOptions__su-total
    span.PassengerBookingStepOptions__su-total-label {{ $t('booking.options.suTotal') }}
    span.PassengerBookingStepOptions__su-total-val {{ totalSU }} SU

  //- 車型選擇
  .PassengerBookingStepOptions__section-label.mt VEHICLE
  h2.PassengerBookingStepOptions__title {{ $t('booking.options.vehicleTitle') }}

  .PassengerBookingStepOptions__vehicles
    .PassengerBookingStepOptions__vehicle-card(
      v-for="cfg in vehicles"
      :key="cfg.id"
      :class="{ 'is-active': vehicle === cfg.id, 'is-disabled': cfg.status === 'disabled', 'is-warn': cfg.status === 'warn' }"
      @click="ClickVehicle(cfg)"
    )
      .PassengerBookingStepOptions__vehicle-name {{ Loc(cfg.label) }}
      .PassengerBookingStepOptions__vehicle-sub {{ cfg.label.en }}
      .PassengerBookingStepOptions__vehicle-specs
        span
          NuxtIcon(name="mdi:account-group")
          | {{ cfg.capacity }}{{ $t('fleet.unit.person') }}
        span
          NuxtIcon(name="mdi:bag-suitcase")
          | {{ cfg.luggageSU }} SU
      .PassengerBookingStepOptions__vehicle-fare
        | {{ $t('booking.options.baseFare', { fare: cfg.baseFare }) }}
        span + NT${{ cfg.perKmRate }}/km
      .PassengerBookingStepOptions__vehicle-hint(v-if="cfg.hint") {{ cfg.hint }}

  //- 加值服務
  .PassengerBookingStepOptions__section-label.mt EXTRAS
  h2.PassengerBookingStepOptions__title {{ $t('booking.options.extrasTitle') }}

  .PassengerBookingStepOptions__extras
    .PassengerBookingStepOptions__extra-card(
      v-for="svc in storeConfig.EnabledExtras"
      :key="svc.id"
      :class="{ 'is-active': isExtraSelected(svc.id) }"
      @click="ToggleExtra(svc.id)"
    )
      NuxtIcon(:name="svc.icon")
      span {{ Loc(svc.label) }}
      span.PassengerBookingStepOptions__extra-price +NT${{ svc.price }}

  PassengerFareBreakdownCard(
    :fare-total="fareResult ? fareResult.fareTotal : null"
    :loading="fareLoading"
  )

  .PassengerBookingStepOptions__actions
    UiButton(type="secondary" @click="$emit('back')") {{ $t('booking.nav.back') }}
    UiButton(type="primary" @click="$emit('next')") {{ $t('booking.nav.next') }}
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
    grid-template-columns: 1fr;
    gap: 12px;
  }

  &__counter {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-gray-pale);
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    justify-content: space-between;
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

  // ── 行李 SU 列表 ────────────────────────────────────────────────────────
  &__luggage-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__luggage-row {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-gray-pale);
    border-radius: 14px;
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  &__luggage-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  &__luggage-name {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 14px;
    color: var(--da-dark);
    line-height: 1.3;
  }

  &__luggage-su {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 0.1em;
    color: var(--da-amber);
  }

  &__luggage-ctrl {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;

    button {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1.5px solid var(--da-amber);
      background: none;
      color: var(--da-amber);
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover { background: var(--da-amber-pale); }
    }

    span {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 22px;
      color: var(--da-dark);
      min-width: 20px;
      text-align: center;
    }
  }

  &__su-total {
    background: var(--da-dark);
    border-radius: 12px;
    padding: 10px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 4px;
  }

  &__su-total-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--da-gray-light);
  }

  &__su-total-val {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 24px;
    color: var(--da-amber-light);
    letter-spacing: 0.05em;
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
    grid-template-rows: auto auto auto;
    gap: 4px 12px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    position: relative;

    &.is-active {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);
    }

    &.is-warn {
      border-color: #f59e0b;
    }

    &.is-disabled {
      opacity: 0.45;
      cursor: not-allowed;
      border-color: #ef4444;
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
    grid-row: 3;
    display: flex;
    gap: 6px;
    align-items: center;
    font-family: 'Barlow', sans-serif;

    span { color: var(--da-amber); font-size: 12px; }
  }

  &__vehicle-hint {
    grid-column: 1 / 3;
    grid-row: 4;
    font-size: 12px;
    margin-top: 4px;
    font-family: 'Noto Sans TC', sans-serif;

    .is-disabled & { color: #ef4444; }
    .is-warn & { color: #d97706; }
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

  &__actions {
    display: flex;
    gap: 12px;
  }
}
</style>
