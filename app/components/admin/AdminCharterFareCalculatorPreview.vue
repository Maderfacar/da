<script setup lang="ts">
// Charter Fare V1 — 包車車資試算機（admin/settings 車資進階規則 section 內嵌）
//
// 純前端 calculateCharterFareV2（不打 Routes API，避免 admin 試算消耗額度）；
// distanceKm / 山區三訊號 / 來回 / actualEndTime 全由 admin 手動 toggle / 輸入。
//
// W3 範圍；W4 後 booking 端會走 server 編排（getCharterRouteWithFare）真實打 Routes 算來回。

import {
  calculateCharterFareV2,
  computeOvertimeBlocks,
} from '~shared/pricing';
import type {
  CharterFareBreakdownV2,
  CharterPlanKey,
  FareRules,
  RouteMetrics,
} from '~shared/pricing';

interface Props {
  /** 父層車資規則草稿（編輯表單同步傳入） */
  rules: FareRules;
}
const props = defineProps<Props>();

const storeConfig = StoreConfig();

const CHARTER_PLAN_KEYS: ReadonlyArray<CharterPlanKey> = ['4h', '8h', '10h'];
const CHARTER_PLAN_KEY_TO_HOURS: Readonly<Record<CharterPlanKey, number>> = {
  '4h': 4,
  '8h': 8,
  '10h': 10,
};

// ── 試算輸入 ───────────────────────────────────────────────────
interface CalcInput {
  vehicleId: string;
  days: number;
  /** 長度與 days 同步；W3 試算機鎖 7 段 plan key，days < 7 時忽略多餘段 */
  planKeys: CharterPlanKey[];
  distanceKm: number;
  pickupTime: string;
  /** 空字串 → 不算 OT */
  actualEndTime: string;
  /** 山區三訊號 toggle（任一 off → 該訊號 0 分） */
  mountainElevation: boolean;
  mountainSinuosity: boolean;
  mountainFreeFlow: boolean;
  isRoundTrip: boolean;
  extraIds: string[];
}

// 先取第一個有 charterPlans 的車型，否則空字串
const _enabledCharterVehicles = computed(() =>
  storeConfig.EnabledVehicles.filter((v) => {
    if (!v.charterPlans) return false;
    return CHARTER_PLAN_KEYS.some((k) => v.charterPlans?.[k]?.enabled);
  }),
);

function _defaultInput(): CalcInput {
  const firstVehicle = _enabledCharterVehicles.value[0];
  return {
    vehicleId: firstVehicle?.id ?? '',
    days: 1,
    planKeys: ['8h', '8h', '8h', '8h', '8h', '8h', '8h'],
    distanceKm: 120,
    pickupTime: '2026-05-29T08:00',
    actualEndTime: '',
    mountainElevation: false,
    mountainSinuosity: false,
    mountainFreeFlow: false,
    isRoundTrip: false,
    extraIds: [],
  };
}

const input = reactive<CalcInput>(_defaultInput());
const result = ref<CharterFareBreakdownV2 | null>(null);
const overtimeBlocksDisplay = ref<number>(0);
const error = ref('');

// 進場若車型尚未選且 store 已載入 → 補預設首選（charterPlans 齊全的）
watch(
  _enabledCharterVehicles,
  (list) => {
    if (!input.vehicleId && list.length > 0) input.vehicleId = list[0]!.id;
  },
  { immediate: true },
);

// ── Helpers ────────────────────────────────────────────────────

/** 合成一個 RouteMetrics（試算用，apiSourcesOk 全 true；訊號未達標 → 給「不達標」數值） */
function _buildSyntheticMetrics(): RouteMetrics {
  const m = props.rules.mountain;
  const elevationDiffM = input.mountainElevation ? m.thresholdElevationDiffM + 100 : 0;
  const sinuosity = input.mountainSinuosity ? m.thresholdSinuosity + 0.1 : 1.0;
  const freeFlowKmh = input.mountainFreeFlow ? Math.max(0, m.thresholdFreeFlowKmh - 5) : 80;
  return {
    distanceKm: input.distanceKm,
    staticDurationSec: 0,
    durationSec: 0,
    pureJamMinutes: 0,
    freeFlowKmh,
    polylineEncoded: '',
    elevationDiffM,
    freewayKm: 0,
    hasTrunk: false,
    // 視窗 1：charter 引擎不算 surfaceSurcharge，但 RouteMetrics 仍需 highway/surface 欄位
    highwayKm: input.distanceKm,
    surfaceKm: 0,
    countiesVisited: [],
    straightLineKm: input.distanceKm,
    sinuosity,
    computedAt: Date.now(),
    apiSourcesOk: { routes: true, elevation: true, osm: true, counties: true },
  };
}

