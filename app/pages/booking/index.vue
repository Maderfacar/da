<script setup lang="ts">
import type { GooglePlace } from '~/protocol/fetch-api/api/maps';
import { VEHICLE_CONFIG, calculateFare } from '~shared/pricing';
import type { VehicleType } from '~shared/pricing';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

// ── Step 管理 ─────────────────────────────────────────────
const currentStep = ref(1);
const TOTAL_STEPS = 4;

function GoStep(n: number) {
  if (n < 1 || n > TOTAL_STEPS) return;
  currentStep.value = n;
}

// ── Step 1：行程類型 + 日期時間 ────────────────────────────
type OrderType = 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';
const orderType = ref<OrderType>('airport-pickup');
const pickupDate = ref('');
const pickupTime = ref('');

const ORDER_TYPE_OPTIONS: { value: OrderType; label: string; icon: string }[] = [
  { value: 'airport-pickup', label: '接機', icon: '✈️' },
  { value: 'airport-dropoff', label: '送機', icon: '🛫' },
  { value: 'charter', label: '包車', icon: '🚗' },
  { value: 'transfer', label: '交通接送', icon: '🚌' },
];

function Step1Valid(): boolean {
  return !!pickupDate.value && !!pickupTime.value;
}

// ── Step 2：地點設定 ────────────────────────────────────────
const originPlace = ref<GooglePlace | null>(null);
const destPlace = ref<GooglePlace | null>(null);
const waypointPlaces = ref<(GooglePlace | null)[]>([]);

// 目前地圖正在編輯的欄位
type ActiveField = 'origin' | `waypoint-${number}` | 'destination' | null;
const activeField = ref<ActiveField>(null);

// Refs 指向 UiGooglePlaceInput 以便接收 Drop Pin 更新
const originInputRef = ref<InstanceType<typeof UiGooglePlaceInput> | null>(null);
const destInputRef = ref<InstanceType<typeof UiGooglePlaceInput> | null>(null);
const waypointInputRefs = ref<(InstanceType<typeof UiGooglePlaceInput> | null)[]>([]);

// 為了使 template ref 生效，動態組件用 computed
const waypointList = computed(() => waypointPlaces.value);

function ClickAddWaypoint() {
  if (waypointPlaces.value.length >= 3) return;
  waypointPlaces.value.push(null);
  waypointInputRefs.value.push(null);
}

function ClickRemoveWaypoint(idx: number) {
  waypointPlaces.value.splice(idx, 1);
  waypointInputRefs.value.splice(idx, 1);
}

function ClickSetActiveField(field: ActiveField) {
  activeField.value = activeField.value === field ? null : field;
}

// Drop Pin 回調：由 MapRoutePreview 觸發
function OnPinPlaced(field: string, place: GooglePlace) {
  if (field === 'origin') {
    originPlace.value = place;
    originInputRef.value?.SetPlace(place);
  } else if (field === 'destination') {
    destPlace.value = place;
    destInputRef.value?.SetPlace(place);
  } else if (field.startsWith('waypoint-')) {
    const idx = parseInt(field.split('-')[1]);
    waypointPlaces.value[idx] = place;
    waypointInputRefs.value[idx]?.SetPlace(place);
  }
  activeField.value = null;
}

function Step2Valid(): boolean {
  return !!originPlace.value && !!destPlace.value;
}

// 計算 waypoints 陣列（過濾 null）
const validWaypoints = computed(() =>
  waypointPlaces.value.filter((w): w is GooglePlace => !!w)
);

// ── Step 3：人數、行李、車種、額外服務 ─────────────────────
const passengerCount = ref(1);
const luggageCount = ref(0);
const vehicleType = ref<VehicleType>('sedan');
const extraServices = ref<string[]>([]);

const EXTRA_SERVICE_OPTIONS = [
  { value: 'child-seat', label: '兒童座椅' },
  { value: 'wheelchair', label: '輪椅輔助' },
  { value: 'meet-sign', label: '接機舉牌' },
  { value: 'waiting', label: '額外等待（30分）' },
];

function ClickVehicle(v: VehicleType) {
  vehicleType.value = v;
  // 若乘客數超過選定車種最大座位數，自動調整
  if (passengerCount.value > VEHICLE_CONFIG[v].seats) {
    passengerCount.value = VEHICLE_CONFIG[v].seats;
  }
}

