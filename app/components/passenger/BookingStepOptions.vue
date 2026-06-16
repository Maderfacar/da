<script setup lang="ts">
import {
  calculateCharterFareV2,
  type VehicleType,
  type FleetVehicle,
  type OrderType,
  type CharterPlanKey,
  type CharterFareBreakdownV2,
  type RouteMetrics,
} from '~shared/pricing';
import type { GooglePlace, MapsRouteRes } from '~/protocol/fetch-api/api/maps';
import type { TagDto } from '@/protocol/fetch-api/api/tag';
import { Swiper, SwiperSlide } from 'swiper/vue';
import { Navigation } from 'swiper/modules';
import type { Swiper as SwiperInstance } from 'swiper/types';
import 'swiper/css';
import 'swiper/css/navigation';

export interface LuggageItem { typeId: string; count: number }

interface Props {
  /** Booking v2 批次 2：大人 / 兒童拆分 stepper */
  adultCount: number;
  childCount: number;
  luggageItems: LuggageItem[];
  vehicleType: VehicleType;
  // Fare V2：明細由 server 計算，需路線 + 上車時間
  pickupLocation: GooglePlace | null;
  dropoffLocation: GooglePlace | null;
  stopovers: GooglePlace[];
  pickupDateTime: string;
  /** 行程類型 — 供 Fare V2 時段規則的行程過濾 */
  orderType: OrderType | undefined;
  /** Charter Fare V1 W4：包車天數（1-7）— charter 訂單必填，其他訂單忽略 */
  charterDays?: number;
  /** Charter Fare V1 W4：每日 plan key 陣列（length 應 = days）— charter 訂單必填，其他訂單忽略 */
  charterPlanKeys?: CharterPlanKey[];
  /** Booking v2：vehicle-scope active tags（已 filter 掉 vehicleType group） */
  availableTags?: TagDto[];
  /** Booking v2：當前勾選的偏好 tag id */
  selectedTagIds?: string[];
  /** 加值服務 id 陣列（fleet_extras） */
  extraServices?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  charterDays: 1,
  charterPlanKeys: () => [] as CharterPlanKey[],
  availableTags: () => [] as TagDto[],
  selectedTagIds: () => [] as string[],
  extraServices: () => [] as string[],
});

const emit = defineEmits<{
  (e: 'update:adultCount' | 'update:childCount' | 'fareCalc', val: number): void;
  (e: 'update:luggageItems', val: LuggageItem[]): void;
  (e: 'update:vehicleType', val: VehicleType): void;
  (e: 'update:selectedTagIds' | 'update:extraServices', val: string[]): void;
  (e: 'update:charterPlanKeys', val: CharterPlanKey[]): void;
  (e: 'fareResult', val: MapsRouteRes): void;
  (e: 'charterCalc', val: CharterFareBreakdownV2 | null): void;
  (e: 'next' | 'back'): void;
}>();

const { t, locale } = useI18n();

const storeConfig = StoreConfig();

const adults = ref(Math.max(1, props.adultCount));
const children = ref(Math.max(0, props.childCount));
const vehicle = ref<VehicleType>(props.vehicleType);
// 加值服務 — 還原自 booking v2 之前邏輯（4273ef6 前移除，現恢復顯示在 Step 3 車型之後）
const extras = ref<string[]>([...props.extraServices]);
const ToggleExtra = (id: string) => {
  const idx = extras.value.indexOf(id);
  if (idx === -1) extras.value.push(id);
  else extras.value.splice(idx, 1);
};
const isExtraSelected = (id: string) => extras.value.includes(id);

// 期望特徵預設收合；使用者點擊 header 才展開
const expectationsOpen = ref(false);

const totalPax = computed(() => adults.value + children.value);

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

// SU 系統已停用（airport-calibration wave）；保留 luggage count 供下單寫入 / admin 顯示，不再參與容量校驗
const totalLuggageItems = computed(() =>
  luggage.value.reduce((sum, item) => sum + item.count, 0),
);

