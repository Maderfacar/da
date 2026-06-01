<script setup lang="ts">
// 計費沙盒 — admin 試算機；走 prod fare-v2 編排（getRouteWithFare）+ 命中規則明細。
import type { OrderType, CharterPlanKey } from '~shared/pricing';
import type { AdminFareSimulateBody, AdminFareSimulateRes } from '@/protocol/fetch-api/api/admin';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const storeConfig = StoreConfig();
const { locale } = useI18n();

// ── 輸入 ────────────────────────────────────────────────────────
interface LatLngInput {
  lat: number;
  lng: number;
}

const origin = reactive<LatLngInput>({ lat: 25.0797, lng: 121.2342 });   // 桃機 T1 預設
const destination = reactive<LatLngInput>({ lat: 25.0330, lng: 121.5654 }); // 台北 101 預設
const stopovers = ref<LatLngInput[]>([]);
const vehicleId = ref('sedan-suv');
const pickupTime = ref(new Date().toISOString().slice(0, 16)); // datetime-local
const orderType = ref<OrderType>('airport-pickup');
const selectedExtras = ref<string[]>([]);

// charter 模式
const charterDays = ref(1);
const charterPlanKeys = ref<CharterPlanKey[]>(['4h']);

const isCharter = computed(() => orderType.value === 'charter');

// 加值服務勾選
const TOGGLE = (id: string) => {
  const i = selectedExtras.value.indexOf(id);
  if (i === -1) selectedExtras.value.push(id);
  else selectedExtras.value.splice(i, 1);
};

const Loc = (label: { zh: string; en: string; ja: string } | undefined) =>
  storeConfig.LabelOf(label, locale.value as 'zh' | 'en' | 'ja');

// stopover 操作
const AddStopover = () => stopovers.value.push({ lat: 0, lng: 0 });
const RemoveStopover = (idx: number) => stopovers.value.splice(idx, 1);

// charter plan 操作
const SetCharterDays = (days: number) => {
  charterDays.value = Math.max(1, Math.min(7, days));
  while (charterPlanKeys.value.length < charterDays.value) charterPlanKeys.value.push('8h');
  while (charterPlanKeys.value.length > charterDays.value) charterPlanKeys.value.pop();
};

// ── 試算結果 ────────────────────────────────────────────────────
const loading = ref(false);
const errorMsg = ref('');
const result = ref<AdminFareSimulateRes | null>(null);

const ApiSimulate = async () => {
  errorMsg.value = '';
  result.value = null;
  loading.value = true;
  try {
    const body: AdminFareSimulateBody = {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      vehicleId: vehicleId.value,
      pickupTime: new Date(pickupTime.value).toISOString(),
      orderType: orderType.value,
      extraIds: [...selectedExtras.value],
    };
    if (stopovers.value.length) {
      body.waypoints = stopovers.value.map((s) => ({ lat: s.lat, lng: s.lng }));
    }
    if (isCharter.value) {
      body.charterDays = charterDays.value;
      body.charterPlanKeys = [...charterPlanKeys.value];
    }
    const res = await $api.PostAdminFareSimulate(body);
    if (res.status?.code !== $enum.apiStatus.success) {
      errorMsg.value = res.status?.message?.zh_tw ?? '試算失敗';
      return;
    }
    result.value = res.data;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : '試算失敗';
  } finally {
    loading.value = false;
  }
};