/** 由 pickupTime + plans 算 estimatedEndTime（plans 時長 hours 累加） */
function _computeEstimatedEnd(pickup: Date, plans: CharterPlanKey[]): Date {
  const totalHours = plans.reduce((s, k) => s + CHARTER_PLAN_KEY_TO_HOURS[k], 0);
  return new Date(pickup.getTime() + totalHours * 3600 * 1000);
}

function _validate(): string {
  if (!input.vehicleId) return '請選擇車型';
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 7) return '天數必須是 1-7';
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) return '距離必須 ≥ 0';
  if (!input.pickupTime) return '請選擇上車時間';
  const t = new Date(input.pickupTime);
  if (Number.isNaN(t.getTime())) return '上車時間格式無效';
  if (input.actualEndTime) {
    const ae = new Date(input.actualEndTime);
    if (Number.isNaN(ae.getTime())) return 'actualEndTime 格式無效';
  }
  // 每天 plan 必須是合法 key + 對應車型 plan 有設定且 enabled
  const vehicle = storeConfig.GetVehicle(input.vehicleId);
  if (!vehicle?.charterPlans) return '所選車型尚未設定包車套餐';
  for (let i = 0; i < input.days; i++) {
    const k = input.planKeys[i];
    if (!k || !(CHARTER_PLAN_KEYS as ReadonlyArray<string>).includes(k)) {
      return `Day ${i + 1} 的 plan 未選`;
    }
    const plan = vehicle.charterPlans[k];
    if (!plan || !plan.enabled) {
      return `Day ${i + 1}：車型「${vehicle.label.zh}」未啟用 ${k} 套餐`;
    }
  }
  return '';
}

// ── 試算 ───────────────────────────────────────────────────────
const ClickCalculate = () => {
  const err = _validate();
  if (err) {
    error.value = err;
    result.value = null;
    overtimeBlocksDisplay.value = 0;
    return;
  }
  const vehicle = storeConfig.GetVehicle(input.vehicleId);
  if (!vehicle) {
    error.value = '找不到所選車型資料';
    result.value = null;
    overtimeBlocksDisplay.value = 0;
    return;
  }
  const pickup = new Date(input.pickupTime);
  const planKeys = input.planKeys.slice(0, input.days);
  const estimatedEnd = _computeEstimatedEnd(pickup, planKeys);
  const actualEnd = input.actualEndTime ? new Date(input.actualEndTime) : null;
  const extras = input.extraIds
    .map((id) => storeConfig.GetExtra(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => ({ price: e.price }));
  error.value = '';
  try {
    result.value = calculateCharterFareV2(
      vehicle,
      planKeys,
      _buildSyntheticMetrics(),
      input.isRoundTrip,
      pickup,
      estimatedEnd,
      actualEnd,
      extras,
      props.rules,
    );
    overtimeBlocksDisplay.value = computeOvertimeBlocks(estimatedEnd, actualEnd, props.rules.charter);
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err);
    result.value = null;
    overtimeBlocksDisplay.value = 0;
  }
};

const ClickReset = () => {
  Object.assign(input, _defaultInput());
  result.value = null;
  overtimeBlocksDisplay.value = 0;
  error.value = '';
};

// 切換 days 時若某 plan 沒選過先用 8h fallback
watch(
  () => input.days,
  (d) => {
    for (let i = 0; i < d; i++) {
      if (!input.planKeys[i]) input.planKeys[i] = '8h';
    }
  },
  { immediate: true },
);

// ── 顯示輔助 ───────────────────────────────────────────────────
const fmt = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-US');
};

