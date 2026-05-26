<script setup lang="ts">
// Fare V2 — 車資試算機（admin/settings 車資進階規則 section 內嵌）
//
// 用手動輸入的路線訊號組一個合成的 RouteMetrics，呼叫 calculateFareV2 預覽完整明細。
// 規則由父層（settings 頁）以 prop 傳入，與編輯表單同步（即時試算未存的草稿）。

import { calculateFareV2, ORDER_TYPES } from '~shared/pricing';
import type { FareRules, FareBreakdownV2, RouteMetrics, OrderType } from '~shared/pricing';

interface Props {
  /** 父層車資規則草稿（編輯表單同步傳入） */
  rules: FareRules;
}
const props = defineProps<Props>();

const storeConfig = StoreConfig();

// ── 試算輸入 ───────────────────────────────────────────────────
interface CalcInput {
  distanceKm: number;
  staticDurationMin: number;
  pureJamMinutes: number;
  elevationDiffM: number;
  sinuosity: number;
  crossCountyCount: number;
  freewayKm: number;
  pickupTime: string;
  orderType: OrderType;
  vehicleId: string;
  extraIds: string[];
}

function _defaultInput(): CalcInput {
  return {
    distanceKm: 15,
    staticDurationMin: 30,
    pureJamMinutes: 12,
    elevationDiffM: 500,
    sinuosity: 1.4,
    crossCountyCount: 1,
    freewayKm: 10,
    pickupTime: '2026-05-17T08:30',
    orderType: 'airport-pickup',
    vehicleId: storeConfig.EnabledVehicles[0]?.id ?? '',
    extraIds: [],
  };
}

const input = reactive<CalcInput>(_defaultInput());
const result = ref<FareBreakdownV2 | null>(null);
const error = ref('');

// 進場若車型尚未選且 store 已載入 → 補預設首選
watch(
  () => storeConfig.EnabledVehicles,
  (list) => {
    if (!input.vehicleId && list.length > 0) input.vehicleId = list[0].id;
  },
  { immediate: true },
);

// ── Helpers ────────────────────────────────────────────────────

/** 跨縣市數 N → 給 N+1 個非北北桃 county code（讓 computeCrossCountyFee 算出 N 跨） */
const NON_METRO_COUNTY_CODES = ['TXG', 'CHA', 'NAN', 'YUN', 'CYQ', 'TNN', 'KHH'];
function _buildCountiesVisited(crossCount: number): string[] {
  const n = Math.max(0, Math.floor(crossCount));
  // crossingCount = visited.length - 1，故 visited 長度 = n + 1
  return NON_METRO_COUNTY_CODES.slice(0, n + 1);
}

/** 由手動輸入組一個合成 RouteMetrics（試算用，apiSourcesOk 全 true） */
function _buildSyntheticMetrics(): RouteMetrics {
  const staticDurationSec = input.staticDurationMin * 60;
  const durationSec = staticDurationSec + input.pureJamMinutes * 60;
  const freeFlowKmh =
    staticDurationSec > 0 ? input.distanceKm / (staticDurationSec / 3600) : 0;
  return {
    distanceKm: input.distanceKm,
    staticDurationSec,
    durationSec,
    pureJamMinutes: Math.max(0, input.pureJamMinutes),
    freeFlowKmh,
    polylineEncoded: '',
    elevationDiffM: input.elevationDiffM,
    freewayKm: input.freewayKm,
    hasTrunk: false,
    countiesVisited: _buildCountiesVisited(input.crossCountyCount),
    straightLineKm: input.distanceKm,
    sinuosity: input.sinuosity,
    computedAt: Date.now(),
    apiSourcesOk: { routes: true, elevation: true, osm: true, counties: true },
  };
}

const _numberFields: Array<keyof CalcInput> = [
  'distanceKm',
  'staticDurationMin',
  'pureJamMinutes',
  'elevationDiffM',
  'sinuosity',
  'crossCountyCount',
  'freewayKm',
];

function _validate(): string {
  for (const field of _numberFields) {
    const v = input[field];
    if (typeof v !== 'number' || Number.isNaN(v)) return '所有數字欄位皆必填且需為有效數字';
  }
  if (!input.vehicleId) return '請選擇車型';
  if (!input.pickupTime) return '請選擇上車時間';
  const t = new Date(input.pickupTime);
  if (Number.isNaN(t.getTime())) return '上車時間格式無效';
  return '';
}

