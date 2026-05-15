<script setup lang="ts">
// Wave 1 共用：日期過濾器（單一日期 / 範圍 / 月 / 年）
//
// 用途：admin/orders、passenger /orders、driver/trip 已完成列表
// emit { from, to } ISO 字串（含時區），上層直接帶入 query 給 server。
//
// 兩種模式：
//   - mode='single'：選一個 granularity（年 / 月 / 日），自動展開為當段起訖
//   - mode='range'：選兩個獨立日期（from / to），date input 由 user 自填
//
// granularity（單一模式下用）：
//   - 'day'   → from = YYYY-MM-DD 00:00, to = 隔日 00:00
//   - 'month' → from = 該月 1 日 00:00, to = 次月 1 日 00:00
//   - 'year'  → from = 該年 1/1 00:00, to = 隔年 1/1 00:00
//
// 清除：from = to = null（emit 一個 reset 訊號）。

interface Range {
  from: string | null;
  to: string | null;
}

type Mode = 'single' | 'range';
type Granularity = 'year' | 'month' | 'day';

interface Props {
  modelValue?: Range;
  mode?: Mode;
  granularity?: Granularity;
  /** 單一模式下允許切換 granularity；range 模式忽略 */
  allowGranularitySwitch?: boolean;
  size?: 'sm' | 'md';
  /**
   * 'dark'（預設）：admin / driver 暗底
   * 'cream'：乘客端 cream theme（/orders 頁面用），覆蓋色系為深底文字
   */
  theme?: 'dark' | 'cream';
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({ from: null, to: null }),
  mode: 'single',
  granularity: 'day',
  allowGranularitySwitch: true,
  size: 'sm',
  theme: 'dark',
});

const emit = defineEmits<{
  'update:modelValue': [val: Range];
  change: [val: Range];
}>();

const internalGranularity = ref<Granularity>(props.granularity);

// 單一模式 input 值：依 granularity 不同 input type 不同
//   - 'day'   → type=date,    value=YYYY-MM-DD
//   - 'month' → type=month,   value=YYYY-MM
//   - 'year'  → type=number,  value=YYYY
const singleValue = ref<string>('');

// 範圍模式 input 值
const rangeFrom = ref<string>('');
const rangeTo = ref<string>('');

const _toIso = (date: Date): string => date.toISOString();

const _ExpandSingle = (val: string, gran: Granularity): Range => {
  if (!val) return { from: null, to: null };
  if (gran === 'year') {
    const y = Number(val);
    if (!Number.isFinite(y) || y < 1900) return { from: null, to: null };
    return { from: _toIso(new Date(y, 0, 1, 0, 0, 0)), to: _toIso(new Date(y + 1, 0, 1, 0, 0, 0)) };
  }
  if (gran === 'month') {
    const [yStr, mStr] = val.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return { from: null, to: null };
    return { from: _toIso(new Date(y, m - 1, 1, 0, 0, 0)), to: _toIso(new Date(y, m, 1, 0, 0, 0)) };
  }
  // day
  const [yStr, mStr, dStr] = val.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return { from: null, to: null };
  const start = new Date(y, m - 1, d, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0);
  return { from: _toIso(start), to: _toIso(end) };
};

const _ExpandRange = (fromStr: string, toStr: string): Range => {
  let from: string | null = null;
  let to: string | null = null;
  if (fromStr) {
    const [y, m, d] = fromStr.split('-').map(Number);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      from = _toIso(new Date(y, m - 1, d, 0, 0, 0));
    }
  }
  if (toStr) {
    const [y, m, d] = toStr.split('-').map(Number);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      // 範圍 to 取「該日結束」= 隔日 00:00（exclusive end）
      to = _toIso(new Date(y, m - 1, d + 1, 0, 0, 0));
    }
  }
  return { from, to };
};

const _Emit = (range: Range): void => {
  emit('update:modelValue', range);
  emit('change', range);
};

const ChangeSingle = () => {
  _Emit(_ExpandSingle(singleValue.value, internalGranularity.value));
};

const ChangeRange = () => {
  _Emit(_ExpandRange(rangeFrom.value, rangeTo.value));
};

const ClickGranularity = (g: Granularity) => {
  if (internalGranularity.value === g) return;
  internalGranularity.value = g;
  // 切 granularity 時清空 input 並重置（避免格式錯誤）
  singleValue.value = '';
  _Emit({ from: null, to: null });
};

const ClickClear = () => {
  singleValue.value = '';
  rangeFrom.value = '';
  rangeTo.value = '';
  _Emit({ from: null, to: null });
};

const hasValue = computed(() => {
  if (props.mode === 'single') return Boolean(singleValue.value);
  return Boolean(rangeFrom.value || rangeTo.value);
});

const _SingleInputType = computed(() => {
  if (internalGranularity.value === 'year') return 'number';
  if (internalGranularity.value === 'month') return 'month';
  return 'date';
});
</script>

