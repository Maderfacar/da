<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

// ── 篩選條件 ─────────────────────────────────────────────────
const selectedDate = ref($dayjs().format('YYYY-MM-DD'));

// ── 資料狀態 ─────────────────────────────────────────────────
const loading = ref(false);
const peakHour = ref<number | null>(null);
const peakCount = ref(0);
const totalCount = ref(0);
const sourceFile = ref('');
const updatedAt = ref(0);

interface HourData { hour: number; forecastCount: number; actualCount: number | null }
const hourData = ref<HourData[]>([]);

// ── 資料載入（使用 airport-forecast BFF）────────────────────
const ApiLoadFlow = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAirportForecast({ date: selectedDate.value });
    const d = res.data as AirportForecastData | null;
    const hours: HourData[] = (d?.hours ?? []).map((h) => ({
      hour: h.hour,
      forecastCount: h.forecastCount,
      actualCount: null,
    }));
    hourData.value = hours;
    totalCount.value = d?.totalForecast ?? hours.reduce((a, b) => a + b.forecastCount, 0);
    peakCount.value = d?.peakCount ?? 0;
    peakHour.value = d?.peakHour != null ? d.peakHour : null;
    sourceFile.value = d?.sourceFile ?? '';
    updatedAt.value = d?.updatedAt ?? 0;
  } catch (err) {
    console.error('[traffic] ApiLoadFlow failed:', err);
    hourData.value = [];
  } finally {
    loading.value = false;
  }
};

// ── 日期快捷 ─────────────────────────────────────────────────
const SetDateOffset = (offset: number) => {
  selectedDate.value = $dayjs().add(offset, 'day').format('YYYY-MM-DD');
};

const updatedLabel = computed(() =>
  updatedAt.value ? $dayjs(updatedAt.value).format('HH:mm 更新') : '',
);
const sourceLabel = computed(() =>
  sourceFile.value ? `來源：${sourceFile.value}` : '',
);

watch(selectedDate, ApiLoadFlow);
onMounted(ApiLoadFlow);
</script>

<template lang="pug">
.PageTraffic
  //- 頁首
  .PageTraffic__header
    .PageTraffic__header-label AIRPORT INTELLIGENCE
    h1.PageTraffic__header-title 機場人流預測
    p.PageTraffic__header-sub 24-HOUR PASSENGER FLOW FORECAST

  //- 主體：左欄（圖表）+ 右欄（氣象）
  .PageTraffic__layout

    //- 左欄
    .PageTraffic__main

      //- 日期篩選
      .PageTraffic__filters
        .PageTraffic__filter-group
          label.PageTraffic__filter-label 日期
          .PageTraffic__date-shortcuts
            button.PageTraffic__shortcut(
              @click="SetDateOffset(0)"
              :class="{ 'is-active': selectedDate === $dayjs().format('YYYY-MM-DD') }"
            ) 今日
            button.PageTraffic__shortcut(
              @click="SetDateOffset(1)"
              :class="{ 'is-active': selectedDate === $dayjs().add(1,'day').format('YYYY-MM-DD') }"
            ) 明日
            button.PageTraffic__shortcut(
              @click="SetDateOffset(2)"
              :class="{ 'is-active': selectedDate === $dayjs().add(2,'day').format('YYYY-MM-DD') }"
            ) 後日
          input.PageTraffic__date-input(
            type="date"
            v-model="selectedDate"
          )
        .PageTraffic__meta-row(v-if="updatedLabel || sourceLabel")
          span(v-if="updatedLabel") {{ updatedLabel }}
          span(v-if="sourceLabel") · {{ sourceLabel }}

      //- 統計摘要
      .PageTraffic__stats
        .PageTraffic__stat-card
          .PageTraffic__stat-label 全日預計總人流
          .PageTraffic__stat-val {{ totalCount.toLocaleString() }}
          .PageTraffic__stat-unit 人次
        .PageTraffic__stat-card.is-peak(v-if="peakHour !== null")
          .PageTraffic__stat-label 尖峰時段
          .PageTraffic__stat-val {{ String(peakHour).padStart(2, '0') }}:00
          .PageTraffic__stat-unit {{ peakCount.toLocaleString() }} 人次
        .PageTraffic__stat-card
          .PageTraffic__stat-label 查詢日期
          .PageTraffic__stat-val {{ selectedDate }}

      //- 圖表
      .PageTraffic__chart-wrapper
        AdminTrafficChart(:hours="hourData" :loading="loading")

      //- 調度建議
      .PageTraffic__suggest(v-if="peakHour !== null")
        .PageTraffic__suggest-icon ⚡
        .PageTraffic__suggest-text
          | 尖峰時段
          strong  {{ String(peakHour).padStart(2, '0') }}:00 — {{ String(peakHour + 1).padStart(2, '0') }}:00
          |  預計 {{ peakCount.toLocaleString() }} 人次，建議提前 1 小時部署司機待命。

    //- 右欄（氣象）
    .PageTraffic__aside
      .PageTraffic__aside-title WEATHER · 桃園
      WeatherWidget
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageTraffic {
  padding: 24px 20px 60px;
  min-height: 100svh;
  background: #0f1115;
  color: #fff;
}