const Loc = (label: { zh: string; en: string; ja: string } | undefined) =>
  storeConfig.LabelOf(label, locale.value as 'zh' | 'en' | 'ja');

// ── Charter Fare V1 W4：常數 & helpers ─────────────────────────────────────
const CHARTER_PLAN_KEYS: ReadonlyArray<CharterPlanKey> = ['4h', '8h', '10h'];
const CHARTER_PLAN_KEY_TO_HOURS: Readonly<Record<CharterPlanKey, number>> = {
  '4h': 4,
  '8h': 8,
  '10h': 10,
};

const isCharter = computed(() => props.orderType === 'charter');

// 該車型有任一 enabled charterPlan（charter 模式下沒有任何 plan 的車型不可選）
const _vehicleHasCharterPlans = (v: FleetVehicle): boolean => {
  if (!v.charterPlans) return false;
  return CHARTER_PLAN_KEYS.some((k) => v.charterPlans?.[k]?.enabled);
};

// ── 車型容量校驗（SU 已停用，只剩座位 + charter plan）─────────────────────
type VehicleStatus = 'ok' | 'warn' | 'disabled';
const _GetVehicleStatus = (v: FleetVehicle): VehicleStatus => {
  if (totalPax.value > v.capacity) return 'disabled';
  // Charter Fare V1 W4：charter 模式下，車型若無啟用任一 plan → 不可選
  if (isCharter.value && !_vehicleHasCharterPlans(v)) return 'disabled';
  return 'ok';
};

const _GetVehicleHint = (v: FleetVehicle): string => {
  if (totalPax.value > v.capacity) return t('booking.options.exceedCapacity', { n: v.capacity });
  if (isCharter.value && !_vehicleHasCharterPlans(v)) return t('booking.options.charterNotOpen');
  return '';
};

const vehicles = computed(() =>
  storeConfig.EnabledVehicles.map((v) => ({
    ...v,
    status: _GetVehicleStatus(v),
    hint: _GetVehicleHint(v),
  })),
);

// 「下一步」必須校驗：當前 vehicle.value 對應到一張存在、且 status !== 'disabled' 的車型卡。
// 防止 fleet_vehicles 重整後 draft.vehicleType 對不上任何車型（會送出 0 元訂單）。
const selectedVehicleCard = computed(() =>
  vehicles.value.find((v) => v.id === vehicle.value),
);
const canGoNext = computed(
  () => !!selectedVehicleCard.value && selectedVehicleCard.value.status !== 'disabled',
);

const luggageTypes = computed(() => storeConfig.luggageTypes);

// ── 車資試算（Fare V2：明細由 server 計算；charter 走純幾何 + client charter 引擎）─
const fareResult = ref<MapsRouteRes | null>(null);
const fareLoading = ref(false);
const charterResult = ref<CharterFareBreakdownV2 | null>(null);
let _fareTimer: ReturnType<typeof setTimeout> | null = null;

// charter 估價：純幾何模式取 isRoundTrip + distanceKm → client calculateCharterFareV2（mountain 訊號取不到一律 1.0；下訂時 server 編排會用真實 Routes API 重算）
const _BuildCharterMetrics = (distanceKm: number): RouteMetrics => ({
  distanceKm,
  staticDurationSec: 0,
  durationSec: 0,
  pureJamMinutes: 0,
  freeFlowKmh: 80,
  polylineEncoded: '',
  elevationDiffM: 0,
  freewayKm: 0,
  hasTrunk: false,
  countiesVisited: [],
  straightLineKm: distanceKm,
  sinuosity: 1.0,
  computedAt: Date.now(),
  // 預估階段不打 elevation / OSM / counties → 三 source 全 false（mountain 訊號 0 分 → 山區係數 1.0）
  apiSourcesOk: { routes: true, elevation: false, osm: false, counties: false },
});

