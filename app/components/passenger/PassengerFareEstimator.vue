<script setup lang="ts">
// 乘客端車資試算機（/fare 頁 TRY IT 區塊）
//
// 規則來源：StoreConfig.fareRules（從 /nuxt-api/config/fleet 拉，與 booking 估價同源）
// 計算：calculateFareV2（~shared/pricing），組合手動輸入 + tag surcharge 為合成 RouteMetrics
//
// 與 admin 試算機（AdminFareCalculatorPreview）的差異：
//   - 欄位精簡（基本 6 + 進階 3）
//   - 偏好標籤改用 chip picker（同 booking PassengerTagPreferencePicker）
//   - cream / glass 配色（admin 為 dark）
//   - 結果只顯示 > 0 的拆解項（避免列一堆 NT$0）
//   - 不顯示「小計」（對乘客太技術）
import {
  buildTagSurchargeIndex,
  calcTagSurcharge,
  calculateFareV2,
  ORDER_TYPES,
  type FareBreakdownV2,
  type OrderType,
  type RouteMetrics,
  type TagSurchargeIndexEntry,
} from '~shared/pricing';
import { TPE_METRO_CODES } from '~shared/geo/county-codes';
import { TAG_GROUPS, TAG_GROUPS_ORDERED, type TagGroup, localizedTagName } from '~shared/tagTaxonomy';
import type { TagDto } from '@/protocol/fetch-api/api/tag';

type Lang = 'zh' | 'en' | 'ja';
type TagLang = 'zh_tw' | 'en' | 'ja';

const storeConfig = StoreConfig();
const { locale, t } = useI18n();

const _normalizeLang = (l: string): Lang => {
  if (l === 'en') return 'en';
  if (l === 'ja') return 'ja';
  return 'zh';
};
const _toTagLang = (l: Lang): TagLang => (l === 'zh' ? 'zh_tw' : l);

const lang = computed<Lang>(() => _normalizeLang(String(locale.value)));

// ── 試算輸入 ───────────────────────────────────────────────────
interface CalcInput {
  distanceKm: number;
  vehicleId: string;
  pickupTime: string;
  orderType: OrderType;
  extraIds: string[];
  selectedTagIds: string[];
  isMountain: boolean;
  crossCountyCount: 0 | 1 | 2 | 3;
  allInTpeMetro: boolean;
  freewayKm: number;
}