function Step3Valid(): boolean {
  return passengerCount.value >= 1;
}

// ── Step 4：計價確認 ────────────────────────────────────────
const distanceKm = ref(0);
const durationMin = ref(0);
const loadingPrice = ref(false);

const estimatedFare = computed(() =>
  calculateFare(distanceKm.value, vehicleType.value, extraServices.value.length)
);

async function Step4InitFlow() {
  if (!originPlace.value || !destPlace.value) return;
  loadingPrice.value = true;

  // 以「上車地址」→「下車地址」計算距離（含停靠站合計）
  const allPoints = [originPlace.value, ...validWaypoints.value, destPlace.value];
  let totalKm = 0;
  let totalMin = 0;

  for (let i = 0; i < allPoints.length - 1; i++) {
    const from = allPoints[i];
    const to = allPoints[i + 1];
    const res = await $api.GetMapsDistance({
      origin: `${from.lat},${from.lng}`,
      destination: `${to.lat},${to.lng}`,
    });
    if (res.status.code === 200) {
      const d = res.data as { distance_km: number; duration_minutes: number };
      totalKm += d.distance_km ?? 0;
      totalMin += d.duration_minutes ?? 0;
    }
  }

  distanceKm.value = Math.round(totalKm * 10) / 10;
  durationMin.value = totalMin;
  loadingPrice.value = false;
}

// ── 步驟切換 ──────────────────────────────────────────────
async function ClickNext() {
  if (currentStep.value === 1 && !Step1Valid()) return;
  if (currentStep.value === 2 && !Step2Valid()) return;
  if (currentStep.value === 3 && !Step3Valid()) return;

  if (currentStep.value === 3) await Step4InitFlow();
  GoStep(currentStep.value + 1);
}

function ClickPrev() {
  GoStep(currentStep.value - 1);
}

// ── 送出訂單 ──────────────────────────────────────────────
const submitting = ref(false);

async function ClickSubmit() {
  submitting.value = true;
  // TODO: 呼叫 Firebase Firestore 建立訂單（Stage 5）
  await new Promise((r) => setTimeout(r, 800));
  submitting.value = false;
  navigateTo('/orders');
}

// 動態 import UiGooglePlaceInput（供 ref 型別使用）
const UiGooglePlaceInput = resolveComponent('UiGooglePlaceInput') as any;
</script>