// estimatedEnd 顯示用（即時推算）
const estimatedEndDisplay = computed(() => {
  if (!input.pickupTime) return '';
  const pickup = new Date(input.pickupTime);
  if (Number.isNaN(pickup.getTime())) return '';
  const planKeys = input.planKeys.slice(0, input.days);
  const end = _computeEstimatedEnd(pickup, planKeys);
  return end.toLocaleString('zh-TW', { hour12: false });
});
</script>

<template lang="pug">
.AdminCharterFareCalculatorPreview
  .AdminCharterFareCalculatorPreview__head
    span.AdminCharterFareCalculatorPreview__head-label CHARTER CALC
    span.AdminCharterFareCalculatorPreview__head-title 包車試算機
    span.AdminCharterFareCalculatorPreview__head-hint
      | 純前端 calculateCharterFareV2（不打 Routes API）；山區 / 來回手動 toggle。

  .AdminCharterFareCalculatorPreview__grid
    .AdminCharterFareCalculatorPreview__field
      label.AdminCharterFareCalculatorPreview__label 車型（需有 charterPlans）
      ElSelect(
        v-model="input.vehicleId"
        placeholder="選擇車型"
      )
        ElOption(
          v-for="v in _enabledCharterVehicles"
          :key="v.id"
          :label="v.label.zh"
          :value="v.id"
        )
    .AdminCharterFareCalculatorPreview__field
      label.AdminCharterFareCalculatorPreview__label 天數（1-7）
      ElSelect(v-model.number="input.days")
        ElOption(v-for="d in 7" :key="d" :label="`${d} 天`" :value="d")
    .AdminCharterFareCalculatorPreview__field
      label.AdminCharterFareCalculatorPreview__label 路線距離 (km)
      ElInput(
        v-model.number="input.distanceKm"
        type="number"
        inputmode="numeric"
      )
    .AdminCharterFareCalculatorPreview__field
      label.AdminCharterFareCalculatorPreview__label 上車時間
      ElInput(
        v-model="input.pickupTime"
        type="datetime-local"
        lang="en-GB"
      )
    .AdminCharterFareCalculatorPreview__field
      label.AdminCharterFareCalculatorPreview__label actualEndTime（空 = 不算 OT）
      ElInput(
        v-model="input.actualEndTime"
        type="datetime-local"
        lang="en-GB"
      )
    .AdminCharterFareCalculatorPreview__field
      label.AdminCharterFareCalculatorPreview__label 預估結束（自動推算）
      ElInput(
        :model-value="estimatedEndDisplay"
        disabled
      )

  //- 每天 plan picker
  .AdminCharterFareCalculatorPreview__plans
    .AdminCharterFareCalculatorPreview__plans-head 每日 plan 選擇
    .AdminCharterFareCalculatorPreview__plan-row(
      v-for="(_, i) in input.days"
      :key="i"
    )
      label.AdminCharterFareCalculatorPreview__plan-label Day {{ i + 1 }}
      ElSelect(
        v-model="input.planKeys[i]"
        style="flex:1"
      )
        ElOption(
          v-for="k in CHARTER_PLAN_KEYS"
          :key="k"
          :label="`${k}（${CHARTER_PLAN_KEY_TO_HOURS[k]} 小時）`"
          :value="k"
        )

  //- 山區 / 來回訊號 + extras
  .AdminCharterFareCalculatorPreview__signals
    .AdminCharterFareCalculatorPreview__signals-head 訊號 toggle
    .AdminCharterFareCalculatorPreview__signals-row
      label.AdminCharterFareCalculatorPreview__signal-label
        input(type="checkbox" v-model="input.mountainElevation")
        span 海拔起伏達標
      label.AdminCharterFareCalculatorPreview__signal-label
        input(type="checkbox" v-model="input.mountainSinuosity")
        span 曲折度達標
      label.AdminCharterFareCalculatorPreview__signal-label
        input(type="checkbox" v-model="input.mountainFreeFlow")
        span 無塞車時速達標
      label.AdminCharterFareCalculatorPreview__signal-label
        input(type="checkbox" v-model="input.isRoundTrip")
        span 來回（手動 override）

  .AdminCharterFareCalculatorPreview__extras
    label.AdminCharterFareCalculatorPreview__label 加值服務（可複選）
    ElSelect(
      v-model="input.extraIds"
      multiple
      clearable
      value-on-clear=""
      placeholder="選擇加值服務"
    )
      ElOption(
        v-for="e in storeConfig.EnabledExtras"
        :key="e.id"
        :label="`${e.label.zh}（NT$ ${e.price}）`"
        :value="e.id"
      )

  .AdminCharterFareCalculatorPreview__actions
    button.AdminCharterFareCalculatorPreview__btn.is-secondary(@click="ClickReset") 重設
    button.AdminCharterFareCalculatorPreview__btn.is-primary(@click="ClickCalculate") 計算包車車資

  .AdminCharterFareCalculatorPreview__error(v-if="error") ⚠️ {{ error }}

  //- 結果明細
  .AdminCharterFareCalculatorPreview__result(v-if="result")
    .AdminCharterFareCalculatorPreview__result-title
      | 計算結果（charter rounding {{ props.rules.charter.rounding }} 元）

    //- daysBreakdown 表格
    .AdminCharterFareCalculatorPreview__days
      .AdminCharterFareCalculatorPreview__day(
        v-for="d in result.daysBreakdown"
        :key="d.day"
      )
        span.AdminCharterFareCalculatorPreview__day-key Day {{ d.day }} · {{ d.planKey }}
        span.AdminCharterFareCalculatorPreview__day-val NT$ {{ fmt(d.basePrice) }}

    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key planBasePriceSum
      span.AdminCharterFareCalculatorPreview__line-val NT$ {{ fmt(result.planBasePriceSum) }}
    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key 超公里加收（B）
      span.AdminCharterFareCalculatorPreview__line-val +NT$ {{ fmt(result.extraKmCharge) }}
    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key baseLayer (A + B)
      span.AdminCharterFareCalculatorPreview__line-val NT$ {{ fmt(result.baseLayer) }}
    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key 山區係數 ×{{ result.mountainMul }}
      span.AdminCharterFareCalculatorPreview__line-val NT$ {{ fmt(result.mountainScaled) }}
    //- 來回固定加收暫停用（2026-06-17，公式 line 950）；roundTripFee 強制 0，不渲染避免誤導
    .AdminCharterFareCalculatorPreview__line(v-if="result.roundTripFee > 0")
      span.AdminCharterFareCalculatorPreview__line-key 來回（C）
      span.AdminCharterFareCalculatorPreview__line-val +NT$ {{ fmt(result.roundTripFee) }}
    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key 過夜（D，nights = days - 1）
      span.AdminCharterFareCalculatorPreview__line-val +NT$ {{ fmt(result.overnightFee) }}
    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key OT 段（{{ overtimeBlocksDisplay }} × dayOne OT 30min）
      span.AdminCharterFareCalculatorPreview__line-val +NT$ {{ fmt(result.overtimeCharge) }}
    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key 加值服務（F）
      span.AdminCharterFareCalculatorPreview__line-val +NT$ {{ fmt(result.extrasTotal) }}
    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key 時段加價（G）
      span.AdminCharterFareCalculatorPreview__line-val +NT$ {{ fmt(result.surcharge) }}
    .AdminCharterFareCalculatorPreview__line
      span.AdminCharterFareCalculatorPreview__line-key 優惠折抵（H）
      span.AdminCharterFareCalculatorPreview__line-val −NT$ {{ fmt(result.promoDiscount) }}
    .AdminCharterFareCalculatorPreview__line.is-raw
      span.AdminCharterFareCalculatorPreview__line-key 小計（進位前）
      span.AdminCharterFareCalculatorPreview__line-val NT$ {{ fmt(result.raw) }}
    .AdminCharterFareCalculatorPreview__line.is-final
      span.AdminCharterFareCalculatorPreview__line-key 最終包車車資（進位 {{ props.rules.charter.rounding }} 元）
      span.AdminCharterFareCalculatorPreview__line-val NT$ {{ fmt(result.final) }}