// ── 試算 ───────────────────────────────────────────────────────
const ClickCalculate = () => {
  const err = _validate();
  if (err) {
    error.value = err;
    result.value = null;
    return;
  }
  const vehicle = storeConfig.GetVehicle(input.vehicleId);
  if (!vehicle) {
    error.value = '找不到所選車型資料';
    result.value = null;
    return;
  }
  const extras = input.extraIds
    .map((id) => storeConfig.GetExtra(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => ({ price: e.price }));
  error.value = '';
  result.value = calculateFareV2(
    vehicle,
    _buildSyntheticMetrics(),
    new Date(input.pickupTime),
    extras,
    props.rules,
    input.orderType,
  );
};

const ClickReset = () => {
  Object.assign(input, _defaultInput());
  result.value = null;
  error.value = '';
};

// ── 顯示輔助 ───────────────────────────────────────────────────
const fmt = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-US');
};
</script>

<template lang="pug">
.AdminFareCalculatorPreview
  .AdminFareCalculatorPreview__head
    span.AdminFareCalculatorPreview__head-label CALCULATOR
    span.AdminFareCalculatorPreview__head-title 試算機
    span.AdminFareCalculatorPreview__head-hint 使用目前表單規則即時試算（未儲存的草稿也會套用）

  .AdminFareCalculatorPreview__grid
    //- 數字輸入
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 路線距離 (km)
      ElInput(
        v-model.number="input.distanceKm"
        type="number"
        inputmode="numeric"
      )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label staticDuration (min)
      ElInput(
        v-model.number="input.staticDurationMin"
        type="number"
        inputmode="numeric"
      )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 純塞車分鐘 (min)
      ElInput(
        v-model.number="input.pureJamMinutes"
        type="number"
        inputmode="numeric"
      )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 海拔起伏 (m)
      ElInput(
        v-model.number="input.elevationDiffM"
        type="number"
        inputmode="numeric"
      )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 曲折度
      ElInput(
        v-model.number="input.sinuosity"
        type="number"
        inputmode="numeric"
      )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 跨縣市數
      ElInput(
        v-model.number="input.crossCountyCount"
        type="number"
        inputmode="numeric"
      )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 國道里程 (km)
      ElInput(
        v-model.number="input.freewayKm"
        type="number"
        inputmode="numeric"
      )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 上車時間
      ElInput(
        v-model="input.pickupTime"
        type="datetime-local"
      )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 行程類型
      ElSelect(v-model="input.orderType")
        ElOption(
          v-for="o in ORDER_TYPES"
          :key="o.value"
          :label="o.label"
          :value="o.value"
        )
    .AdminFareCalculatorPreview__field
      label.AdminFareCalculatorPreview__label 車型
      ElSelect(
        v-model="input.vehicleId"
        placeholder="選擇車型"
      )
        ElOption(
          v-for="v in storeConfig.EnabledVehicles"
          :key="v.id"
          :label="v.label.zh"
          :value="v.id"
        )
    .AdminFareCalculatorPreview__field.is-wide
      label.AdminFareCalculatorPreview__label 加值服務（可複選）
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

  .AdminFareCalculatorPreview__actions
    button.AdminFareCalculatorPreview__btn.is-secondary(@click="ClickReset") 重設
    button.AdminFareCalculatorPreview__btn.is-primary(@click="ClickCalculate") 計算車資

  .AdminFareCalculatorPreview__error(v-if="error") ⚠️ {{ error }}

  //- 結果明細：逐項金額相加 − 優惠折抵 = 小計（進位前）
  //- 起跳費 floor：里程費 < 起跳費 → 顯示「起跳費」單行；否則 → 顯示「里程費」單行（已含起跳）
  .AdminFareCalculatorPreview__result(v-if="result")
    .AdminFareCalculatorPreview__result-title 計算結果（規則版本 v{{ result.rulesVersion }}）
    .AdminFareCalculatorPreview__line(v-if="result.distanceFee < result.baseFare")
      span.AdminFareCalculatorPreview__line-key
        | 起跳費（里程費 NT$ {{ fmt(result.distanceFee) }} &lt; 起跳，套 floor）
        | {{ result.mountainMul !== 1 ? `（山區 ×${result.mountainMul}）` : '' }}
      span.AdminFareCalculatorPreview__line-val
        | NT$ {{ fmt(result.chargedDistanceFee * result.mountainMul) }}
    .AdminFareCalculatorPreview__line(v-else)
      span.AdminFareCalculatorPreview__line-key
        | 里程費（含起跳）{{ result.mountainMul !== 1 ? `（山區 ×${result.mountainMul}）` : '' }}
      span.AdminFareCalculatorPreview__line-val
        | NT$ {{ fmt(result.chargedDistanceFee * result.mountainMul) }}
    .AdminFareCalculatorPreview__line
      span.AdminFareCalculatorPreview__line-key 顛峰塞車{{ result.mountainMul !== 1 ? `（山區 ×${result.mountainMul}）` : '' }}
      span.AdminFareCalculatorPreview__line-val +NT$ {{ fmt(result.jamFee * result.mountainMul) }}
    .AdminFareCalculatorPreview__line
      span.AdminFareCalculatorPreview__line-key 跨縣市補貼
      span.AdminFareCalculatorPreview__line-val +NT$ {{ fmt(result.crossCountyFee) }}
    .AdminFareCalculatorPreview__line
      span.AdminFareCalculatorPreview__line-key 國道通行費
      span.AdminFareCalculatorPreview__line-val +NT$ {{ fmt(result.freewayToll) }}
    .AdminFareCalculatorPreview__line
      span.AdminFareCalculatorPreview__line-key 加值服務
      span.AdminFareCalculatorPreview__line-val +NT$ {{ fmt(result.extrasSum) }}
    .AdminFareCalculatorPreview__line
      span.AdminFareCalculatorPreview__line-key 時段加價
      span.AdminFareCalculatorPreview__line-val +NT$ {{ fmt(result.surcharge) }}
    .AdminFareCalculatorPreview__line
      span.AdminFareCalculatorPreview__line-key 優惠折抵
      span.AdminFareCalculatorPreview__line-val −NT$ {{ fmt(result.promoDiscount) }}
    .AdminFareCalculatorPreview__line.is-raw
      span.AdminFareCalculatorPreview__line-key 小計（進位前）
      span.AdminFareCalculatorPreview__line-val NT$ {{ fmt(result.raw) }}
    .AdminFareCalculatorPreview__line.is-final
      span.AdminFareCalculatorPreview__line-key 最終車資（進位 {{ props.rules.rounding }} 元）
      span.AdminFareCalculatorPreview__line-val NT$ {{ fmt(result.final) }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.4);
