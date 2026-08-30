<script setup lang="ts">
import {
  calculateCharterFareV2,
  calculateFareV2,
  type VehicleType,
  type FleetVehicle,
  type OrderType,
  type CharterPlanKey,
  type CharterFareBreakdownV2,
} from '~shared/pricing';
import type { GooglePlace, MapsRouteRes } from '~/protocol/fetch-api/api/maps';
import type { TagDto } from '@/protocol/fetch-api/api/tag';

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

// ── 車資試算（Fare V2：明細由 server 計算；charter 走 server 完整 RouteMetrics + client charter 引擎）─
const fareResult = ref<MapsRouteRes | null>(null);
const fareLoading = ref(false);
const charterResult = ref<CharterFareBreakdownV2 | null>(null);
// charter 路線回應另存一份（含 routeMetrics / isRoundTrip）—— 供車型卡並排比價用；
// 非 charter 直接讀 fareResult.routeMetrics
const charterRouteRes = ref<MapsRouteRes | null>(null);
let _fareTimer: ReturnType<typeof setTimeout> | null = null;

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
  // 2026-06-30 修：charter 也走完整 RouteMetrics（server 端 orderType=charter 會回 elevation/OSM/counties +
  // isRoundTrip + returnLegPolyline）— 預估山區係數 = 真實值，避免「乘客看到 8000、扣款 13000」UX 地雷。
  const res = await $api.GetMapsRoute({
    origin: `${props.pickupLocation.lat},${props.pickupLocation.lng}`,
    destination: `${props.dropoffLocation.lat},${props.dropoffLocation.lng}`,
    ...(validWps.length ? { waypoints: validWps.map((s) => `${s.lat},${s.lng}`).join('|') } : {}),
    orderType: 'charter',
  });
  fareLoading.value = false;
  if (res.status.code !== 200 || !res.data || !res.data.routeMetrics) {
    emit('charterCalc', null);
    return;
  }
  charterRouteRes.value = res.data;

  const pickup = props.pickupDateTime ? new Date(props.pickupDateTime) : new Date();
  const totalHours = planKeys.reduce((s, k) => s + CHARTER_PLAN_KEY_TO_HOURS[k], 0);
  const estimatedEnd = new Date(pickup.getTime() + totalHours * 3600 * 1000);
  // 預估階段不算 extras（與 fare-v2 booking 預估行為一致；server 編排會用真實 fleet extras 重算）
  const extras: ReadonlyArray<{ price: number }> = [];

  try {
    const breakdown = calculateCharterFareV2(
      fleetVehicle,
      planKeys,
      res.data.routeMetrics,
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

// ── 待辦②：車型橫向卡並排比價（取代 Swiper 輪播）────────────────────────────
// 一次 route 回應（routeMetrics 與車型無關）+ 共用純函式引擎，算出全部車型的估價，
// 讓價差在同一屏並排看得到。
//
// ⚠ 跨端公式一致性（feedback-cross-version-formula-consistency）：
//   client 與 server 用同一支 calculateFareV2、同一份 routeMetrics（server 回的）、
//   同一份 fareRules（StoreConfig 從 /nuxt-api/config/fleet 撈，TTL 30s）。
//   「選中車型」一律以 server 回傳的 fareTotal 蓋掉 client 估值 —— 卡片上的數字
//   與明細卡、第四步、落帳永遠同源，其他車型的數字只是比價參考。
const vehiclePriceMap = computed<Record<string, number | null>>(() => {
  const map: Record<string, number | null> = {};
  const rules = storeConfig.fareRules;
  const pickup = props.pickupDateTime ? new Date(props.pickupDateTime) : new Date();

  if (isCharter.value) {
    const routeRes = charterRouteRes.value;
    const planKeys = props.charterPlanKeys.slice(0, props.charterDays);
    const totalHours = planKeys.reduce((s, k) => s + (CHARTER_PLAN_KEY_TO_HOURS[k] ?? 0), 0);
    const estimatedEnd = new Date(pickup.getTime() + totalHours * 3600 * 1000);
    for (const v of storeConfig.EnabledVehicles) {
      if (!routeRes?.routeMetrics || !rules || planKeys.length !== props.charterDays || planKeys.length === 0) {
        map[v.id] = null;
        continue;
      }
      if (planKeys.some((k) => !v.charterPlans?.[k]?.enabled)) {
        map[v.id] = null;
        continue;
      }
      try {
        map[v.id] = calculateCharterFareV2(
          v, planKeys, routeRes.routeMetrics, routeRes.isRoundTrip ?? false,
          pickup, estimatedEnd, null, [], rules,
        ).final;
      } catch {
        map[v.id] = null;
      }
    }
    if (charterResult.value && vehicle.value) map[vehicle.value] = charterResult.value.final;
    return map;
  }

  const metrics = fareResult.value?.routeMetrics ?? null;
  const extraObjs = storeConfig.EnabledExtras.filter((e) => extras.value.includes(e.id));
  for (const v of storeConfig.EnabledVehicles) {
    if (!metrics || !rules) {
      map[v.id] = null;
      continue;
    }
    try {
      map[v.id] = calculateFareV2(v, metrics, pickup, extraObjs, rules, props.orderType ?? null).final;
    } catch {
      map[v.id] = null;
    }
  }
  if (fareResult.value?.fareTotal != null && vehicle.value) map[vehicle.value] = fareResult.value.fareTotal;
  return map;
});

const FmtPrice = (n: number): string => Math.round(n).toLocaleString('en-US');
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

  //- 待辦②：橫向捲動卡（scroll-snap），2 張以上同屏、每張帶預估價 —— 價差並排看得到。
  //- 路線未估出前價格顯示「—」（例如尚未填地點就直接跳到第三步）。
  .PassengerBookingStepOptions__vehicle-scroll
    .PassengerBookingStepOptions__vehicle-card(
      v-for="cfg in vehicles"
      :key="cfg.id"
      :class="{ 'is-active': vehicle === cfg.id, 'is-disabled': cfg.status === 'disabled', 'is-warn': cfg.status === 'warn' }"
      @click="ClickVehicle(cfg)"
    )
      //- 主視覺：有 images.exterior 顯示縮圖，否則 fallback mdi icon
      .PassengerBookingStepOptions__vehicle-hero(v-if="cfg.images?.exterior")
        img.PassengerBookingStepOptions__vehicle-hero-img(:src="cfg.images.exterior" :alt="cfg.label.en" loading="lazy")
      .PassengerBookingStepOptions__vehicle-hero.is-icon(v-else)
        NuxtIcon.PassengerBookingStepOptions__vehicle-hero-icon(:name="cfg.icon")
      .PassengerBookingStepOptions__vehicle-body
        .PassengerBookingStepOptions__vehicle-name {{ Loc(cfg.label) }}
        .PassengerBookingStepOptions__vehicle-specs
          span
            NuxtIcon(name="mdi:account-group")
            | {{ cfg.capacity }}{{ $t('fleet.unit.person') }}
          span(v-if="cfg.luggageDescription && Loc(cfg.luggageDescription)")
            NuxtIcon(name="mdi:bag-suitcase")
            | {{ Loc(cfg.luggageDescription) }}
        //- 預估價：這台車跑這趟路線的價格（選中車型 = server 數字，其餘為同引擎比價參考）
        .PassengerBookingStepOptions__vehicle-price
          span.PassengerBookingStepOptions__vehicle-price-currency NT$
          span.PassengerBookingStepOptions__vehicle-price-value(v-if="vehiclePriceMap[cfg.id] != null") {{ FmtPrice(vehiclePriceMap[cfg.id] ?? 0) }}
          span.PassengerBookingStepOptions__vehicle-price-value.is-empty(v-else) —
        .PassengerBookingStepOptions__vehicle-hint(v-if="cfg.hint") {{ cfg.hint }}

  //- 加值服務（位置：車型卡之後、期望特徵之前；charter 訂單預估階段不算入車資，server 編排會以實際 fleet extras 重算）
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

  //- 待辦③：預估車資卡（點擊就地展開明細，不用等到第四步）
  //- 資料同源：非 charter 用 server 回應的 fareBreakdown / routeMetrics；charter 用 client 引擎明細
  PassengerFareBreakdownCard(
    :fare-total="isCharter ? (charterResult?.final ?? null) : (fareResult?.fareTotal ?? null)"
    :loading="fareLoading"
    :breakdown="isCharter ? null : (fareResult?.fareBreakdown ?? null)"
    :metrics="fareResult?.routeMetrics ?? null"
    :charter-breakdown="isCharter ? charterResult : null"
  )

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
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--ls-kicker);
    text-transform: uppercase;
    color: var(--accent-text);
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
    font-family: var(--ff-display);
    font-size: var(--fs-h1);
    color: var(--da-dark);
    letter-spacing: var(--ls-snug);
    margin-top: -8px;
  }

  &__counters {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  &__counter {
    background: var(--surface-raised);
    border: 1px solid var(--da-gray-pale);
    border-radius: var(--r-lg);
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
    font-family: var(--ff-ui);
    font-size: var(--fs-body-sm);
    color: var(--da-dark);
    font-weight: 500;
  }

  &__counter-hint {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    letter-spacing: var(--ls-label);
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
      border-radius: var(--r-round);
      border: 1.5px solid var(--da-amber);
      background: none;
      color: var(--accent-text);
      font-size: var(--fs-h4);
      font-weight: 700;
      cursor: pointer;
      transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover:not(:disabled) { background: var(--da-amber-pale); }
      &:disabled { opacity: 0.35; cursor: not-allowed; }
    }

    span {
      font-family: var(--ff-display);
      font-size: var(--fs-h1);
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
    background: var(--surface-raised);
    border: 1px solid var(--da-gray-pale);
    border-radius: var(--r-lg);
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
    font-family: var(--ff-ui);
    font-size: var(--fs-body);
    color: var(--da-dark);
    line-height: var(--lh-tight);
  }

  &__luggage-ctrl {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;

    button {
      width: 28px;
      height: 28px;
      border-radius: var(--r-round);
      border: 1.5px solid var(--da-amber);
      background: none;
      color: var(--accent-text);
      font-size: var(--fs-body-lg);
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover { background: var(--da-amber-pale); }
    }

    span {
      font-family: var(--ff-display);
      font-size: var(--fs-h2);
      color: var(--da-dark);
      min-width: 20px;
      text-align: center;
    }
  }

  // ── 待辦②：車型橫向卡（scroll-snap 並排比價）────────────────────────
  // 卡寬收到 164px：390px 屏一屏看得到 2 張多一點，價差直接並排。
  // 負 margin + padding 讓捲動溢出貼齊頁面 gutter，捲軸隱藏。
  &__vehicle-scroll {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    margin: 0 -4px;
    padding: 4px 4px 6px;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  &__vehicle-scroll::-webkit-scrollbar { display: none; }

  &__vehicle-card {
    flex: none;
    width: 164px;
    scroll-snap-align: start;
    background: var(--surface-raised);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: var(--r-lg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
    position: relative;
    box-sizing: border-box;

    &.is-active {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);
      box-shadow: var(--shadow-soft);
    }

    &.is-warn { border-color: var(--wait); }

    &.is-disabled {
      opacity: 0.45;
      cursor: not-allowed;
      border-color: var(--stop);
    }

    @media (min-width: 768px) {
      width: 200px;
    }
  }

  // 固定高 hero；價格行永遠渲染（估不出顯示 —），卡高不因內容缺項晃動
  &__vehicle-hero {
    flex: none;
    height: 96px;
    overflow: hidden;
    background: var(--ink-a06);
    display: flex;
    align-items: center;
    justify-content: center;

    &.is-icon {
      background: var(--ink-a06);
    }
  }

  &__vehicle-hero-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &__vehicle-hero-icon {
    font-size: var(--fs-h1);
    opacity: 0.55;
  }

  &__vehicle-body {
    flex: 1;
    min-height: 0;
    padding: 10px 12px 12px;
    background: var(--surface-a82);
    border-top: 1px solid var(--surface-a72);
    display: flex;
    flex-direction: column;
    gap: 4px;

    .is-active & {
      background: color-mix(in srgb, var(--accent-wash) 88%, transparent);
    }
  }

  &__vehicle-name {
    font-family: var(--ff-ui);
    font-size: var(--fs-body);
    font-weight: 700;
    color: var(--da-dark);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__vehicle-specs {
    display: flex;
    gap: 8px;
    font-size: var(--fs-label);
    color: var(--da-gray);
    align-items: center;
    flex-wrap: wrap;

    span {
      display: flex;
      align-items: center;
      gap: 3px;
      white-space: nowrap;
    }
  }

  // 價格 = 這張卡存在的理由，字階拉到卡內最大；幣別小字，金額 data 字
  &__vehicle-price {
    margin-top: auto;
    padding-top: 6px;
    display: flex;
    align-items: baseline;
    gap: 3px;
  }

  &__vehicle-price-currency {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    letter-spacing: var(--ls-label);
    color: var(--da-gray);
  }

  &__vehicle-price-value {
    font-family: var(--ff-data);
    font-variant-numeric: lining-nums tabular-nums;
    font-size: var(--fs-h3);
    font-weight: 700;
    color: var(--da-dark);

    .is-active & { color: var(--accent-text); }

    &.is-empty {
      color: var(--da-gray-light);
      font-weight: 400;
    }
  }

  &__vehicle-hint {
    font-size: var(--fs-label);
    font-family: var(--ff-ui);

    .is-disabled & { color: var(--stop); }
    .is-warn & { color: var(--wait); }
  }

  // ── Charter Fare V1 W4：每日 plan picker ────────────────────────────────
  &__charter-plans {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    background: var(--da-amber-pale);
    border: 1px dashed var(--da-amber);
    border-radius: var(--r-lg);
  }

  &__charter-plan-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  &__charter-plan-label {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--ls-wide);
    color: var(--accent-text);
    min-width: 56px;
  }

  &__charter-hint {
    font-family: var(--ff-ui);
    font-size: var(--fs-label);
    color: var(--da-gray);
    margin: 6px 0 0;
    line-height: var(--lh-normal);
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
    background: var(--surface-raised);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: var(--r-lg);
    cursor: pointer;
    font-size: var(--fs-body-sm);
    color: var(--da-dark);
    text-align: center;
    transition: border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out);
    font-family: var(--ff-ui);

    .nuxt-icon { font-size: var(--fs-h2); color: var(--da-gray-light); }

    &.is-active {
      border-color: var(--da-amber);
      background: var(--da-amber-pale);

      .nuxt-icon { color: var(--da-amber); }
    }
  }

  &__extra-price {
    font-size: var(--fs-label);
    color: var(--accent-text);
    font-family: var(--ff-ui);
  }

  // ── 期望特徵 可摺疊卡片（承襲 PassengerFaqList 的 cream theme collapsible 風格）
  &__expectations {
    background: var(--surface-raised);
    border: 1.5px solid var(--da-gray-pale);
    border-radius: var(--r-lg);
    overflow: hidden;
    transition: border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out);

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
    font-family: var(--ff-display);
    font-size: var(--fs-h2);
    color: var(--da-dark);
    letter-spacing: var(--ls-snug);
    line-height: var(--lh-tight);
    margin: 0;
  }

  &__expectations-hint {
    font-family: var(--ff-ui);
    font-size: var(--fs-label);
    color: var(--da-gray);
    line-height: var(--lh-normal);
  }

  &__expectations-mark {
    width: 32px;
    height: 32px;
    border-radius: var(--r-round);
    border: 1.5px solid var(--da-amber);
    background: var(--da-cream);
    color: var(--da-amber);
    font-family: var(--ff-display);
    font-size: var(--fs-h2);
    line-height: var(--lh-flat);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    user-select: none;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-out);

    .PassengerBookingStepOptions__expectations-header:hover & {
      background: var(--da-amber-pale);
      transform: scale(1.05);
    }

    .is-open & {
      background: var(--da-amber);
      color: var(--surface-raised);
    }
  }

  &__expectations-body {
    padding: 4px 16px 16px;
  }

  // 未選車型時的下一步提示
  &__next-hint {
    margin: 0 0 -6px;
    font-family: var(--ff-ui);
    font-size: var(--fs-label);
    color: var(--stop);
    text-align: center;
    line-height: var(--lh-normal);
  }

  &__actions {
    display: flex;
    gap: 12px;
  }
}

// ── expectations 展開動畫 ───────────────────────────────────────────
.expectations-expand-enter-active,
.expectations-expand-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.expectations-expand-enter-from,
.expectations-expand-leave-to {
  opacity: 0;
}
</style>