// ── 顯示 helpers ────────────────────────────────────────────────
const breakdownRows = computed(() => {
  if (!result.value) return [];
  const b = result.value.breakdown as Record<string, number>;
  if (result.value.strategy === 'fare-v1') {
    return [
      { label: '策略', value: 'Fare V1（Routes API 失敗降級）' },
      { label: '距離（km）', value: b.distanceKm },
      { label: '最終車資 NT$', value: b.final, highlight: true },
    ];
  }
  if (result.value.strategy === 'charter') {
    return [
      { label: '策略', value: 'Charter Fare V1' },
      { label: 'plan basePrice 加總', value: b.planBasePriceSum },
      { label: '超公里加收', value: b.extraKmCharge },
      { label: 'baseLayer', value: b.baseLayer },
      { label: '山區係數', value: b.mountainMul },
      { label: 'mountainScaled', value: b.mountainScaled },
      { label: '來回加收', value: b.roundTripFee },
      { label: '過夜加收', value: b.overnightFee },
      { label: 'OT 加收', value: b.overtimeCharge },
      { label: '加值服務', value: b.extrasTotal },
      { label: '時段加價', value: b.surcharge },
      { label: '時段折抵', value: b.promoDiscount },
      { label: '進位前 raw', value: b.raw },
      { label: '最終車資 NT$', value: b.final, highlight: true },
    ];
  }
  // fare-v2
  return [
    { label: '策略', value: `Fare V2 (rules v${b.rulesVersion})` },
    { label: '起跳費', value: b.baseFare },
    { label: '里程費（分段）', value: b.distanceFee },
    { label: '起跳 floor 後', value: b.chargedDistanceFee },
    { label: '塞車費 jamFee', value: b.jamFee },
    { label: 'variableSubtotal', value: b.variableSubtotal },
    { label: '山區係數', value: b.mountainMul },
    { label: 'variableScaled', value: b.variableScaled },
    { label: '跨縣市補貼', value: b.crossCountyFee },
    { label: '國道通行費', value: b.freewayToll },
    { label: '加值服務', value: b.extrasSum },
    { label: '時段加價', value: b.surcharge },
    { label: '時段折抵', value: b.promoDiscount },
    { label: '進位前 raw', value: b.raw },
    { label: `進位（${b.rounding}）後`, value: b.final, highlight: true },
  ];
});

const metricsRows = computed(() => {
  if (!result.value?.metrics) return [];
  const m = result.value.metrics as Record<string, unknown>;
  return [
    { label: 'distanceKm', value: m.distanceKm },
    { label: 'durationSec', value: m.durationSec },
    { label: 'pureJamMinutes', value: m.pureJamMinutes },
    { label: 'freeFlowKmh', value: m.freeFlowKmh },
    { label: 'elevationDiffM', value: m.elevationDiffM },
    { label: 'sinuosity', value: m.sinuosity },
    { label: 'freewayKm', value: m.freewayKm },
    { label: 'countiesVisited', value: Array.isArray(m.countiesVisited) ? (m.countiesVisited as string[]).join(', ') : '—' },
    { label: 'apiSourcesOk', value: JSON.stringify(m.apiSourcesOk) },
  ];
});
</script>