<template lang="pug">
.PageBooking
  //- 步驟指示器
  .PageBooking__steps
    .PageBooking__steps__item(
      v-for="n in TOTAL_STEPS"
      :key="n"
      :class="{ 'is-active': n === currentStep, 'is-done': n < currentStep }"
    ) {{ n }}

  //- ── Step 1：行程類型 + 日期時間 ─────────────────────────
  .PageBooking__section(v-if="currentStep === 1")
    h2.PageBooking__title 選擇行程

    .PageBooking__type-grid
      button.PageBooking__type-btn(
        v-for="opt in ORDER_TYPE_OPTIONS"
        :key="opt.value"
        type="button"
        :class="{ 'is-active': orderType === opt.value }"
        @click="orderType = opt.value"
      )
        span.PageBooking__type-btn__icon {{ opt.icon }}
        span.PageBooking__type-btn__label {{ opt.label }}

    .PageBooking__datetime
      .PageBooking__field
        label.PageBooking__label 出發日期
        input.PageBooking__input(
          v-model="pickupDate"
          type="date"
          :min="$dayjs().format('YYYY-MM-DD')"
        )
      .PageBooking__field
        label.PageBooking__label 出發時間
        input.PageBooking__input(
          v-model="pickupTime"
          type="time"
        )

  //- ── Step 2：設定路線（地圖 + 地址輸入）──────────────────
  .PageBooking__section(v-else-if="currentStep === 2")
    h2.PageBooking__title 設定路線

    //- 地圖（在「設定路線」與「上車地點」之間）
    ClientOnly
      MapRoutePreview.PageBooking__map(
        :origin="originPlace"
        :waypoints="validWaypoints"
        :destination="destPlace"
        :active-field="activeField"
        height="240px"
        @pin-placed="OnPinPlaced"
      )

    //- 上車地點
    .PageBooking__route-row
      .PageBooking__route-dot.is-origin
      .PageBooking__route-field
        UiGooglePlaceInput(
          ref="originInputRef"
          v-model="originPlace"
          label="上車地點 (Pickup)"
          placeholder="輸入接送地址或地點…"
          @focus="ClickSetActiveField('origin')"
        )
        button.PageBooking__pin-btn(
          type="button"
          :class="{ 'is-active': activeField === 'origin' }"
          @click="ClickSetActiveField('origin')"
          title="點擊地圖設定"
        ) 📍

    //- 停靠站
    .PageBooking__route-row(
      v-for="(_, idx) in waypointList"
      :key="idx"
    )
      .PageBooking__route-dot.is-waypoint {{ idx + 1 }}
      .PageBooking__route-field
        UiGooglePlaceInput(
          :ref="(el) => { waypointInputRefs[idx] = el as any }"
          v-model="waypointPlaces[idx]"
          :label="`停靠站 ${idx + 1}`"
          placeholder="停靠地址或地點…"
          @focus="ClickSetActiveField(`waypoint-${idx}`)"
        )
        button.PageBooking__pin-btn(
          type="button"
          :class="{ 'is-active': activeField === `waypoint-${idx}` }"
          @click="ClickSetActiveField(`waypoint-${idx}`)"
          title="點擊地圖設定"
        ) 📍
        button.PageBooking__remove-btn(
          type="button"
          @click="ClickRemoveWaypoint(idx)"
        ) ✕

    //- 下車地點
    .PageBooking__route-row
      .PageBooking__route-dot.is-dest
      .PageBooking__route-field
        UiGooglePlaceInput(
          ref="destInputRef"
          v-model="destPlace"
          label="下車地點 (Dropoff)"
          placeholder="輸入目的地地址或地點…"
          @focus="ClickSetActiveField('destination')"
        )
        button.PageBooking__pin-btn(
          type="button"
          :class="{ 'is-active': activeField === 'destination' }"
          @click="ClickSetActiveField('destination')"
          title="點擊地圖設定"
        ) 📍

    //- 新增停靠站
    button.PageBooking__add-waypoint(
      v-if="waypointPlaces.length < 3"
      type="button"
      @click="ClickAddWaypoint"
    ) + 新增停靠站

  //- ── Step 3：人數、行李、車種、服務 ─────────────────────
  .PageBooking__section(v-else-if="currentStep === 3")
    h2.PageBooking__title 乘客與車種

    .PageBooking__counters
      .PageBooking__counter
        label.PageBooking__label 乘客人數
        .PageBooking__counter__ctrl
          button(type="button" @click="passengerCount = Math.max(1, passengerCount - 1)") −
          span {{ passengerCount }}
          button(type="button" @click="passengerCount = Math.min(VEHICLE_CONFIG[vehicleType].seats, passengerCount + 1)") +
      .PageBooking__counter
        label.PageBooking__label 行李件數
        .PageBooking__counter__ctrl
          button(type="button" @click="luggageCount = Math.max(0, luggageCount - 1)") −
          span {{ luggageCount }}
          button(type="button" @click="luggageCount = luggageCount + 1") +

    .PageBooking__vehicle-grid
      button.PageBooking__vehicle-btn(
        v-for="(cfg, key) in VEHICLE_CONFIG"
        :key="key"
        type="button"
        :class="{ 'is-active': vehicleType === key }"
        @click="ClickVehicle(key as VehicleType)"
      )
        .PageBooking__vehicle-btn__label {{ cfg.label }}
        .PageBooking__vehicle-btn__info 最多 {{ cfg.seats }} 人 · {{ cfg.luggage }} 件行李

    .PageBooking__extras
      label.PageBooking__label 額外服務（每項 +$200）
      .PageBooking__extras__list
        label.PageBooking__extra-item(
          v-for="opt in EXTRA_SERVICE_OPTIONS"
          :key="opt.value"
        )
          input(
            type="checkbox"
            v-model="extraServices"
            :value="opt.value"
          )
          span {{ opt.label }}

  //- ── Step 4：計價確認 ─────────────────────────────────────
  .PageBooking__section(v-else-if="currentStep === 4")
    h2.PageBooking__title 確認行程

    .PageBooking__summary(v-if="!loadingPrice")
      .PageBooking__summary__row
        span 行程類型
        span {{ ORDER_TYPE_OPTIONS.find(o => o.value === orderType)?.label }}
      .PageBooking__summary__row
        span 出發時間
        span {{ pickupDate }} {{ pickupTime }}
      .PageBooking__summary__row
        span 上車地點
        span {{ originPlace?.displayName }}
      .PageBooking__summary__row(v-for="(wp, i) in validWaypoints" :key="i")
        span 停靠站 {{ i + 1 }}
        span {{ wp.displayName }}
      .PageBooking__summary__row
        span 下車地點
        span {{ destPlace?.displayName }}
      .PageBooking__summary__row
        span 車種
        span {{ VEHICLE_CONFIG[vehicleType].label }}
      .PageBooking__summary__row
        span 乘客 / 行李
        span {{ passengerCount }} 人 / {{ luggageCount }} 件
      .PageBooking__summary__row(v-if="distanceKm > 0")
        span 預估距離
        span {{ distanceKm }} 公里（約 {{ durationMin }} 分鐘）
      .PageBooking__summary__fare
        span 預估車資
        strong ${{ estimatedFare.toLocaleString() }}

    .PageBooking__loading(v-else) 計算車資中…

  //- ── 操作按鈕 ─────────────────────────────────────────────
  .PageBooking__actions
    button.PageBooking__btn.is-secondary(
      v-if="currentStep > 1"
      type="button"
      @click="ClickPrev"
    ) 上一步
    button.PageBooking__btn.is-primary(
      v-if="currentStep < TOTAL_STEPS"
      type="button"
      :disabled="(currentStep === 1 && !Step1Valid()) || (currentStep === 2 && !Step2Valid())"
      @click="ClickNext"
    ) 下一步
    button.PageBooking__btn.is-primary(
      v-else
      type="button"
      :disabled="submitting || loadingPrice"
      @click="ClickSubmit"
    ) {{ submitting ? '送出中…' : '確認訂車' }}
