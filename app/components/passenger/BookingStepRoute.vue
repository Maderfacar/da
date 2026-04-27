<script setup lang="ts">
import type { GooglePlace } from '~/protocol/fetch-api/api/maps';

interface Props {
  pickupLocation: GooglePlace | null;
  dropoffLocation: GooglePlace | null;
  stopovers: GooglePlace[];
}

interface PlaceInputExpose {
  SetPlace: (place: GooglePlace) => void;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:pickupLocation' | 'update:dropoffLocation', val: GooglePlace | null): void;
  (e: 'update:stopovers', val: GooglePlace[]): void;
  (e: 'routeCalc', val: { distanceKm: number; durationMinutes: number }): void;
  (e: 'next' | 'back'): void;
}>();

const pickup = ref<GooglePlace | null>(props.pickupLocation);
const dropoff = ref<GooglePlace | null>(props.dropoffLocation);
const stopovers = ref<GooglePlace[]>([...props.stopovers]);
const routeInfo = ref<{ distanceKm: number; durationMinutes: number } | null>(null);
const isCalcLoading = ref(false);

// Drop Pin — 目前聚焦欄位
const activeField = ref<'origin' | `waypoint-${number}` | 'destination' | null>(null);

// 各地址欄 ref（用於 Drop Pin 回填）
const pickupInputRef = ref<PlaceInputExpose | null>(null);
const dropoffInputRef = ref<PlaceInputExpose | null>(null);
const waypointInputRefs = ref<(PlaceInputExpose | null)[]>([]);

watch(pickup, (val) => {
  emit('update:pickupLocation', val);
  if (val && dropoff.value) ApiCalcRoute();
});

watch(dropoff, (val) => {
  emit('update:dropoffLocation', val);
  if (val && pickup.value) ApiCalcRoute();
});

const _isOk = (code: number) => code === $enum.apiStatus.success || code === 0;

const ApiCalcRoute = async () => {
  if (!pickup.value || !dropoff.value) return;
  isCalcLoading.value = true;
  const res = await $api.GetMapsDistance({
    origin: `${pickup.value.lat},${pickup.value.lng}`,
    destination: `${dropoff.value.lat},${dropoff.value.lng}`,
  });
  isCalcLoading.value = false;
  if (!_isOk(res.status.code)) return;
  const data = res.data as DistanceRes;
  routeInfo.value = { distanceKm: data.distance_km, durationMinutes: data.duration_minutes };
  emit('routeCalc', routeInfo.value);
};

const ClickAddStopover = () => {
  stopovers.value.push({ displayName: '', address: '', lat: 0, lng: 0 });
  waypointInputRefs.value.push(null);
  emit('update:stopovers', stopovers.value);
};

const UpdateStopover = (idx: number, val: GooglePlace | null) => {
  if (!val) return;
  stopovers.value[idx] = val;
  emit('update:stopovers', stopovers.value);
};

const ClickRemoveStopover = (idx: number) => {
  stopovers.value.splice(idx, 1);
  waypointInputRefs.value.splice(idx, 1);
  emit('update:stopovers', stopovers.value);
};

// Drop Pin 回填
const OnPinPlaced = (field: string, place: GooglePlace) => {
  if (field === 'origin') {
    pickup.value = place;
    pickupInputRef.value?.SetPlace(place);
  } else if (field === 'destination') {
    dropoff.value = place;
    dropoffInputRef.value?.SetPlace(place);
  } else if (field.startsWith('waypoint-')) {
    const idx = parseInt(field.replace('waypoint-', ''), 10);
    if (stopovers.value[idx] !== undefined) {
      stopovers.value[idx] = place;
      waypointInputRefs.value[idx]?.SetPlace(place);
      emit('update:stopovers', stopovers.value);
    }
  }
};

const canNext = computed(() => !!pickup.value && !!dropoff.value);
</script>