</template>

<style lang="scss" scoped>



.AdminCharterFareCalculatorPreview {
  background: var(--ink-a20);
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-md);
  padding: 16px;
  margin: 12px 16px 16px;
}

.AdminCharterFareCalculatorPreview__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.AdminCharterFareCalculatorPreview__head-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--accent);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-pill);
  padding: 2px 8px;
}

.AdminCharterFareCalculatorPreview__head-title {
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  color: var(--surface-a82);
}

.AdminCharterFareCalculatorPreview__head-hint {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--surface-a40);
}

.AdminCharterFareCalculatorPreview__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 767.98px) {
  .AdminCharterFareCalculatorPreview__grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 479.98px) {
  .AdminCharterFareCalculatorPreview__grid { grid-template-columns: 1fr; }
}

.AdminCharterFareCalculatorPreview__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.AdminCharterFareCalculatorPreview__label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--surface-a40);
}

.AdminCharterFareCalculatorPreview__plans {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px dashed var(--surface-a06);
  border-radius: var(--r-md);
}

.AdminCharterFareCalculatorPreview__plans-head {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--surface-a60);
  margin-bottom: 8px;
}

.AdminCharterFareCalculatorPreview__plan-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.AdminCharterFareCalculatorPreview__plan-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  color: var(--surface-a72);
  min-width: 64px;
}