</template>

<style lang="scss" scoped>
.PageBooking {
  max-width: 480px;
  margin: 0 auto;
  padding: 20px 16px 100px;
}

// ── 步驟指示器 ─────────────────────────────────────────────
.PageBooking__steps {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 28px;
}

.PageBooking__steps__item {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 13px;
  background: var(--da-gray-pale);
  color: var(--da-gray);
  transition: all 0.2s;

  &.is-active {
    background: var(--da-amber);
    color: #fff;
  }

  &.is-done {
    background: rgba(212, 134, 10, 0.2);
    color: var(--da-amber);
  }
}

// ── Section ────────────────────────────────────────────────
.PageBooking__section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.PageBooking__title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  letter-spacing: 0.05em;
  color: var(--da-dark);
  margin: 0;
}

// ── Step 1：行程類型 ────────────────────────────────────────
.PageBooking__type-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.PageBooking__type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 12px;
  border: 2px solid var(--da-gray-pale);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;

  &.is-active {
    border-color: var(--da-amber);
    background: rgba(212, 134, 10, 0.06);
  }
}

.PageBooking__type-btn__icon { font-size: 28px; }

.PageBooking__type-btn__label {
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--da-dark);
}

.PageBooking__datetime {
  display: flex;
  gap: 12px;
}

.PageBooking__field { flex: 1; display: flex; flex-direction: column; gap: 6px; }

.PageBooking__label {
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--da-gray);
}

.PageBooking__input {
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  border: 1.5px solid var(--da-gray-pale);
  border-radius: 12px;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 15px;
  color: var(--da-dark);
  background: rgba(255, 255, 255, 0.85);
  outline: none;
  transition: border-color 0.2s;

  &:focus { border-color: var(--da-amber); }
}

// ── Step 2：地圖 + 路線 ────────────────────────────────────
.PageBooking__map {
  border-radius: 16px;
  overflow: hidden;
}

.PageBooking__route-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.PageBooking__route-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  margin-top: 28px; // 對齊 label 高度後的 input

  &.is-origin { background: var(--da-amber); }
  &.is-dest { background: var(--da-dark); }
  &.is-waypoint { background: #4a7c59; }
}