<template lang="pug">
.PassengerBookingStepRoute
  .PassengerBookingStepRoute__section-label ROUTE PLANNING
  h2.PassengerBookingStepRoute__title 設定路線

  //- 地圖預覽（Drop Pin 支援）
  ClientOnly
    MapRoutePreview(
      :origin="pickup"
      :waypoints="stopovers.filter((s) => s.lat !== 0)"
      :destination="dropoff"
      :active-field="activeField"
      height="220px"
      @pin-placed="OnPinPlaced"
    )

  UiGooglePlaceInput(
    ref="pickupInputRef"
    v-model="pickup"
    label="上車地點 / PICKUP"
    placeholder="請輸入上車地址"
    @focus="activeField = 'origin'"
    @blur="activeField = null"
  )

  .PassengerBookingStepRoute__stopovers(v-if="stopovers.length")
    .PassengerBookingStepRoute__stopover(
      v-for="(_, idx) in stopovers"
      :key="idx"
    )
      UiGooglePlaceInput(
        :ref="(el) => { waypointInputRefs[idx] = el }"
        :model-value="stopovers[idx] && stopovers[idx].lat !== 0 ? stopovers[idx] : null"
        :label="`停靠站 ${idx + 1} / STOPOVER`"
        :placeholder="`請輸入第 ${idx + 1} 個停靠站`"
        @update:model-value="UpdateStopover(idx, $event)"
        @focus="activeField = `waypoint-${idx}`"
        @blur="activeField = null"
      )
      button.PassengerBookingStepRoute__remove-btn(@click="ClickRemoveStopover(idx)")
        NuxtIcon(name="mdi:close-circle-outline")

  button.PassengerBookingStepRoute__add-btn(@click="ClickAddStopover")
    NuxtIcon(name="mdi:plus-circle-outline")
    span 新增中途停靠站

  .PassengerBookingStepRoute__divider

  UiGooglePlaceInput(
    ref="dropoffInputRef"
    v-model="dropoff"
    label="下車地點 / DROPOFF"
    placeholder="請輸入下車地址"
    @focus="activeField = 'destination'"
    @blur="activeField = null"
  )

  Transition(name="fade-up")
    .PassengerBookingStepRoute__route-card(v-if="routeInfo || isCalcLoading")
      template(v-if="isCalcLoading")
        NuxtIcon.spin(name="mdi:loading")
        span 計算路線中…
      template(v-else-if="routeInfo")
        .PassengerBookingStepRoute__route-stat
          NuxtIcon(name="mdi:road-variant")
          span {{ routeInfo.distanceKm }} km
        .PassengerBookingStepRoute__route-stat
          NuxtIcon(name="mdi:clock-outline")
          span 約 {{ routeInfo.durationMinutes }} 分鐘

  .PassengerBookingStepRoute__actions
    UiButton(type="secondary" @click="$emit('back')") ← 上一步
    UiButton(type="primary" :disabled="!canNext" @click="$emit('next')") 下一步 NEXT →
</template>

<style lang="scss" scoped>
.PassengerBookingStepRoute {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.PassengerBookingStepRoute__section-label {
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

.PassengerBookingStepRoute__title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  color: var(--da-dark);
  letter-spacing: 0.02em;
  margin-top: -8px;
}

.PassengerBookingStepRoute__stopover {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.PassengerBookingStepRoute__remove-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--da-gray);
  font-size: 22px;
  cursor: pointer;
  padding: 6px;
  margin-bottom: 2px;
  transition: color 0.15s;

  &:hover { color: #ef4444; }
}

.PassengerBookingStepRoute__add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 1px dashed var(--da-gray-pale);
  border-radius: 10px;
  padding: 10px 16px;
  color: var(--da-gray);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;

  &:hover {
    border-color: var(--da-amber);
    color: var(--da-amber);
  }
}

.PassengerBookingStepRoute__divider {
  height: 1px;
  background: var(--da-gray-pale);
  margin: 4px 0;
}

.PassengerBookingStepRoute__route-card {
  display: flex;
  align-items: center;
  gap: 20px;
  background: var(--da-amber-pale);
  border: 1px solid rgba(212, 134, 10, 0.25);
  border-radius: 12px;
  padding: 14px 18px;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: var(--da-dark);
}

.PassengerBookingStepRoute__route-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;

  .nuxt-icon { color: var(--da-amber); }
}

.PassengerBookingStepRoute__actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.spin { animation: spin 0.8s linear infinite; color: var(--da-amber); }

@keyframes spin { to { transform: rotate(360deg); } }

.fade-up-enter-active,
.fade-up-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