/** 預設上車時間 = 明天 09:00（local TZ） */
function _defaultPickupTime(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

function _defaultInput(): CalcInput {
  return {
    distanceKm: 15,
    vehicleId: storeConfig.EnabledVehicles[0]?.id ?? '',
    pickupTime: _defaultPickupTime(),
    orderType: 'airport-pickup',
    extraIds: [],
    selectedTagIds: [],
    isMountain: false,
    crossCountyCount: 0,
    allInTpeMetro: false,
    freewayKm: 0,
  };
}

const input = reactive<CalcInput>(_defaultInput());
const result = ref<FareBreakdownV2 | null>(null);
const error = ref('');
const isAdvancedOpen = ref(false);

// 車型載入後若 vehicleId 仍為空 → 補預設首選
watch(
  () => storeConfig.EnabledVehicles,
  (list) => {
    if (!input.vehicleId && list.length > 0) input.vehicleId = list[0].id;
  },
  { immediate: true },
);

// ── 標籤載入（vehicle-scope, active-only；driverSkill group 不顯示）──────────
const activeVehicleTags = ref<TagDto[]>([]);

const ApiLoadActiveVehicleTags = async () => {
  try {
    const res = await $api.GetActiveTags('vehicle');
    if (res.status?.code === $enum.apiStatus.success && res.data?.tags) {
      // 與 booking 對齊：不顯示 vehicleType group（屬司機端標車屬性）
      activeVehicleTags.value = res.data.tags.filter((t) => t.group !== 'vehicleType');
    }
  } catch { /* silent */ }
};

onMounted(() => { void ApiLoadActiveVehicleTags(); });

// ── 標籤分群顯示（與 booking PassengerTagPreferencePicker 一致）──────────────
const groupedTags = computed(() =>
  TAG_GROUPS_ORDERED
    .filter(([, meta]) => meta.scope === 'vehicle')
    .map(([key, meta]) => ({
      key,
      meta,
      tags: activeVehicleTags.value
        .filter((tag) => tag.group === key && tag.status === 'active')
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((g) => g.tags.length > 0),
);

const IsTagSelected = (id: string) => input.selectedTagIds.includes(id);

const TagLabel = (tag: TagDto) => localizedTagName(tag, _toTagLang(lang.value));

const ClickToggleChip = (tag: TagDto, group: TagGroup) => {
  const meta = TAG_GROUPS[group];
  const cur = input.selectedTagIds;

  if (meta.multiplicity === 'single') {
    const otherIdsInGroup = activeVehicleTags.value
      .filter((tagItem) => tagItem.group === group && tagItem.id !== tag.id)
      .map((tagItem) => tagItem.id);
    const isCurrentlySelected = cur.includes(tag.id);
    const cleaned = cur.filter((id) => !otherIdsInGroup.includes(id));
    input.selectedTagIds = isCurrentlySelected
      ? cleaned.filter((id) => id !== tag.id)
      : [...cleaned.filter((id) => id !== tag.id), tag.id];
    return;
  }

  input.selectedTagIds = cur.includes(tag.id)
    ? cur.filter((id) => id !== tag.id)
    : [...cur, tag.id];
};

// ── 跨縣市選項（4 chip）──────────────────────────────────────────────────────
const CROSS_COUNTY_OPTIONS = [0, 1, 2, 3] as const;

// ── 合成 RouteMetrics ──────────────────────────────────────────────────────
/** 跨縣市數 N → 訪問縣市清單長度 N+1；TPE 全境模式下重覆循環北北桃 3 碼 */
function _buildCountiesVisited(crossCount: number, allInTpeMetro: boolean): string[] {
  const n = Math.max(0, Math.floor(crossCount));
  const len = n + 1;
  if (allInTpeMetro) {
    const metro = Array.from(TPE_METRO_CODES); // ['TPE', 'NTPE', 'TYN']
    return Array.from({ length: len }, (_, i) => metro[i % metro.length] ?? 'TPE');
  }
  const nonMetro = ['TXG', 'CHA', 'NAN', 'YUN', 'CYQ', 'TNN', 'KHH'];
  return nonMetro.slice(0, len);
}

function _buildSyntheticMetrics(): RouteMetrics {
  return {
    distanceKm: input.distanceKm,
    staticDurationSec: 0,
    durationSec: 0,
    pureJamMinutes: 0,
    freeFlowKmh: 0,
    polylineEncoded: '',
    elevationDiffM: input.isMountain ? 500 : 0,
    sinuosity: input.isMountain ? 1.4 : 1.0,
    freewayKm: input.freewayKm,
    hasTrunk: false,
    countiesVisited: _buildCountiesVisited(input.crossCountyCount, input.allInTpeMetro),
    straightLineKm: input.distanceKm,
    computedAt: Date.now(),
    apiSourcesOk: { routes: true, elevation: true, osm: true, counties: true },
  };
}

// ── 驗證 ──────────────────────────────────────────────────────────────────
function _validate(): string {
  if (typeof input.distanceKm !== 'number' || Number.isNaN(input.distanceKm) || input.distanceKm < 0) {
    return t('fare.calc.error.distance');
  }
  if (typeof input.freewayKm !== 'number' || Number.isNaN(input.freewayKm) || input.freewayKm < 0) {
    return t('fare.calc.error.freeway');
  }
  if (!input.vehicleId) return t('fare.calc.error.vehicle');
  if (!input.pickupTime) return t('fare.calc.error.pickup');
  const time = new Date(input.pickupTime);
  if (Number.isNaN(time.getTime())) return t('fare.calc.error.pickup');
  return '';
}

// ── 試算 ──────────────────────────────────────────────────────────────────
const tagSurchargeDisplay = ref(0);

const ClickCalculate = () => {
  const err = _validate();
  if (err) {
    error.value = err;
    result.value = null;
    return;
  }
  const vehicle = storeConfig.GetVehicle(input.vehicleId);
  if (!vehicle) {
    error.value = t('fare.calc.error.vehicle');
    result.value = null;
    return;
  }

  // 標籤加價：max(surchargeAmount)；組成虛擬 extra 併入 extras（不改 calculateFareV2 簽名）
  const tagIndexEntries: TagSurchargeIndexEntry[] = activeVehicleTags.value.map((tag) => ({
    id: tag.id,
    group: tag.group,
    scope: tag.scope,
    surchargeAmount: tag.surchargeAmount,
    status: tag.status,
  }));
  const tagIndex = buildTagSurchargeIndex(tagIndexEntries);
  const tagCalc = calcTagSurcharge(input.selectedTagIds, tagIndex);
  tagSurchargeDisplay.value = tagCalc.surcharge;

  const realExtras = input.extraIds
    .map((id) => storeConfig.GetExtra(id))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => ({ price: e.price }));
  const extrasForCalc = tagCalc.surcharge > 0
    ? [...realExtras, { price: tagCalc.surcharge }]
    : realExtras;

  error.value = '';
  result.value = calculateFareV2(
    vehicle,
    _buildSyntheticMetrics(),
    new Date(input.pickupTime),
    extrasForCalc,
    storeConfig.fareRules,
    input.orderType,
  );
};

const ClickReset = () => {
  Object.assign(input, _defaultInput());
  result.value = null;
  error.value = '';
  tagSurchargeDisplay.value = 0;
  isAdvancedOpen.value = false;
};

// ── 顯示輔助 ──────────────────────────────────────────────────────────────
const fmt = (n: number): string => {
  const rounded = Math.round(n);
  return rounded.toLocaleString('en-US');
};

/** extrasSum 在 calculateFareV2 內包含 tag surcharge；UI 拆兩列時要扣掉 */
const extrasNetSum = computed(() => {
  if (!result.value) return 0;
  return Math.max(0, result.value.extrasSum - tagSurchargeDisplay.value);
});
</script>

<template lang="pug">
.PassengerFareEstimator
  //- 基本欄位 ────────────────────────────────────────────────
  .PassengerFareEstimator__grid
    .PassengerFareEstimator__field
      label.PassengerFareEstimator__label {{ $t('fare.calc.field.distance') }}
      ElInput(
        v-model.number="input.distanceKm"
        type="number"
        inputmode="numeric"
        maxlength="6"
      )
    .PassengerFareEstimator__field
      label.PassengerFareEstimator__label {{ $t('fare.calc.field.vehicle') }}
      ElSelect(
        v-model="input.vehicleId"
        :placeholder="$t('fare.calc.field.vehicle')"
      )
        ElOption(
          v-for="v in storeConfig.EnabledVehicles"
          :key="v.id"
          :label="storeConfig.LabelOf(v.label, lang)"
          :value="v.id"
        )
    .PassengerFareEstimator__field
      label.PassengerFareEstimator__label {{ $t('fare.calc.field.pickup') }}
      ElInput(
        v-model="input.pickupTime"
        type="datetime-local"
        maxlength="20"
      )
    .PassengerFareEstimator__field
      label.PassengerFareEstimator__label {{ $t('fare.calc.field.orderType') }}
      ElSelect(v-model="input.orderType")
        ElOption(
          v-for="o in ORDER_TYPES"
          :key="o.value"
          :label="$t(`orderType.${o.value}`)"
          :value="o.value"
        )
    .PassengerFareEstimator__field.is-wide
      label.PassengerFareEstimator__label {{ $t('fare.calc.field.extras') }}
      ElSelect(
        v-model="input.extraIds"
        multiple
        clearable
        value-on-clear=""
        :placeholder="$t('fare.calc.field.extras')"
      )
        ElOption(
          v-for="e in storeConfig.EnabledExtras"
          :key="e.id"
          :label="`${storeConfig.LabelOf(e.label, lang)}（NT$ ${e.price}）`"
          :value="e.id"
        )

  //- 偏好標籤 ────────────────────────────────────────────────
  .PassengerFareEstimator__tags(v-if="groupedTags.length")
    label.PassengerFareEstimator__label {{ $t('fare.calc.field.tags') }}
    .PassengerFareEstimator__tag-groups
      .PassengerFareEstimator__tag-group(v-for="group in groupedTags" :key="group.key")
        .PassengerFareEstimator__tag-group-header
          span.PassengerFareEstimator__tag-group-name
            | {{ TAG_GROUPS[group.key].label[_toTagLang(lang)] || TAG_GROUPS[group.key].label.zh_tw }}
          span.PassengerFareEstimator__tag-group-meta
            | {{ group.meta.multiplicity === 'single' ? $t('booking.preferences.singleHint') : $t('booking.preferences.multiHint') }}
        .PassengerFareEstimator__tag-chips
          button.PassengerFareEstimator__tag-chip(
            v-for="tag in group.tags"
            :key="tag.id"
            type="button"
            :class="{ 'is-selected': IsTagSelected(tag.id) }"
            @click="ClickToggleChip(tag, group.key)"
          )
            span.PassengerFareEstimator__tag-chip-name {{ TagLabel(tag) }}
            span.PassengerFareEstimator__tag-chip-surcharge(v-if="tag.surchargeAmount > 0")
              | +NT$ {{ tag.surchargeAmount }}

  //- 進階選項（摺疊）─────────────────────────────────────────
  details.PassengerFareEstimator__advanced(:open="isAdvancedOpen" @toggle="isAdvancedOpen = ($event.target as HTMLDetailsElement).open")
    summary.PassengerFareEstimator__advanced-summary
      | {{ isAdvancedOpen ? $t('fare.calc.advanced.toggleOpen') : $t('fare.calc.advanced.toggleClosed') }}
    .PassengerFareEstimator__advanced-body
      .PassengerFareEstimator__field
        label.PassengerFareEstimator__label {{ $t('fare.calc.advanced.mountain') }}
        ElSwitch(v-model="input.isMountain")
      .PassengerFareEstimator__field
        label.PassengerFareEstimator__label {{ $t('fare.calc.advanced.crossCounty') }}
        .PassengerFareEstimator__cross-chips
          button.PassengerFareEstimator__cross-chip(
            v-for="opt in CROSS_COUNTY_OPTIONS"
            :key="opt"
            type="button"
            :class="{ 'is-selected': input.crossCountyCount === opt }"
            @click="input.crossCountyCount = opt"
          )
            | {{ $t(`fare.calc.advanced.crossCountyOptions.${opt}`) }}
        label.PassengerFareEstimator__checkbox(v-if="input.crossCountyCount > 0")
          input(type="checkbox" v-model="input.allInTpeMetro")
          span {{ $t('fare.calc.advanced.tpeMetro') }}
      .PassengerFareEstimator__field
        label.PassengerFareEstimator__label {{ $t('fare.calc.advanced.freeway') }}
        ElInput(
          v-model.number="input.freewayKm"
          type="number"
          inputmode="numeric"
          maxlength="6"
        )
        span.PassengerFareEstimator__hint {{ $t('fare.calc.advanced.freewayHelper') }}

  //- 動作 ───────────────────────────────────────────────────
  .PassengerFareEstimator__actions
    button.PassengerFareEstimator__btn.is-secondary(type="button" @click="ClickReset")
      | {{ $t('fare.calc.btn.reset') }}
    button.PassengerFareEstimator__btn.is-primary(type="button" @click="ClickCalculate")
      | {{ $t('fare.calc.btn.calculate') }}

  //- 錯誤 ───────────────────────────────────────────────────
  .PassengerFareEstimator__error(v-if="error") ⚠ {{ error }}

  //- 結果拆解（只列 > 0 的項目；不顯示「小計」）──────────────
  .PassengerFareEstimator__result(v-if="result")
    .PassengerFareEstimator__result-title {{ $t('fare.calc.result.title') }}
    .PassengerFareEstimator__line
      span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.baseFare') }}
      span.PassengerFareEstimator__line-val NT$ {{ fmt(result.baseFare) }}
    .PassengerFareEstimator__line(v-if="result.distanceFee > 0")
      span.PassengerFareEstimator__line-key
        | {{ $t('fare.calc.result.distance') }}
        span.PassengerFareEstimator__line-badge(v-if="result.mountainMul !== 1")
          | {{ $t('fare.calc.result.mountainBadge', { mul: result.mountainMul }) }}
      span.PassengerFareEstimator__line-val
        | +NT$ {{ fmt(result.distanceFee * result.mountainMul) }}
    .PassengerFareEstimator__line(v-if="extrasNetSum > 0")
      span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.extras') }}
      span.PassengerFareEstimator__line-val +NT$ {{ fmt(extrasNetSum) }}
    .PassengerFareEstimator__line(v-if="tagSurchargeDisplay > 0")
      span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.tagSurcharge') }}
      span.PassengerFareEstimator__line-val +NT$ {{ fmt(tagSurchargeDisplay) }}
    .PassengerFareEstimator__line(v-if="result.crossCountyFee > 0")
      span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.crossCounty') }}
      span.PassengerFareEstimator__line-val +NT$ {{ fmt(result.crossCountyFee) }}
    .PassengerFareEstimator__line(v-if="result.freewayToll > 0")
      span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.freeway') }}
      span.PassengerFareEstimator__line-val +NT$ {{ fmt(result.freewayToll) }}
    .PassengerFareEstimator__line(v-if="result.surcharge > 0")
      span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.surcharge') }}
      span.PassengerFareEstimator__line-val +NT$ {{ fmt(result.surcharge) }}
    .PassengerFareEstimator__line(v-if="result.promoDiscount > 0")
      span.PassengerFareEstimator__line-key {{ $t('fare.calc.result.promo') }}
      span.PassengerFareEstimator__line-val −NT$ {{ fmt(result.promoDiscount) }}
    .PassengerFareEstimator__line.is-final
      span.PassengerFareEstimator__line-key
        | {{ $t('fare.calc.result.final', { round: result.rounding }) }}
      span.PassengerFareEstimator__line-val NT$ {{ fmt(result.final) }}

  //- Disclaimer ─────────────────────────────────────────────
  p.PassengerFareEstimator__disclaimer {{ $t('fare.calc.disclaimer') }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PassengerFareEstimator {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 18px;
  padding: 22px;
  box-shadow: var(--da-glass-shadow);
}

// ── 欄位 ────────────────────────────────────────────────────
.PassengerFareEstimator__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

@media (max-width: 479.98px) {
  .PassengerFareEstimator__grid { grid-template-columns: 1fr; }
}

.PassengerFareEstimator__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PassengerFareEstimator__field.is-wide {
  grid-column: 1 / -1;
}

.PassengerFareEstimator__label {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--da-gray);
}

.PassengerFareEstimator__hint {
  font-family: $font-body;
  font-size: 11px;
  color: var(--da-gray-light);
  margin-top: 4px;
}

// ── 偏好標籤 ────────────────────────────────────────────────
.PassengerFareEstimator__tags {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
}

.PassengerFareEstimator__tag-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PassengerFareEstimator__tag-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PassengerFareEstimator__tag-group-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.PassengerFareEstimator__tag-group-name {
  font-family: $font-body;
  font-size: 12px;
  font-weight: 700;
  color: var(--da-dark);
}

.PassengerFareEstimator__tag-group-meta {
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--da-gray-light);
}

.PassengerFareEstimator__tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.PassengerFareEstimator__tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid var(--da-gray-pale);
  background: var(--da-off-white);
  color: var(--da-dark);
  cursor: pointer;
  transition: all 0.15s;
}

.PassengerFareEstimator__tag-chip:hover {
  border-color: var(--da-amber);
  background: var(--da-amber-pale);
}

.PassengerFareEstimator__tag-chip.is-selected {
  border-color: var(--da-amber);
  background: var(--da-amber-pale);
  color: var(--da-amber);
  font-weight: 700;
}

.PassengerFareEstimator__tag-chip-surcharge {
  font-family: $font-condensed;
  font-size: 11px;
  color: var(--da-amber);
  letter-spacing: 0.03em;
}

// ── 進階摺疊 ────────────────────────────────────────────────
.PassengerFareEstimator__advanced {
  margin-top: 18px;
  border-top: 1px dashed var(--da-gray-pale);
  padding-top: 14px;
}

.PassengerFareEstimator__advanced-summary {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--da-amber);
  cursor: pointer;
  padding: 6px 0;
  list-style: none;
}

