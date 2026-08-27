<script setup lang="ts">
// 縣市過濾器（admin/orders + driver/dispatched 共用）
//
// 模式：上車地 OR 下車地（單選 toggle）+ 縣市多選 + 行政區 cascader
// 行政區 options 由上層從 server response 聚合後傳入（availableDistricts），
// 沒選任何 city 或當前 cities 集合在現有訂單中無 district 時隱藏行政區 select。
//
// emit { regionField, cities, districts }，上層直接帶入 query 給 server。
//
// 清除：cities = districts = []（regionField 保留當前 toggle 狀態）。

import { TAIWAN_CITIES, getCityLabel } from '~/constants/locations-taiwan';

interface CityFilterValue {
  regionField: 'pickup' | 'dropoff';
  cities: string[];
  districts: string[];
}

interface Props {
  modelValue?: CityFilterValue;
  /** server 回的 distinct district list（依當前 cities + regionField 聚合）*/
  availableDistricts?: string[];
  theme?: 'dark' | 'cream';
  size?: 'sm' | 'md';
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({ regionField: 'pickup', cities: [], districts: [] }),
  availableDistricts: () => [],
  theme: 'dark',
  size: 'sm',
});

const emit = defineEmits<{
  'update:modelValue': [val: CityFilterValue];
  change: [val: CityFilterValue];
}>();

const { t, locale } = useI18n();

const internalValue = ref<CityFilterValue>({ ...props.modelValue });

watch(
  () => props.modelValue,
  (v) => { internalValue.value = { ...v, cities: [...v.cities], districts: [...v.districts] }; },
  { deep: true },
);

const cityOptions = computed(() =>
  TAIWAN_CITIES.map((c) => ({ value: c.id, label: getCityLabel(c, locale.value) })),
);

const _Emit = (): void => {
  const v = { ...internalValue.value, cities: [...internalValue.value.cities], districts: [...internalValue.value.districts] };
  emit('update:modelValue', v);
  emit('change', v);
};

const ChangeRegionField = (field: 'pickup' | 'dropoff'): void => {
  if (internalValue.value.regionField === field) return;
  internalValue.value.regionField = field;
  // 切上下車地時清掉 districts（availableDistricts 會重新聚合，舊選項可能無效）
  internalValue.value.districts = [];
  _Emit();
};

const ChangeCities = (cities: string[]): void => {
  internalValue.value.cities = Array.isArray(cities) ? cities : [];
  // city 改變時清掉 districts
  internalValue.value.districts = [];
  _Emit();
};

const ChangeDistricts = (districts: string[]): void => {
  internalValue.value.districts = Array.isArray(districts) ? districts : [];
  _Emit();
};

const ClickClear = (): void => {
  internalValue.value = {
    regionField: internalValue.value.regionField,
    cities: [],
    districts: [],
  };
  _Emit();
};

const showDistrictSelect = computed(
  () => internalValue.value.cities.length > 0 && props.availableDistricts.length > 0,
);

const hasValue = computed(
  () => internalValue.value.cities.length > 0 || internalValue.value.districts.length > 0,
);
</script>

<template lang="pug">
.UiCityFilter(:class="[`size-${size}`, `theme-${theme}`]")
  .UiCityFilter__toggle
    button.UiCityFilter__toggle-btn(
      type="button"
      :class="{ 'is-active': internalValue.regionField === 'pickup' }"
      @click="ChangeRegionField('pickup')"
    ) {{ t('ui.cityFilter.pickup') }}
    button.UiCityFilter__toggle-btn(
      type="button"
      :class="{ 'is-active': internalValue.regionField === 'dropoff' }"
      @click="ChangeRegionField('dropoff')"
    ) {{ t('ui.cityFilter.dropoff') }}
  ElSelect.UiCityFilter__select(
    :model-value="internalValue.cities"
    :placeholder="t('ui.cityFilter.cityPlaceholder')"
    multiple
    collapse-tags
    collapse-tags-tooltip
    filterable
    clearable
    @update:model-value="ChangeCities"
  )
    ElOption(
      v-for="opt in cityOptions"
      :key="opt.value"
      :value="opt.value"
      :label="opt.label"
    )
  ElSelect.UiCityFilter__select(
    v-if="showDistrictSelect"
    :model-value="internalValue.districts"
    :placeholder="t('ui.cityFilter.districtPlaceholder')"
    multiple
    collapse-tags
    collapse-tags-tooltip
    filterable
    clearable
    @update:model-value="ChangeDistricts"
  )
    ElOption(
      v-for="d in availableDistricts"
      :key="d"
      :value="d"
      :label="d"
    )
  button.UiCityFilter__clear(
    v-if="hasValue"
    type="button"
    @click="ClickClear"
  ) {{ t('ui.cityFilter.clear') }}
</template>

<style lang="scss" scoped>
.UiCityFilter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.UiCityFilter__toggle {
  display: inline-flex;
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-sm);
  overflow: hidden;
}

.UiCityFilter__toggle-btn {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 5px 10px;
  border: none;
  background: var(--surface-a06);
  color: var(--surface-a60);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  border-right: 1px solid var(--surface-a06);

  &:last-child { border-right: none; }
  &:hover { background: var(--surface-a06); color: var(--surface-raised); }
  &.is-active { background: var(--accent-a20); color: var(--accent-lit); }
}

.UiCityFilter__select {
  width: 160px;
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
}

.UiCityFilter__clear {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 5px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--surface-a12);
  background: var(--surface-a06);
  color: var(--surface-a60);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--stop-a15);
    color: var(--stop);
    border-color: var(--stop-a30);
  }
}

// ── theme-cream（乘客 cream 底色用）────────────────────────
.UiCityFilter.theme-cream {
  .UiCityFilter__toggle { border-color: var(--ink-a20); }
  .UiCityFilter__toggle-btn {
    background: var(--ink-a06);
    color: var(--da-gray);
    border-right-color: var(--ink-a12);
    &:hover { background: var(--ink-a06); color: var(--da-dark); }
    &.is-active { background: var(--accent-a20); color: var(--accent-deep); }
  }
  .UiCityFilter__clear {
    background: var(--ink-a06);
    border-color: var(--ink-a20);
    color: var(--da-gray);
    &:hover {
      background: var(--stop-a08);
      color: var(--stop);
      border-color: var(--stop-a30);
    }
  }
}

// ── size-md（front-desk 用，字級略大）─────────────────────
.UiCityFilter.size-md {
  .UiCityFilter__select { width: 180px; font-size: var(--fs-body-sm); }
  .UiCityFilter__toggle-btn { font-size: var(--fs-label); padding: 6px 12px; }
  .UiCityFilter__clear { font-size: var(--fs-label); padding: 6px 12px; }
}
</style>