.PageBooking__route-field {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.PageBooking__route-field > :first-child { flex: 1; }

.PageBooking__pin-btn {
  width: 36px;
  height: 44px;
  border: 1.5px solid var(--da-gray-pale);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 16px;
  flex-shrink: 0;
  transition: border-color 0.15s, background 0.15s;

  &.is-active {
    border-color: var(--da-amber);
    background: rgba(212, 134, 10, 0.1);
  }
}

.PageBooking__remove-btn {
  width: 36px;
  height: 44px;
  border: 1.5px solid var(--da-gray-pale);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 14px;
  color: var(--da-gray);
  flex-shrink: 0;

  &:hover { border-color: var(--err); color: var(--err); }
}

.PageBooking__add-waypoint {
  align-self: flex-start;
  margin-left: 34px;
  padding: 6px 14px;
  border: 1.5px dashed var(--da-gray-pale);
  border-radius: 20px;
  background: none;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: var(--da-gray);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;

  &:hover { border-color: var(--da-amber); color: var(--da-amber); }
}

// ── Step 3：計數器 ─────────────────────────────────────────
.PageBooking__counters { display: flex; gap: 20px; }

.PageBooking__counter {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageBooking__counter__ctrl {
  display: flex;
  align-items: center;
  gap: 14px;

  button {
    width: 36px;
    height: 36px;
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.8);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    transition: border-color 0.15s;

    &:hover { border-color: var(--da-amber); }
  }

  span {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 22px;
    font-weight: 700;
    min-width: 24px;
    text-align: center;
    color: var(--da-dark);
  }
}

// ── 車種格 ─────────────────────────────────────────────────
.PageBooking__vehicle-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.PageBooking__vehicle-btn {
  padding: 14px 12px;
  border: 2px solid var(--da-gray-pale);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s, background 0.2s;

  &.is-active {
    border-color: var(--da-amber);
    background: rgba(212, 134, 10, 0.06);
  }
}

.PageBooking__vehicle-btn__label {
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: var(--da-dark);
  display: block;
}

.PageBooking__vehicle-btn__info {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: var(--da-gray);
  margin-top: 4px;
}

// ── 額外服務 ───────────────────────────────────────────────
.PageBooking__extras { display: flex; flex-direction: column; gap: 10px; }

.PageBooking__extras__list { display: flex; flex-direction: column; gap: 8px; }

.PageBooking__extra-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: var(--da-dark);
  cursor: pointer;

  input[type="checkbox"] { accent-color: var(--da-amber); width: 18px; height: 18px; }
}

// ── Step 4：摘要 ───────────────────────────────────────────
.PageBooking__summary {
  background: rgba(255, 255, 255, 0.8);
  border: 1.5px solid var(--da-gray-pale);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PageBooking__summary__row {
  display: flex;
  justify-content: space-between;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 14px;

  span:first-child { color: var(--da-gray); }
  span:last-child { color: var(--da-dark); font-weight: 500; text-align: right; max-width: 65%; }
}

.PageBooking__summary__fare {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1.5px solid var(--da-gray-pale);

  span {
    font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--da-gray);
  }

  strong {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 32px;
    color: var(--da-amber);
  }
}

.PageBooking__loading {
  text-align: center;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: var(--da-gray);
  padding: 40px 0;
}

// ── 操作按鈕 ───────────────────────────────────────────────
.PageBooking__actions {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 16px 20px calc(env(safe-area-inset-bottom) + 16px);
  background: linear-gradient(to top, var(--da-cream) 70%, transparent);
  display: flex;
  gap: 12px;
  z-index: 50;
}

.PageBooking__btn {
  flex: 1;
  min-height: 52px;
  border-radius: 14px;
  font-family: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  border: none;
  transition: opacity 0.2s;

  &:disabled { opacity: 0.4; cursor: not-allowed; }

  &.is-primary {
    background: var(--da-amber);
    color: #fff;
  }

  &.is-secondary {
    background: rgba(0, 0, 0, 0.06);
    color: var(--da-dark);
    flex: 0 0 auto;
    min-width: 88px;
  }
}
</style>