<template lang="pug">
.UiDateRangeFilter(:class="[`size-${size}`, `theme-${theme}`]")
  //- 單一模式：granularity 切換 + 對應 input
  template(v-if="mode === 'single'")
    .UiDateRangeFilter__granularity(v-if="allowGranularitySwitch")
      button.UiDateRangeFilter__gran-btn(
        type="button"
        :class="{ 'is-active': internalGranularity === 'year' }"
        @click="ClickGranularity('year')"
      ) 年
      button.UiDateRangeFilter__gran-btn(
        type="button"
        :class="{ 'is-active': internalGranularity === 'month' }"
        @click="ClickGranularity('month')"
      ) 月
      button.UiDateRangeFilter__gran-btn(
        type="button"
        :class="{ 'is-active': internalGranularity === 'day' }"
        @click="ClickGranularity('day')"
      ) 日
    input.UiDateRangeFilter__input(
      v-if="internalGranularity === 'year'"
      type="number"
      v-model="singleValue"
      placeholder="YYYY"
      min="1900"
      max="2100"
      inputmode="numeric"
      @change="ChangeSingle"
    )
    input.UiDateRangeFilter__input(
      v-else-if="internalGranularity === 'month'"
      type="month"
      v-model="singleValue"
      @change="ChangeSingle"
    )
    input.UiDateRangeFilter__input(
      v-else
      type="date"
      v-model="singleValue"
      @change="ChangeSingle"
    )

  //- 範圍模式：兩個 date input
  template(v-else)
    input.UiDateRangeFilter__input(
      type="date"
      v-model="rangeFrom"
      @change="ChangeRange"
    )
    span.UiDateRangeFilter__sep ～
    input.UiDateRangeFilter__input(
      type="date"
      v-model="rangeTo"
      @change="ChangeRange"
    )

  button.UiDateRangeFilter__clear(
    v-if="hasValue"
    type="button"
    @click="ClickClear"
  ) 清除
</template>

<style lang="scss" scoped>
.UiDateRangeFilter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.UiDateRangeFilter__granularity {
  display: inline-flex;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
}

.UiDateRangeFilter__gran-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 10px;
  border: none;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  border-right: 1px solid rgba(255, 255, 255, 0.08);

  &:last-child { border-right: none; }
  &:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  &.is-active { background: rgba(212, 134, 10, 0.18); color: #f7b96a; }
}

.UiDateRangeFilter__input {
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
  color-scheme: dark;
  outline: none;
  width: 130px;
  box-sizing: border-box;

  &:focus { border-color: rgba(212, 134, 10, 0.5); }
  &::placeholder { color: rgba(255, 255, 255, 0.3); }
}

.UiDateRangeFilter__sep {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  padding: 0 2px;
}

.UiDateRangeFilter__clear {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover { background: rgba(255, 80, 80, 0.12); color: #f87171; border-color: rgba(248, 113, 113, 0.3); }
}

// ── 尺寸：size-md（front-desk 用，字級略大）─────────────────
.UiDateRangeFilter.size-md {
  .UiDateRangeFilter__input { font-size: 13px; padding: 7px 12px; width: 145px; }
  .UiDateRangeFilter__gran-btn { font-size: 12px; padding: 6px 12px; }
  .UiDateRangeFilter__clear { font-size: 12px; padding: 6px 12px; }
}

// ── theme-cream（乘客 /orders 頁面 cream 底色用）────────────
// 既有 .UiDateRangeFilter__* 規則為 dark theme；此處覆蓋色系為深底文字
.UiDateRangeFilter.theme-cream {
  .UiDateRangeFilter__granularity {
    border-color: rgba(26, 24, 20, 0.18);
  }
  .UiDateRangeFilter__gran-btn {
    background: rgba(26, 24, 20, 0.04);
    color: var(--da-gray, #6b6560);
    border-right-color: rgba(26, 24, 20, 0.10);
    &:hover {
      background: rgba(26, 24, 20, 0.08);
      color: var(--da-dark, #1a1814);
    }
    &.is-active {
      background: rgba(212, 134, 10, 0.18);
      color: #b8730a;
    }
  }
  .UiDateRangeFilter__input {
    background: rgba(255, 255, 255, 0.65);
    border-color: rgba(26, 24, 20, 0.18);
    color: var(--da-dark, #1a1814);
    color-scheme: light;

    &::placeholder { color: rgba(26, 24, 20, 0.4); }
    &:focus { border-color: rgba(212, 134, 10, 0.55); }
  }
  .UiDateRangeFilter__sep {
    color: rgba(26, 24, 20, 0.4);
  }
  .UiDateRangeFilter__clear {
    background: rgba(26, 24, 20, 0.04);
    border-color: rgba(26, 24, 20, 0.18);
    color: var(--da-gray, #6b6560);

    &:hover {
      background: rgba(220, 38, 38, 0.10);
      color: #dc2626;
      border-color: rgba(220, 38, 38, 0.30);
    }
  }
}
</style>
