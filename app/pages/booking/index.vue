<script setup lang="ts">
import type { VehicleType, ExtraService, OrderType } from '~shared/pricing';
import type { FlightInfo } from '@@/api/flight.get';

definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const storeOrder = StoreOrder();

// ── 步驟控制 ────────────────────────────────────────────────────────────────
const currentStep = ref(1);
const TOTAL_STEPS = 4;

const stepLabels = ['行程類型', '路線規劃', '乘車需求', '確認訂單'];

// ── 表單狀態（從 store draft 同步）────────────────────────────────────────
const orderType = ref<OrderType | undefined>(storeOrder.draft.orderType as OrderType | undefined);
const pickupDateTime = ref(storeOrder.draft.pickupDateTime ?? '');
const pickupLocation = ref<GooglePlace | null>(storeOrder.draft.pickupLocation ?? null);
const dropoffLocation = ref<GooglePlace | null>(storeOrder.draft.dropoffLocation ?? null);
const stopovers = ref<GooglePlace[]>(storeOrder.draft.stopovers ?? []);
const passengerCount = ref(storeOrder.draft.passengerCount ?? 1);
const luggageCount = ref(storeOrder.draft.luggageCount ?? 0);
const vehicleType = ref<VehicleType>((storeOrder.draft.vehicleType as VehicleType) ?? 'sedan');
const extraServices = ref<ExtraService[]>((storeOrder.draft.extraServices as ExtraService[]) ?? []);

const flightNo = ref('');
const flightInfo = ref<FlightInfo | null>(null);

const distanceKm = ref(storeOrder.routeInfo?.distanceKm ?? 0);
const durationMinutes = ref(storeOrder.routeInfo?.durationMinutes ?? 0);
const estimatedFare = ref(storeOrder.estimatedFare ?? 0);

const isSubmitting = ref(false);
const isSuccess = ref(false);

// ── 步驟導航 ─────────────────────────────────────────────────────────────────
const GoNext = () => {
  SyncToStore();
  if (currentStep.value < TOTAL_STEPS) currentStep.value++;
};

const GoBack = () => {
  if (currentStep.value > 1) currentStep.value--;
};

// ── 同步至 store ─────────────────────────────────────────────────────────────
const SyncToStore = () => {
  storeOrder.SetDraft({
    orderType: orderType.value,
    pickupDateTime: pickupDateTime.value,
    pickupLocation: pickupLocation.value ?? undefined,
    dropoffLocation: dropoffLocation.value ?? undefined,
    stopovers: stopovers.value,
    passengerCount: passengerCount.value,
    luggageCount: luggageCount.value,
    vehicleType: vehicleType.value,
    extraServices: extraServices.value,
  });
};

const OnRouteCalc = (info: { distanceKm: number; durationMinutes: number }) => {
  distanceKm.value = info.distanceKm;
  durationMinutes.value = info.durationMinutes;
  storeOrder.SetRouteInfo(info);
};

const OnFareCalc = (fare: number) => {
  estimatedFare.value = fare;
  storeOrder.SetEstimatedFare(fare);
};

// ── 送出訂單 ──────────────────────────────────────────────────────────────────
const ClickSubmit = async () => {
  if (isSubmitting.value) return;
  SyncToStore();

  const authStore = StoreAuth();
  const userId = authStore.user?.uid ?? 'guest';
  const lineUserId = authStore.user?.uid ?? ''; // LINE userId 於 Stage 5 補充

  if (!orderType.value || !pickupDateTime.value || !pickupLocation.value || !dropoffLocation.value) return;

  isSubmitting.value = true;
  const res = await $api.CreateOrder({
    userId,
    lineUserId,
    orderType: orderType.value,
    pickupDateTime: pickupDateTime.value,
    pickupLocation: pickupLocation.value,
    dropoffLocation: dropoffLocation.value,
    stopovers: stopovers.value.filter((s) => s.lat !== 0),
    passengerCount: passengerCount.value,
    luggageCount: luggageCount.value,
    vehicleType: vehicleType.value,
    extraServices: extraServices.value,
  });
  isSubmitting.value = false;

  const isOk = (code: number) => code === $enum.apiStatus.success || code === 0;
  if (!isOk(res.status.code)) return;
  storeOrder.SetCurrentOrder(res.data as CreateOrderRes);
  storeOrder.ResetDraft();
  isSuccess.value = true;
};

const ClickNewOrder = () => {
  isSuccess.value = false;
  currentStep.value = 1;
  orderType.value = undefined;
  pickupDateTime.value = '';
  pickupLocation.value = null;
  dropoffLocation.value = null;
  stopovers.value = [];
  passengerCount.value = 1;
  luggageCount.value = 0;
  vehicleType.value = 'sedan';
  extraServices.value = [];
  flightNo.value = '';
  flightInfo.value = null;
  distanceKm.value = 0;
  durationMinutes.value = 0;
  estimatedFare.value = 0;
};
</script>