const ApiFetchCharterFare = async () => {
  charterResult.value = null;
  if (!props.pickupLocation || !props.dropoffLocation || !vehicle.value) {
    emit('charterCalc', null);
    return;
  }
  const fleetVehicle = storeConfig.GetVehicle(vehicle.value);
  if (!fleetVehicle || !_vehicleHasCharterPlans(fleetVehicle)) {
    emit('charterCalc', null);
    return;
  }
  const planKeys = props.charterPlanKeys.slice(0, props.charterDays);
  if (planKeys.length !== props.charterDays || planKeys.length === 0) {
    emit('charterCalc', null);
    return;
  }
  // 校驗每個 planKey 都對應有效 plan
  for (const k of planKeys) {
    if (!fleetVehicle.charterPlans?.[k]?.enabled) {
      emit('charterCalc', null);
      return;
    }
  }

  fareLoading.value = true;
  const validWps = props.stopovers.filter((s) => s.lat !== 0);
  // 純幾何模式：不帶 vehicleType / pickupTime，但帶 orderType=charter（server 會回 isRoundTrip + returnLegPolyline）
  const res = await $api.GetMapsRoute({
    origin: `${props.pickupLocation.lat},${props.pickupLocation.lng}`,
    destination: `${props.dropoffLocation.lat},${props.dropoffLocation.lng}`,
    ...(validWps.length ? { waypoints: validWps.map((s) => `${s.lat},${s.lng}`).join('|') } : {}),
    orderType: 'charter',
  });
  fareLoading.value = false;
  if (res.status.code !== 200 || !res.data) {
    emit('charterCalc', null);
    return;
  }

  const pickup = props.pickupDateTime ? new Date(props.pickupDateTime) : new Date();
  const totalHours = planKeys.reduce((s, k) => s + CHARTER_PLAN_KEY_TO_HOURS[k], 0);
  const estimatedEnd = new Date(pickup.getTime() + totalHours * 3600 * 1000);
  // 預估階段不算 extras（與 fare-v2 booking 預估行為一致；server 編排會用真實 fleet extras 重算）
  const extras: ReadonlyArray<{ price: number }> = [];

  try {
    const breakdown = calculateCharterFareV2(
      fleetVehicle,
      planKeys,
      _BuildCharterMetrics(res.data.distance_km),
      res.data.isRoundTrip ?? false,
      pickup,
      estimatedEnd,
      null, // booking 估價階段無 actualEndTime → OT = 0
      extras,
      storeConfig.fareRules,
    );
    charterResult.value = breakdown;
    emit('fareCalc', breakdown.final);
    emit('charterCalc', breakdown);
  } catch (err) {
    // engine throw（plan 缺等）→ silent；status 已守在前面
    console.error('[BookingStepOptions] charter calc failed:', err);
    emit('charterCalc', null);
  }
};

