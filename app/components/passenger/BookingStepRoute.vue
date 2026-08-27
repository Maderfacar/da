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

const { t } = useI18n();

const stopoverLabel = (n: number) => t('booking.route.stopoverLabel', { n });
const stopoverPlaceholder = (n: number) => t('booking.route.stopoverPlaceholder', { n });

const pickup = ref<GooglePlace | null>(props.pickupLocation);
const dropoff = ref<GooglePlace | null>(props.dropoffLocation);
const stopovers = ref<GooglePlace[]>([...props.stopovers]);
const routeInfo = ref<{ distanceKm: number; durationMinutes: number } | null>(null);
const isCalcLoading = ref(false);

// Drop Pin — 目前聚焦欄位
const activeField = ref<'origin' | `waypoint-${number}` | 'destination' | null>(null);
let _activeFieldTimer: ReturnType<typeof setTimeout> | null = null;

// blur 延遲 400ms 才清除，讓 map click 事件先觸發
const ClearActiveField = () => {
  if (_activeFieldTimer) clearTimeout(_activeFieldTimer);
  _activeFieldTimer = setTimeout(() => { activeField.value = null; }, 400);
};

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

// 停靠站有效點變動時重新計算（lat !== 0 代表已填入）
watch(
  () => stopovers.value.filter((s) => s.lat !== 0).length,
  () => { if (pickup.value && dropoff.value) ApiCalcRoute(); }
);

// 改用 GetMapsRoute，支援 waypoints，同時取得含停靠站的總距離與車程
const ApiCalcRoute = async () => {
  if (!pickup.value || !dropoff.value) return;
  isCalcLoading.value = true;

  const validWps = stopovers.value.filter((s) => s.lat !== 0);
  const wpsParam = validWps.map((s) => `${s.lat},${s.lng}`).join('|');

  const res = await $api.GetMapsRoute({
    origin: `${pickup.value.lat},${pickup.value.lng}`,
    destination: `${dropoff.value.lat},${dropoff.value.lng}`,
    ...(wpsParam ? { waypoints: wpsParam } : {}),
  });

  isCalcLoading.value = false;
  if (res.status.code !== 200 || !res.data) return;

  routeInfo.value = { distanceKm: res.data.distance_km, durationMinutes: res.data.duration_minutes };
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

// ── 拖移改變順序（HTML5 drag & drop；桌面 + Android Chrome 支援良好）────────────
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const HandleDragStart = (idx: number, e: DragEvent) => {
  // 只允許從 drag handle 拖；點 input/刪除鈕等不該觸發整列拖移
  const target = e.target as HTMLElement | null;
  if (!target?.closest?.('.PassengerBookingStepRoute__drag-handle')) {
    e.preventDefault();
    return;
  }
  dragIndex.value = idx;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }
};

const HandleDragOver = (idx: number, e: DragEvent) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (dragOverIndex.value !== idx) dragOverIndex.value = idx;
};

const HandleDragLeave = (idx: number) => {
  if (dragOverIndex.value === idx) dragOverIndex.value = null;
};

const HandleDrop = (idx: number, e: DragEvent) => {
  e.preventDefault();
  const from = dragIndex.value;
  dragIndex.value = null;
  dragOverIndex.value = null;
  if (from === null || from === idx) return;
  const arr = [...stopovers.value];
  const [moved] = arr.splice(from, 1);
  arr.splice(idx, 0, moved);
  stopovers.value = arr;
  const refs = [...waypointInputRefs.value];
  const [movedRef] = refs.splice(from, 1);
  refs.splice(idx, 0, movedRef);
  waypointInputRefs.value = refs;
  emit('update:stopovers', stopovers.value);
};