// ── 頁首 ──────────────────────────────────────────────────
.PageTraffic__header { margin-bottom: 24px; }

.PageTraffic__header-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  &::before { content: ''; width: 20px; height: 1.5px; background: var(--da-amber); }
}

.PageTraffic__header-title {
  font-family: $font-display;
  font-size: 40px;
  color: #fff;
  letter-spacing: 0.02em;
  line-height: 0.95;
}

.PageTraffic__header-sub {
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 4px;
}

// ── 主體雙欄 ──────────────────────────────────────────────
.PageTraffic__layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.PageTraffic__main {
  flex: 1;
  min-width: 0;
}

.PageTraffic__aside {
  width: 260px;
  flex-shrink: 0;
}

.PageTraffic__aside-title {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.25em;
  color: #38bdf8;
  margin-bottom: 10px;
}

// ── 篩選列 ────────────────────────────────────────────────
.PageTraffic__filters {
  margin-bottom: 20px;
}

.PageTraffic__filter-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.PageTraffic__filter-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
  min-width: 30px;
}

.PageTraffic__date-shortcuts {
  display: flex;
  gap: 6px;
}

.PageTraffic__shortcut {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 12px;
  border-radius: 100px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    background: var(--da-amber);
    border-color: var(--da-amber);
    color: #fff;
  }
}

.PageTraffic__date-input {
  font-family: $font-condensed;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #fff;
  padding: 6px 10px;
  cursor: pointer;

  &::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }
}

.PageTraffic__meta-row {
  margin-top: 6px;
  font-family: $font-condensed;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.2);
  display: flex;
  gap: 6px;
}

// ── 統計摘要 ──────────────────────────────────────────────
.PageTraffic__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.PageTraffic__stat-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  padding: 14px 16px;

  &.is-peak {
    border-color: rgba(212, 134, 10, 0.35);
    background: rgba(212, 134, 10, 0.08);
  }
}

.PageTraffic__stat-label {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 4px;
}

.PageTraffic__stat-val {
  font-family: $font-display;
  font-size: 26px;
  color: #fff;
  line-height: 1;
  letter-spacing: 0.02em;

  .is-peak & { color: var(--da-amber); }
}

.PageTraffic__stat-unit {
  font-family: $font-condensed;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 2px;
}

// ── 圖表 ──────────────────────────────────────────────────
.PageTraffic__chart-wrapper {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 16px;
  padding: 16px;
  height: 320px;
  position: relative;
  margin-bottom: 20px;
}

// ── 調度建議 ──────────────────────────────────────────────
.PageTraffic__suggest {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: rgba(212, 134, 10, 0.1);
  border: 1px solid rgba(212, 134, 10, 0.25);
  border-radius: 12px;
  padding: 14px 16px;
}

.PageTraffic__suggest-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }

.PageTraffic__suggest-text {
  font-family: $font-body;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.5;

  strong { color: var(--da-amber); font-weight: 700; }
}
</style>