const ApiFetchFare = async () => {
  if (!props.pickupLocation || !props.dropoffLocation || !vehicle.value) return;
  if (isCharter.value) {
    await ApiFetchCharterFare();
    return;
  }
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

// vehicle 變動 → debounce 重新估價
const FareFetchFlow = () => {
  if (_fareTimer) clearTimeout(_fareTimer);
  _fareTimer = setTimeout(ApiFetchFare, 400);
};

// charter days / planKeys 變動 → debounce 重新估價（charter only）
watch(
  () => [props.charterDays, props.charterPlanKeys.slice(0, props.charterDays).join(',')],
  () => { if (isCharter.value) FareFetchFlow(); },
);
watch(isCharter, () => FareFetchFlow());

// Plan picker 單格變動 → emit 完整 charterPlanKeys（補齊到 days 長度）
const OnUpdateCharterPlan = (idx: number, val: CharterPlanKey) => {
  const next: CharterPlanKey[] = [];
  for (let i = 0; i < props.charterDays; i++) {
    if (i === idx) next.push(val);
    else next.push(props.charterPlanKeys[i] ?? '8h');
  }
  emit('update:charterPlanKeys', next);
};

// ── Sync ────────────────────────────────────────────────────────────────────
watch(adults, (val) => emit('update:adultCount', val));
watch(children, (val) => emit('update:childCount', val));
watch(luggage, (val) => emit('update:luggageItems', val), { deep: true });
watch(vehicle, (val) => { emit('update:vehicleType', val); FareFetchFlow(); });
watch(extras, (val) => { emit('update:extraServices', val); FareFetchFlow(); }, { deep: true });

onMounted(ApiFetchFare);

const ClickVehicle = (v: FleetVehicle) => {
  const status = _GetVehicleStatus(v);
  if (status === 'disabled') return;
  vehicle.value = v.id;
};

// 若當前選擇的車型變 disabled（人數超出），自動切到第一個 ok 車型
watch([adults, children, totalLuggageItems], () => {
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

// ── Booking v2：期望特徵 chip（直接顯示、不再摺疊）──────────────────────────
const HandleUpdateTags = (next: string[]) => {
  emit('update:selectedTagIds', next);
};

// ── Booking v2 批次 2：車型卡 Swiper Slider ──────────────────────────────────
const swiperRef = ref<SwiperInstance | null>(null);
const OnSwiperReady = (sw: SwiperInstance) => { swiperRef.value = sw; };
const ClickSwiperPrev = () => swiperRef.value?.slidePrev();
const ClickSwiperNext = () => swiperRef.value?.slideNext();
const swiperModules = [Navigation];
const swiperBreakpoints = {
  0: { slidesPerView: 1.2, spaceBetween: 10 },
  480: { slidesPerView: 1.5, spaceBetween: 12 },
  768: { slidesPerView: 2.2, spaceBetween: 14 },
  1024: { slidesPerView: 2.5, spaceBetween: 16 },
};
</script>

<template lang="pug">
.PassengerBookingStepOptions
  .PassengerBookingStepOptions__section-label PASSENGERS
  h2.PassengerBookingStepOptions__title {{ $t('booking.options.title') }}

  //- Booking v2 批次 2：大人 / 兒童 雙 stepper
  .PassengerBookingStepOptions__counters
    .PassengerBookingStepOptions__counter
      .PassengerBookingStepOptions__counter-info
        span.PassengerBookingStepOptions__counter-label {{ $t('booking.options.adults') }}
        span.PassengerBookingStepOptions__counter-hint {{ $t('booking.options.adultsHint') }}
      .PassengerBookingStepOptions__counter-ctrl
        button(:disabled="adults <= 1" @click="adults = Math.max(1, adults - 1)") −
        span {{ adults }}
        button(@click="adults = Math.min(20, adults + 1)") +
    .PassengerBookingStepOptions__counter
      .PassengerBookingStepOptions__counter-info
        span.PassengerBookingStepOptions__counter-label {{ $t('booking.options.children') }}
        span.PassengerBookingStepOptions__counter-hint {{ $t('booking.options.childrenHint') }}
      .PassengerBookingStepOptions__counter-ctrl
        button(:disabled="children <= 0" @click="children = Math.max(0, children - 1)") −
        span {{ children }}
        button(@click="children = Math.min(20, children + 1)") +

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
      .PassengerBookingStepOptions__luggage-ctrl
        button(@click="_SetLuggageCount(lt.id, _GetLuggageCount(lt.id) - 1)") −
        span {{ _GetLuggageCount(lt.id) }}
        button(@click="_SetLuggageCount(lt.id, _GetLuggageCount(lt.id) + 1)") +

  //- 車型選擇（批次 2：Swiper Slider）
  .PassengerBookingStepOptions__section-label.mt VEHICLE
  h2.PassengerBookingStepOptions__title {{ $t('booking.options.vehicleTitle') }}

  .PassengerBookingStepOptions__vehicle-slider
    button.PassengerBookingStepOptions__slider-nav.is-prev(
      type="button"
      :aria-label="$t('booking.nav.back')"
      @click="ClickSwiperPrev"
    ) ‹
    Swiper.PassengerBookingStepOptions__swiper(
      :modules="swiperModules"
      :breakpoints="swiperBreakpoints"
      :grab-cursor="true"
      :centered-slides="false"
      :slides-per-view="1.5"
      :space-between="12"
      :watch-overflow="true"
      @swiper="OnSwiperReady"
    )
      SwiperSlide(v-for="cfg in vehicles" :key="cfg.id")
        .PassengerBookingStepOptions__vehicle-card(
          :class="{ 'is-active': vehicle === cfg.id, 'is-disabled': cfg.status === 'disabled', 'is-warn': cfg.status === 'warn' }"
          @click="ClickVehicle(cfg)"
        )
          //- 主視覺：有 images.exterior 顯示縮圖，否則 fallback mdi icon
          .PassengerBookingStepOptions__vehicle-hero(v-if="cfg.images?.exterior")
            img.PassengerBookingStepOptions__vehicle-hero-img(:src="cfg.images.exterior" :alt="cfg.label.en")
          .PassengerBookingStepOptions__vehicle-hero.is-icon(v-else)
            NuxtIcon.PassengerBookingStepOptions__vehicle-hero-icon(:name="cfg.icon")
          //- 毛玻璃文字區
          .PassengerBookingStepOptions__vehicle-body
            .PassengerBookingStepOptions__vehicle-name {{ Loc(cfg.label) }}
            .PassengerBookingStepOptions__vehicle-sub {{ cfg.label.en }}
            .PassengerBookingStepOptions__vehicle-specs
              span
                NuxtIcon(name="mdi:account-group")
                | {{ cfg.capacity }}{{ $t('fleet.unit.person') }}
              span(v-if="cfg.luggageDescription && Loc(cfg.luggageDescription)")
                NuxtIcon(name="mdi:bag-suitcase")
                | {{ Loc(cfg.luggageDescription) }}
            .PassengerBookingStepOptions__vehicle-fare
              | {{ $t('booking.options.baseFare', { fare: cfg.baseFare }) }}
              span + NT${{ cfg.perKmRate }}/km
            .PassengerBookingStepOptions__vehicle-tagline(v-if="cfg.tagline && Loc(cfg.tagline)") {{ Loc(cfg.tagline) }}
            .PassengerBookingStepOptions__vehicle-hint(v-if="cfg.hint") {{ cfg.hint }}
    button.PassengerBookingStepOptions__slider-nav.is-next(
      type="button"
      :aria-label="$t('booking.nav.next')"
      @click="ClickSwiperNext"
    ) ›

  //- 加值服務（位置：車型 swiper 之後、期望特徵之前；charter 訂單預估階段不算入車資，server 編排會以實際 fleet extras 重算）
  template(v-if="storeConfig.EnabledExtras.length")
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

  //- Charter Fare V1 W4：每日 plan picker（charter only；days >= 1 都顯示，days=1 也可選 4h/8h/10h）
  .PassengerBookingStepOptions__charter-plans(v-if="isCharter")
    .PassengerBookingStepOptions__section-label.mt CHARTER PLAN
    h2.PassengerBookingStepOptions__title {{ $t('booking.options.charterPlanTitle', { days: charterDays }) }}
    .PassengerBookingStepOptions__charter-plan-row(
      v-for="(_, i) in charterDays"
      :key="i"
    )
      span.PassengerBookingStepOptions__charter-plan-label {{ $t('booking.options.charterDayLabel', { n: i + 1 }) }}
      ElSelect(
        :model-value="charterPlanKeys[i] ?? '8h'"
        style="flex:1"
        @update:model-value="(v) => OnUpdateCharterPlan(i, v)"
      )
        ElOption(
          v-for="k in CHARTER_PLAN_KEYS"
          :key="k"
          :label="$t('booking.options.charterPlanOption', { hours: CHARTER_PLAN_KEY_TO_HOURS[k] })"
          :value="k"
        )
    p.PassengerBookingStepOptions__charter-hint {{ $t('booking.options.charterPlanHint') }}

  //- 期望特徵（預設收合；整塊包成可點按卡片，承襲 PassengerFaqList 視覺語言）
  template(v-if="availableTags.length")
    .PassengerBookingStepOptions__section-label.mt EXPECTATIONS
    .PassengerBookingStepOptions__expectations(:class="{ 'is-open': expectationsOpen }")
      button.PassengerBookingStepOptions__expectations-header(
        type="button"
        :aria-expanded="expectationsOpen"
        @click="expectationsOpen = !expectationsOpen"
      )
        .PassengerBookingStepOptions__expectations-titles
          h2.PassengerBookingStepOptions__expectations-title {{ $t('booking.preferences.title') }}
          span.PassengerBookingStepOptions__expectations-hint {{ $t('booking.options.passengerHint') }}
        span.PassengerBookingStepOptions__expectations-mark(aria-hidden="true") {{ expectationsOpen ? '−' : '+' }}
      transition(name="expectations-expand")
        .PassengerBookingStepOptions__expectations-body(v-show="expectationsOpen")
          BookingPassengerTagPreferencePicker(
            :tags="availableTags"
            :model-value="selectedTagIds"
            @update:model-value="HandleUpdateTags"
          )

  //- 車資僅在第四步 Confirm 顯示；第三步隱藏預估卡

  //- 未選車型時提示（讓使用者明白為什麼「下一步」按不下去）
  p.PassengerBookingStepOptions__next-hint(v-if="!canGoNext") {{ $t('booking.options.pickVehicleHint') }}

  .PassengerBookingStepOptions__actions
    UiButton(type="secondary" @click="$emit('back')") {{ $t('booking.nav.back') }}
    UiButton(type="primary" :disabled="!canGoNext" @click="canGoNext && $emit('next')") {{ $t('booking.nav.next') }}
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
    gap: 10px;
  }

  &__counter {
    background: var(--da-glass-bg);
    border: 1px solid var(--da-gray-pale);
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  &__counter-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  &__counter-label {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 13px;
    color: var(--da-dark);
    font-weight: 500;
  }

  &__counter-hint {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 0.05em;
    color: var(--da-gray-light);
  }

  &__counter-ctrl {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;

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
      transition: background 0.15s, opacity 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover:not(:disabled) { background: var(--da-amber-pale); }
      &:disabled { opacity: 0.35; cursor: not-allowed; }
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

  // ── Booking v2 批次 2：車型卡 Slider ──────────────────────────────────
  &__vehicle-slider {
    position: relative;
    margin: 0 -4px;
  }

  &__swiper {
    padding: 4px 4px 6px;
    overflow: hidden;
  }

  &__slider-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 5;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--da-gray-pale);
    background: var(--da-cream);
    color: var(--da-dark);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
    transition: background 0.15s, border-color 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background: var(--da-amber-pale);
      border-color: var(--da-amber);
      color: var(--da-amber);
    }

    &:active { transform: translateY(-50%) scale(0.9); }

    &.is-prev { left: -8px; }
    &.is-next { right: -8px; }

    @media (min-width: 768px) {
      width: 36px;
      height: 36px;
      font-size: 22px;
      &.is-prev { left: -10px; }
      &.is-next { right: -10px; }
    }
  }

  &__vehicle-card {
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s, transform 0.2s, box-shadow 0.2s;
    position: relative;
    height: 380px;
    box-sizing: border-box;

    &.is-active {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);
    }

    &.is-warn { border-color: #f59e0b; }

    &.is-disabled {
      opacity: 0.45;
      cursor: not-allowed;
      border-color: #ef4444;
    }
  }

  // 鎖定固定高 220px，body 拿剩餘 160px；不再用 flex:1 避免 tagline/hint v-if 晃動造成圖片高低不一
  &__vehicle-hero {
    flex: none;
    height: 220px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.04);
    display: flex;
    align-items: center;
    justify-content: center;

    &.is-icon {
      background: rgba(0, 0, 0, 0.03);
    }
  }

  &__vehicle-hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &__vehicle-hero-icon {
    font-size: 56px;
    opacity: 0.55;
  }

  &__vehicle-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 14px 18px 16px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    background: rgba(250, 248, 244, 0.82);
    border-top: 1px solid rgba(255, 255, 255, 0.7);
    display: flex;
    flex-direction: column;
    gap: 5px;

    .is-active & {
      background: rgba(255, 245, 220, 0.88);
    }
  }

  &__vehicle-name {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--da-dark);
  }

  &__vehicle-sub {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 0.1em;
    color: var(--da-gray);
  }

  &__vehicle-specs {
    display: flex;
    gap: 10px;
    font-size: 13px;
    color: var(--da-gray);
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
    display: flex;
    gap: 6px;
    align-items: center;
    font-family: 'Barlow', sans-serif;

    span { color: var(--da-amber); font-size: 12px; }
  }

  &__vehicle-tagline {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: var(--da-gray);
    line-height: 1.4;
  }

  &__vehicle-hint {
    font-size: 12px;
    font-family: 'Noto Sans TC', sans-serif;

    .is-disabled & { color: #ef4444; }
    .is-warn & { color: #d97706; }
  }

  // ── Charter Fare V1 W4：每日 plan picker ────────────────────────────────
  &__charter-plans {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    background: var(--da-amber-pale);
    border: 1px dashed var(--da-amber);
    border-radius: 14px;
  }

  &__charter-plan-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__charter-plan-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--da-amber);
    min-width: 56px;
  }

  &__charter-hint {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 11px;
    color: var(--da-gray);
    margin: 6px 0 0;
    line-height: 1.5;
  }

  // ── 加值服務 card grid ───────────────────────────────────────────────
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

  // ── 期望特徵 可摺疊卡片（承襲 PassengerFaqList 的 cream theme collapsible 風格）
  &__expectations {
    background: var(--da-glass-bg);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: 14px;
    overflow: hidden;
    transition: border-color 0.2s, background 0.2s;

    &:hover { border-color: var(--da-amber); }

    &.is-open {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);
    }
  }

  &__expectations-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }

  &__expectations-titles {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  &__expectations-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 22px;
    color: var(--da-dark);
    letter-spacing: 0.02em;
    line-height: 1.1;
    margin: 0;
  }

  &__expectations-hint {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: var(--da-gray);
    line-height: 1.45;
  }

  &__expectations-mark {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1.5px solid var(--da-amber);
    background: var(--da-cream);
    color: var(--da-amber);
    font-family: 'Bebas Neue', sans-serif;
    font-size: 22px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    user-select: none;
    transition: background 0.15s, color 0.15s, transform 0.2s;

    .PassengerBookingStepOptions__expectations-header:hover & {
      background: var(--da-amber-pale);
      transform: scale(1.05);
    }

    .is-open & {
      background: var(--da-amber);
      color: #fff;
    }
  }

  &__expectations-body {
    padding: 4px 16px 16px;
  }

  // 未選車型時的下一步提示
  &__next-hint {
    margin: 0 0 -6px;
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 12px;
    color: #ef4444;
    text-align: center;
    line-height: 1.4;
  }

  &__actions {
    display: flex;
    gap: 12px;
  }
}

// ── expectations 展開動畫 ───────────────────────────────────────────
.expectations-expand-enter-active,
.expectations-expand-leave-active {
  transition: opacity 0.2s ease;
}

.expectations-expand-enter-from,
.expectations-expand-leave-to {
  opacity: 0;
}
</style>