$border: rgba(255, 255, 255, 0.08);

.AdminFareCalculatorPreview {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(212, 134, 10, 0.25);
  border-radius: 12px;
  padding: 16px;
  margin: 12px 16px 4px;
}

.AdminFareCalculatorPreview__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.AdminFareCalculatorPreview__head-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: $amber;
  background: rgba($amber, 0.1);
  border: 1px solid rgba($amber, 0.25);
  border-radius: 100px;
  padding: 2px 8px;
}

.AdminFareCalculatorPreview__head-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
}

.AdminFareCalculatorPreview__head-hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
}

.AdminFareCalculatorPreview__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 767.98px) {
  .AdminFareCalculatorPreview__grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 479.98px) {
  .AdminFareCalculatorPreview__grid { grid-template-columns: 1fr; }
}

.AdminFareCalculatorPreview__field {
  display: flex;
  flex-direction: column;
  gap: 5px;

  &.is-wide { grid-column: 1 / -1; }
}

.AdminFareCalculatorPreview__label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: $muted;
}

.AdminFareCalculatorPreview__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.AdminFareCalculatorPreview__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 8px 18px;
  border-radius: 9px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;

  &.is-primary {
    background: $amber;
    color: #fff;
    &:hover { background: darken($amber, 6%); }
  }

  &.is-secondary {
    background: rgba(255, 255, 255, 0.05);
    border-color: $border;
    color: rgba(255, 255, 255, 0.7);
    &:hover { background: rgba(255, 255, 255, 0.1); }
  }
}

.AdminFareCalculatorPreview__error {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 200, 0, 0.85);
  background: rgba(255, 200, 0, 0.08);
  border: 1px solid rgba(255, 200, 0, 0.25);
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 12px;
}

.AdminFareCalculatorPreview__result {
  margin-top: 14px;
  border: 1px solid rgba($amber, 0.3);
  border-radius: 10px;
  overflow: hidden;
}

.AdminFareCalculatorPreview__result-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: $amber;
  background: rgba($amber, 0.08);
  padding: 8px 14px;
  border-bottom: 1px solid rgba($amber, 0.2);
}

.AdminFareCalculatorPreview__line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  &:last-child { border-bottom: none; }

  &.is-raw {
    background: rgba(255, 255, 255, 0.03);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  &.is-final {
    background: rgba($amber, 0.12);
    border-top: 1px solid rgba($amber, 0.3);
  }
}

.AdminFareCalculatorPreview__line-key {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.AdminFareCalculatorPreview__line-val {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.AdminFareCalculatorPreview__line.is-final .AdminFareCalculatorPreview__line-key,
.AdminFareCalculatorPreview__line.is-final .AdminFareCalculatorPreview__line-val {
  color: #f5c842;
  font-size: 15px;
}
</style>