<template lang="pug">
.PageBooking
  //- 機場代碼浮水印
  .PageBooking__watermark TPE

  //- 成功畫面
  Transition(name="fade-up")
    .PageBooking__success(v-if="isSuccess")
      NuxtIcon.PageBooking__success-icon(name="mdi:check-circle")
      h2.PageBooking__success-title 訂單送出成功
      p.PageBooking__success-sub ORDER SUBMITTED
      .PageBooking__success-id
        span 訂單編號
        strong {{ storeOrder.currentOrder?.orderId?.slice(0, 8).toUpperCase() }}
      UiButton(type="primary" style="margin-top: 24px; width: 100%" @click="ClickNewOrder") 再次訂車

  //- 表單主體
  template(v-if="!isSuccess")
    //- 步驟進度條
    .PageBooking__steps
      .PageBooking__step(
        v-for="(label, idx) in stepLabels"
        :key="idx"
        :class="{ 'is-active': currentStep === idx + 1, 'is-done': currentStep > idx + 1 }"
      )
        .PageBooking__step-dot
          NuxtIcon(v-if="currentStep > idx + 1" name="mdi:check")
          span(v-else) {{ idx + 1 }}
        span.PageBooking__step-label {{ label }}
      .PageBooking__step-line(
        v-for="i in TOTAL_STEPS - 1"
        :key="'line-' + i"
        :style="{ left: `calc(${(i * 100) / TOTAL_STEPS}% - 12px)` }"
        :class="{ 'is-done': currentStep > i }"
      )

    //- 表單卡片
    .PageBooking__card
      Transition(name="step-slide" mode="out-in")
        //- Step 1
        PassengerBookingStepType(
          v-if="currentStep === 1"
          key="step1"
          v-model:order-type="orderType"
          v-model:pickup-date-time="pickupDateTime"
          v-model:flight-no="flightNo"
          v-model:flight-info="flightInfo"
          @next="GoNext"
        )

        //- Step 2
        PassengerBookingStepRoute(
          v-else-if="currentStep === 2"
          key="step2"
          v-model:pickup-location="pickupLocation"
          v-model:dropoff-location="dropoffLocation"
          v-model:stopovers="stopovers"
          @route-calc="OnRouteCalc"
          @next="GoNext"
          @back="GoBack"
        )

        //- Step 3
        PassengerBookingStepOptions(
          v-else-if="currentStep === 3"
          key="step3"
          v-model:passenger-count="passengerCount"
          v-model:luggage-count="luggageCount"
          v-model:vehicle-type="vehicleType"
          v-model:extra-services="extraServices"
          :distance-km="distanceKm"
          @fare-calc="OnFareCalc"
          @next="GoNext"
          @back="GoBack"
        )

        //- Step 4
        PassengerBookingStepConfirm(
          v-else-if="currentStep === 4"
          key="step4"
          :draft="storeOrder.draft"
          :distance-km="distanceKm"
          :duration-minutes="durationMinutes"
          :estimated-fare="estimatedFare"
          :is-loading="isSubmitting"
          :flight-info="flightInfo"
          @submit="ClickSubmit"
          @back="GoBack"
        )
</template>

<style lang="scss" scoped>
.PageBooking {
  position: relative;
  min-height: 100vh;
  background: var(--da-cream);
  padding: 76px 16px 120px; // 56px nav + 20px gap
  overflow: hidden;

  &__watermark {
    position: fixed;
    top: 80px;
    right: -20px;
    font-family: 'Bebas Neue', sans-serif;
    font-size: 120px;
    color: var(--da-dark);
    opacity: 0.04;
    pointer-events: none;
    user-select: none;
    animation: floatY 8s ease-in-out infinite;
  }

  // ── 步驟進度 ─────────────────────────────────────────────────────────────
  &__steps {
    position: relative;
    display: flex;
    justify-content: space-between;
    margin-bottom: 28px;
    padding: 0 8px;
  }

  &__step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    z-index: 1;
    flex: 1;
  }

  &__step-dot {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid var(--da-gray-pale);
    background: var(--da-cream);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: var(--da-gray-light);
    transition: border-color 0.3s, background 0.3s, color 0.3s;

    .is-active & {
      border-color: var(--da-amber);
      background: var(--da-amber);
      color: #fff;
    }

    .is-done & {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);
      color: var(--da-amber);
    }
  }

  &__step-label {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 11px;
    color: var(--da-gray-light);
    white-space: nowrap;
    transition: color 0.3s;

    .is-active &,
    .is-done & { color: var(--da-amber); }
  }

  &__step-line {
    position: absolute;
    top: 15px;
    width: calc(25% - 28px);
    height: 2px;
    background: var(--da-gray-pale);
    transition: background 0.3s;

    &.is-done { background: var(--da-amber); }

    // 四步驟，三條線
    &:nth-child(5) { left: calc(25% - 0px); }
    &:nth-child(6) { left: calc(50% - 0px); }
    &:nth-child(7) { left: calc(75% - 0px); }
  }

  // ── 表單卡片 ──────────────────────────────────────────────────────────────
  &__card {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-glass-border);
    border-radius: 24px;
    padding: 24px 20px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  }

  // ── 成功畫面 ──────────────────────────────────────────────────────────────
  &__success {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px 16px;
    text-align: center;
  }

  &__success-icon {
    font-size: 64px;
    color: #22c55e;
    margin-bottom: 16px;
  }

  &__success-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 36px;
    color: var(--da-dark);
    letter-spacing: 0.04em;
  }

  &__success-sub {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12px;
    letter-spacing: 0.2em;
    color: var(--da-gray);
    margin-top: 4px;
  }

  &__success-id {
    margin-top: 24px;
    background: var(--da-dark);
    border-radius: 12px;
    padding: 14px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;

    span {
      font-size: 12px;
      color: var(--da-gray-light);
      font-family: 'Barlow Condensed', sans-serif;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    strong {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 28px;
      color: var(--da-amber-light);
      letter-spacing: 0.1em;
    }
  }
}

// ── 動畫 ────────────────────────────────────────────────────────────────────
@keyframes floatY {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }
}

.step-slide-enter-active,
.step-slide-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}

.step-slide-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.step-slide-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

.fade-up-enter-active,
.fade-up-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}

.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