.AdminCharterFareCalculatorPreview__signals {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px dashed var(--surface-a06);
  border-radius: var(--r-md);
}

.AdminCharterFareCalculatorPreview__signals-head {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  text-transform: uppercase;
  color: var(--surface-a60);
  margin-bottom: 8px;
}

.AdminCharterFareCalculatorPreview__signals-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.AdminCharterFareCalculatorPreview__signal-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a72);
  cursor: pointer;
  user-select: none;

  input[type="checkbox"] {
    accent-color: var(--accent);
    cursor: pointer;
  }
}

.AdminCharterFareCalculatorPreview__extras {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 12px;
}

.AdminCharterFareCalculatorPreview__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.AdminCharterFareCalculatorPreview__btn {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 8px 18px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &.is-primary {
    background: var(--accent);
    color: var(--surface-raised);
    &:hover { background: var(--accent-deep); }
  }

  &.is-secondary {
    background: var(--surface-a06);
    border-color: var(--surface-a06);
    color: var(--surface-a72);
    &:hover { background: var(--surface-a12); }
  }
}

.AdminCharterFareCalculatorPreview__error {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--wait);
  background: var(--wait-a08);
  border: 1px solid var(--wait-a30);
  border-radius: var(--r-sm);
  padding: 8px 12px;
  margin-top: 12px;
}

.AdminCharterFareCalculatorPreview__result {
  margin-top: 14px;
  border: 1px solid var(--accent-a30);
  border-radius: var(--r-md);
  overflow: hidden;
}

.AdminCharterFareCalculatorPreview__result-title {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-a06);
  padding: 8px 14px;
  border-bottom: 1px solid var(--accent-a20);
}

.AdminCharterFareCalculatorPreview__days {
  display: flex;
  flex-direction: column;
  background: var(--ink-a12);
  border-bottom: 1px solid var(--surface-a06);
}

.AdminCharterFareCalculatorPreview__day {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 14px;
  border-bottom: 1px solid var(--surface-a06);

  &:last-child { border-bottom: none; }
}

.AdminCharterFareCalculatorPreview__day-key {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a72);
}

.AdminCharterFareCalculatorPreview__day-val {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  color: var(--surface-a82);
}

.AdminCharterFareCalculatorPreview__line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--surface-a06);

  &:last-child { border-bottom: none; }

  &.is-raw {
    background: var(--surface-a06);
    border-top: 1px solid var(--surface-a12);
  }

  &.is-final {
    background: var(--accent-a12);
    border-top: 1px solid var(--accent-a30);
  }
}

.AdminCharterFareCalculatorPreview__line-key {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--surface-a72);
}

.AdminCharterFareCalculatorPreview__line-val {
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  color: var(--surface-a88);
}

.AdminCharterFareCalculatorPreview__line.is-final .AdminCharterFareCalculatorPreview__line-key,
.AdminCharterFareCalculatorPreview__line.is-final .AdminCharterFareCalculatorPreview__line-val {
  color: var(--da-stripe-yellow);
  font-size: var(--fs-body);
}
</style>