<template lang="pug">
.AdminFareSandbox
  .AdminFareSandbox__head
    NuxtLink.AdminFareSandbox__back(to="/admin/settings") ← 回設定
    h1.AdminFareSandbox__title 計費沙盒
    p.AdminFareSandbox__sub 走 prod fare-v2 編排 + 命中規則明細（同 booking 下單估價路徑）

  .AdminFareSandbox__grid
    //- ── 輸入區 ──────────────────────────────────────────
    section.AdminFareSandbox__panel
      h2.AdminFareSandbox__panel-title 行程輸入

      .AdminFareSandbox__row
        label.AdminFareSandbox__label 上車點 (lat, lng)
        .AdminFareSandbox__pair
          el-input-number(v-model="origin.lat" :precision="6" :step="0.0001" controls-position="right" size="small")
          el-input-number(v-model="origin.lng" :precision="6" :step="0.0001" controls-position="right" size="small")

      .AdminFareSandbox__row
        label.AdminFareSandbox__label 下車點 (lat, lng)
        .AdminFareSandbox__pair
          el-input-number(v-model="destination.lat" :precision="6" :step="0.0001" controls-position="right" size="small")
          el-input-number(v-model="destination.lng" :precision="6" :step="0.0001" controls-position="right" size="small")

      .AdminFareSandbox__row(v-for="(s, idx) in stopovers" :key="idx")
        label.AdminFareSandbox__label 中停 {{ idx + 1 }}
        .AdminFareSandbox__pair
          el-input-number(v-model="s.lat" :precision="6" :step="0.0001" controls-position="right" size="small")
          el-input-number(v-model="s.lng" :precision="6" :step="0.0001" controls-position="right" size="small")
          button.AdminFareSandbox__btn-mini(@click="RemoveStopover(idx)") ×

      .AdminFareSandbox__row
        button.AdminFareSandbox__btn-add(@click="AddStopover") + 加中停

      .AdminFareSandbox__row
        label.AdminFareSandbox__label 上車時間
        input.AdminFareSandbox__input(v-model="pickupTime" type="datetime-local")

      .AdminFareSandbox__row
        label.AdminFareSandbox__label 行程類型
        select.AdminFareSandbox__select(v-model="orderType")
          option(value="airport-pickup") 接機
          option(value="airport-dropoff") 送機
          option(value="transfer") 交通接送
          option(value="charter") 包車

      template(v-if="isCharter")
        .AdminFareSandbox__row
          label.AdminFareSandbox__label 包車天數
          el-input-number(:model-value="charterDays" @update:model-value="SetCharterDays" :min="1" :max="7" controls-position="right" size="small")
        .AdminFareSandbox__row(v-for="(_, di) in charterPlanKeys" :key="di")
          label.AdminFareSandbox__label Day {{ di + 1 }} plan
          select.AdminFareSandbox__select(v-model="charterPlanKeys[di]")
            option(value="4h") 4 小時
            option(value="8h") 8 小時
            option(value="10h") 10 小時

      .AdminFareSandbox__row
        label.AdminFareSandbox__label 車型
        select.AdminFareSandbox__select(v-model="vehicleId")
          option(v-for="v in storeConfig.EnabledVehicles" :key="v.id" :value="v.id") {{ v.label.zh }} ({{ v.id }})

      .AdminFareSandbox__row
        label.AdminFareSandbox__label 加值服務
        .AdminFareSandbox__chips
          button.AdminFareSandbox__chip(
            v-for="e in storeConfig.EnabledExtras"
            :key="e.id"
            :class="{ 'is-on': selectedExtras.includes(e.id) }"
            type="button"
            @click="TOGGLE(e.id)"
          ) {{ Loc(e.label) }} +{{ e.price }}

      .AdminFareSandbox__actions
        button.AdminFareSandbox__btn(:disabled="loading" @click="ApiSimulate")
          | {{ loading ? '試算中…' : '試算' }}

      .AdminFareSandbox__error(v-if="errorMsg") {{ errorMsg }}

    //- ── 輸出區 ──────────────────────────────────────────
    section.AdminFareSandbox__panel
      h2.AdminFareSandbox__panel-title 試算結果
      .AdminFareSandbox__empty(v-if="!result") 點「試算」開始

      template(v-if="result")
        .AdminFareSandbox__strategy-badge(:class="`is-${result.strategy}`")
          | {{ result.strategy }}
        .AdminFareSandbox__roundtrip(v-if="result.isRoundTrip !== undefined")
          | 來回判定：{{ result.isRoundTrip ? '✅ 命中' : '❌ 未命中' }}

        h3.AdminFareSandbox__section-title 車資明細
        .AdminFareSandbox__rows
          .AdminFareSandbox__breakdown-row(
            v-for="row in breakdownRows"
            :key="row.label"
            :class="{ 'is-highlight': row.highlight }"
          )
            span.AdminFareSandbox__breakdown-label {{ row.label }}
            span.AdminFareSandbox__breakdown-val {{ row.value }}

        template(v-if="metricsRows.length")
          h3.AdminFareSandbox__section-title 路線訊號
          .AdminFareSandbox__rows
            .AdminFareSandbox__breakdown-row(v-for="row in metricsRows" :key="row.label")
              span.AdminFareSandbox__breakdown-label {{ row.label }}
              span.AdminFareSandbox__breakdown-val {{ row.value }}

        h3.AdminFareSandbox__section-title 命中規則
        .AdminFareSandbox__hits
          .AdminFareSandbox__hit
            .AdminFareSandbox__hit-name 山區
            .AdminFareSandbox__hit-val 分數 {{ result.hits.mountain.score }}／3 · 係數 ×{{ result.hits.mountain.multiplier }}
          .AdminFareSandbox__hit
            .AdminFareSandbox__hit-name 跨縣市
            .AdminFareSandbox__hit-val 跨 {{ result.hits.crossCounty.crossings }} 次 · 補貼 NT$ {{ result.hits.crossCounty.fee }}
            .AdminFareSandbox__hit-sub 訪問：{{ result.hits.crossCounty.visited.join(', ') || '—' }}
          .AdminFareSandbox__hit
            .AdminFareSandbox__hit-name 顛峰
            .AdminFareSandbox__hit-val(:class="{ 'is-on': result.hits.peak.active }")
              | {{ result.hits.peak.active ? '✅ 命中' : '❌' }} · jamFee NT$ {{ result.hits.peak.jamFee }}
          .AdminFareSandbox__hit
            .AdminFareSandbox__hit-name 時段加價
            .AdminFareSandbox__hit-val(:class="{ 'is-on': result.hits.surcharge.active }")
              | {{ result.hits.surcharge.active ? '✅ 命中' : '❌' }} · NT$ +{{ result.hits.surcharge.amount }}
          .AdminFareSandbox__hit
            .AdminFareSandbox__hit-name 時段折抵
            .AdminFareSandbox__hit-val(:class="{ 'is-on': result.hits.promo.active }")
              | {{ result.hits.promo.active ? '✅ 命中' : '❌' }} · NT$ −{{ result.hits.promo.discount }}