const HandleDragEnd = () => {
  dragIndex.value = null;
  dragOverIndex.value = null;
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
  h2.PassengerBookingStepRoute__title {{ $t('booking.route.title') }}

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

  //- 上下車安全提醒：紅線 / 公車停靠 / 黃網格 — 三語（放在地圖下方，避免遮住地圖視線）
  .PassengerBookingStepRoute__safety(role="note")
    NuxtIcon.PassengerBookingStepRoute__safety-icon(name="mdi:alert-octagon")
    .PassengerBookingStepRoute__safety-body
      .PassengerBookingStepRoute__safety-label {{ $t('booking.route.safetyNoticeLabel') }}
      .PassengerBookingStepRoute__safety-text {{ $t('booking.route.safetyNotice') }}

  UiGooglePlaceInput(
    ref="pickupInputRef"
    v-model="pickup"
    :label="$t('booking.route.pickupLabel')"
    :placeholder="$t('booking.route.pickupPlaceholder')"
    @focus="activeField = 'origin'"
    @blur="ClearActiveField"
  )

  .PassengerBookingStepRoute__stopovers(v-if="stopovers.length")
    .PassengerBookingStepRoute__stopover(
      v-for="(_, idx) in stopovers"
      :key="idx"
      :class="{ 'is-dragging': dragIndex === idx, 'is-drop-target': dragOverIndex === idx && dragIndex !== idx }"
      draggable="true"
      @dragstart="HandleDragStart(idx, $event)"
      @dragover="HandleDragOver(idx, $event)"
      @dragleave="HandleDragLeave(idx)"
      @drop="HandleDrop(idx, $event)"
      @dragend="HandleDragEnd"
    )
      button.PassengerBookingStepRoute__drag-handle(
        type="button"
        :aria-label="$t('booking.route.dragReorder')"
      )
        NuxtIcon(name="mdi:drag-vertical")
      UiGooglePlaceInput.PassengerBookingStepRoute__stopover-input(
        :ref="(el) => { waypointInputRefs[idx] = el }"
        :model-value="stopovers[idx] && stopovers[idx].lat !== 0 ? stopovers[idx] : null"
        :label="stopoverLabel(idx + 1)"
        :placeholder="stopoverPlaceholder(idx + 1)"
        @update:model-value="UpdateStopover(idx, $event)"
        @focus="activeField = `waypoint-${idx}`"
        @blur="ClearActiveField"
      )
      button.PassengerBookingStepRoute__remove-btn(@click="ClickRemoveStopover(idx)")
        NuxtIcon(name="mdi:close-circle-outline")

  button.PassengerBookingStepRoute__add-btn(@click="ClickAddStopover")
    NuxtIcon(name="mdi:plus-circle-outline")
    span {{ $t('booking.route.addStop') }}

  .PassengerBookingStepRoute__divider

  UiGooglePlaceInput(
    ref="dropoffInputRef"
    v-model="dropoff"
    :label="$t('booking.route.dropoffLabel')"
    :placeholder="$t('booking.route.dropoffPlaceholder')"
    @focus="activeField = 'destination'"
    @blur="ClearActiveField"
  )

  Transition(name="fade-up")
    .PassengerBookingStepRoute__route-card(v-if="routeInfo || isCalcLoading")
      template(v-if="isCalcLoading")
        NuxtIcon.spin(name="mdi:loading")
        span {{ $t('booking.route.calculating') }}
      template(v-else-if="routeInfo")
        .PassengerBookingStepRoute__route-stat
          NuxtIcon(name="mdi:road-variant")
          span {{ routeInfo.distanceKm }} km
        .PassengerBookingStepRoute__route-stat
          NuxtIcon(name="mdi:clock-outline")
          span {{ $t('booking.route.duration', { min: routeInfo.durationMinutes }) }}

  .PassengerBookingStepRoute__actions
    UiButton(type="secondary" @click="$emit('back')") {{ $t('booking.nav.back') }}
    UiButton(type="primary" :disabled="!canNext" @click="$emit('next')") {{ $t('booking.nav.next') }}
</template>

<style lang="scss" scoped>
.PassengerBookingStepRoute {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.PassengerBookingStepRoute__section-label {
  font-family: var(--ff-label);
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
  font-family: var(--ff-display);
  font-size: 28px;
  color: var(--da-dark);
  letter-spacing: 0.02em;
  margin-top: -8px;
}

.PassengerBookingStepRoute__safety {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(135deg, #fff4e5 0%, #ffe8d4 100%);
  border: 1.5px solid var(--wait);
  border-left: 4px solid var(--stop);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-soft);
}

.PassengerBookingStepRoute__safety-icon {
  flex-shrink: 0;
  font-size: 22px;
  color: var(--stop);
  margin-top: 2px;
}

.PassengerBookingStepRoute__safety-body {
  flex: 1;
  min-width: 0;
}

.PassengerBookingStepRoute__safety-label {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--stop);
  margin-bottom: 4px;
}

.PassengerBookingStepRoute__safety-text {
  font-family: var(--ff-ui);
  font-size: 14px;
  line-height: 1.55;
  color: #4e342e;
  font-weight: 500;
}

.PassengerBookingStepRoute__stopover {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &.is-dragging {
    opacity: 0.45;
  }

  &.is-drop-target {
    transform: translateY(2px);
    box-shadow: 0 -2px 0 var(--da-amber);
    border-radius: var(--r-xs);
  }
}

.PassengerBookingStepRoute__stopover-input {
  flex: 1;
  min-width: 0;
}

.PassengerBookingStepRoute__drag-handle {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--da-gray);
  font-size: 20px;
  cursor: grab;
  padding: 6px 2px;
  margin-bottom: 2px;
  touch-action: none;
  user-select: none;
  transition: color var(--dur-fast) var(--ease-out);

  &:hover { color: var(--da-amber); }
  &:active { cursor: grabbing; }
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
  transition: color var(--dur-fast) var(--ease-out);

  &:hover { color: var(--stop); }
}

.PassengerBookingStepRoute__add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 1px dashed var(--da-gray-pale);
  border-radius: var(--r-md);
  padding: 10px 16px;
  color: var(--da-gray);
  font-size: 13px;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  font-family: var(--ff-ui);

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
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-md);
  padding: 14px 18px;
  font-family: var(--ff-ui);
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
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