.PassengerFareEstimator__advanced-summary::-webkit-details-marker {
  display: none;
}

.PassengerFareEstimator__advanced-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 12px;
}

.PassengerFareEstimator__cross-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.PassengerFareEstimator__cross-chip {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid var(--da-gray-pale);
  background: var(--da-off-white);
  color: var(--da-dark);
  cursor: pointer;
  transition: all 0.15s;
}

.PassengerFareEstimator__cross-chip:hover {
  border-color: var(--da-amber);
  background: var(--da-amber-pale);
}

.PassengerFareEstimator__cross-chip.is-selected {
  border-color: var(--da-amber);
  background: var(--da-amber-pale);
  color: var(--da-amber);
  font-weight: 700;
}

.PassengerFareEstimator__checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: $font-body;
  font-size: 12px;
  color: var(--da-gray);
  margin-top: 8px;
  cursor: pointer;
}

// ── 動作 ────────────────────────────────────────────────────
.PassengerFareEstimator__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.PassengerFareEstimator__btn {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 10px 22px;
  border-radius: 100px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.PassengerFareEstimator__btn.is-primary {
  background: var(--da-amber);
  color: var(--da-dark);
}

.PassengerFareEstimator__btn.is-primary:active {
  transform: scale(0.97);
}

.PassengerFareEstimator__btn.is-secondary {
  background: transparent;
  border-color: var(--da-gray-pale);
  color: var(--da-gray);
}

.PassengerFareEstimator__btn.is-secondary:hover {
  border-color: var(--da-amber);
  color: var(--da-amber);
}

// ── 錯誤 ────────────────────────────────────────────────────
.PassengerFareEstimator__error {
  font-family: $font-body;
  font-size: 13px;
  color: #b8500a;
  background: var(--da-amber-pale);
  border: 1px solid var(--da-glass-border);
  border-radius: 10px;
  padding: 10px 14px;
  margin-top: 14px;
}

// ── 結果 ────────────────────────────────────────────────────
.PassengerFareEstimator__result {
  margin-top: 18px;
  border: 1px solid var(--da-glass-border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--da-off-white);
}

.PassengerFareEstimator__result-title {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--da-amber);
  background: var(--da-amber-pale);
  padding: 10px 16px;
  border-bottom: 1px solid var(--da-glass-border);
}

.PassengerFareEstimator__line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--da-gray-pale);
}

.PassengerFareEstimator__line:last-child {
  border-bottom: none;
}

.PassengerFareEstimator__line.is-final {
  background: var(--da-amber-pale);
  border-top: 1px solid var(--da-glass-border);
}

.PassengerFareEstimator__line-key {
  font-family: $font-body;
  font-size: 13px;
  color: var(--da-gray);
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.PassengerFareEstimator__line-badge {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--da-amber);
}

.PassengerFareEstimator__line-val {
  font-family: $font-condensed;
  font-size: 15px;
  font-weight: 700;
  color: var(--da-dark);
}

.PassengerFareEstimator__line.is-final .PassengerFareEstimator__line-key,
.PassengerFareEstimator__line.is-final .PassengerFareEstimator__line-val {
  color: var(--da-amber);
  font-size: 16px;
}

// ── Disclaimer ──────────────────────────────────────────────
.PassengerFareEstimator__disclaimer {
  font-family: $font-body;
  font-size: 11px;
  color: var(--da-gray-light);
  line-height: 1.7;
  margin-top: 14px;
}
</style>