</template>

<style lang="scss" scoped>
$cream-bg: #f7f0e6;
$cream-panel: #ffffff;
$ink: #2c1810;
$muted: #8a7a68;
$border: #e3d6c4;
$accent: #c0392b;
$accent-soft: #e8d5d0;

.AdminFareSandbox {
  padding: 24px;
  background: $cream-bg;
  min-height: 100vh;
  color: $ink;
}

.AdminFareSandbox__head {
  margin-bottom: 24px;
}

.AdminFareSandbox__back {
  display: inline-block;
  color: $muted;
  font-size: 13px;
  text-decoration: none;
  margin-bottom: 8px;

  &:hover { color: $accent; }
}

.AdminFareSandbox__title {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 4px;
}

.AdminFareSandbox__sub {
  color: $muted;
  margin: 0;
  font-size: 13px;
}

.AdminFareSandbox__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
}

.AdminFareSandbox__panel {
  background: $cream-panel;
  border: 1px solid $border;
  border-radius: 12px;
  padding: 18px 20px;
}

.AdminFareSandbox__panel-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid $border;
}

.AdminFareSandbox__row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.AdminFareSandbox__label {
  flex: 0 0 110px;
  font-size: 13px;
  color: $muted;
}

.AdminFareSandbox__pair {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
}

.AdminFareSandbox__input,
.AdminFareSandbox__select {
  flex: 1;
  border: 1px solid $border;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 14px;
  background: #fff;
  color: $ink;
}

.AdminFareSandbox__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}

.AdminFareSandbox__chip {
  border: 1px solid $border;
  background: #fff;
  color: $ink;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 120ms;

  &.is-on {
    background: $accent;
    color: #fff;
    border-color: $accent;
  }
}

.AdminFareSandbox__btn-mini {
  background: none;
  border: 1px solid $border;
  color: $accent;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 14px;
}

.AdminFareSandbox__btn-add {
  background: none;
  border: 1px dashed $border;
  color: $muted;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
  margin-left: 122px;
}

.AdminFareSandbox__actions {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid $border;
}

.AdminFareSandbox__btn {
  background: $accent;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.AdminFareSandbox__error {
  margin-top: 12px;
  padding: 10px 12px;
  background: $accent-soft;
  border-radius: 6px;
  color: $accent;
  font-size: 13px;
}

.AdminFareSandbox__empty {
  color: $muted;
  font-size: 13px;
  padding: 24px 0;
  text-align: center;
}

.AdminFareSandbox__strategy-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 12px;

  &.is-fare-v2 { background: #e8f0d5; color: #4a6b00; }
  &.is-fare-v1 { background: #fff3d5; color: #8a5a00; }
  &.is-charter { background: #d5e0f0; color: #1a4a8a; }
}

.AdminFareSandbox__roundtrip {
  font-size: 12px;
  color: $muted;
  margin-bottom: 12px;
}

.AdminFareSandbox__section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 16px 0 8px;
  color: $accent;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.AdminFareSandbox__rows {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid $border;
  border-radius: 6px;
  overflow: hidden;
}

.AdminFareSandbox__breakdown-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid $border;

  &:last-child { border-bottom: none; }
  &.is-highlight {
    background: $accent-soft;
    font-weight: 700;
  }
}

.AdminFareSandbox__breakdown-label {
  color: $muted;
}

.AdminFareSandbox__breakdown-val {
  color: $ink;
  font-variant-numeric: tabular-nums;
}

.AdminFareSandbox__hits {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.AdminFareSandbox__hit {
  border: 1px solid $border;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
}

.AdminFareSandbox__hit-name {
  font-weight: 600;
  color: $accent;
  margin-bottom: 2px;
}

.AdminFareSandbox__hit-val {
  color: $ink;

  &.is-on { color: $accent; font-weight: 600; }
}

.AdminFareSandbox__hit-sub {
  color: $muted;
  font-size: 11px;
  margin-top: 2px;
}
</style>
