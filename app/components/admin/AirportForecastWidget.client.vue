<script setup lang="ts">
// Props
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

// State
const loading = ref(true);
const forecast = ref<AirportForecastData | null>(null);

// Chart hours format（for TrafficChart）
const chartHours = computed(() =>
  (forecast.value?.hours ?? []).map((h) => ({
    hour: h.hour,
    forecastCount: h.forecastCount,
    actualCount: null,
  })),
);

const today = computed(() => $dayjs().format('MM / DD'));
const updatedTime = computed(() => {
  if (!forecast.value?.updatedAt) return '--';
  return $dayjs(forecast.value.updatedAt).format('HH:mm');
});
const totalFmt = computed(() =>
  forecast.value ? forecast.value.totalForecast.toLocaleString() : '--',
);
const peakLabel = computed(() =>
  forecast.value != null ? `${String(forecast.value.peakHour).padStart(2, '0')}:00` : '--',
);
const peakFmt = computed(() =>
  forecast.value ? forecast.value.peakCount.toLocaleString() : '--',
);

// API
const ApiGetForecast = async () => {
  loading.value = true;
  const res = await $api.GetAirportForecast();
  if (res.status.code === $enum.apiStatus.success || res.data) {
    forecast.value = res.data as AirportForecastData;
  }
  loading.value = false;
};

onMounted(ApiGetForecast);
</script>

<template lang="pug">
.AirportForecastWidget
  .AirportForecastWidget__header
    .AirportForecastWidget__label AIRPORT FLOW
    .AirportForecastWidget__date {{ today }}
    .AirportForecastWidget__updated(v-if="updatedTime !== '--'") 更新 {{ updatedTime }}

  //- 簡易統計
  .AirportForecastWidget__stats
    .AirportForecastWidget__stat
      .AirportForecastWidget__stat-label 今日總人次
      .AirportForecastWidget__stat-val {{ totalFmt }}
    .AirportForecastWidget__stat
      .AirportForecastWidget__stat-label 尖峰時段
      .AirportForecastWidget__stat-val {{ peakLabel }}
    .AirportForecastWidget__stat
      .AirportForecastWidget__stat-label 尖峰人次
      .AirportForecastWidget__stat-val {{ peakFmt }}

  //- 圖表（非精簡模式才顯示完整圖）
  .AirportForecastWidget__chart(v-if="!compact")
    AdminTrafficChart(:hours="chartHours" :loading="loading")
</template>

<style lang="scss" scoped>

.AirportForecastWidget {
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-md);
  padding: 12px 14px;
}

.AirportForecastWidget__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}

.AirportForecastWidget__label {
  font-family: var(--ff-label);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--accent);
}

.AirportForecastWidget__date {
  font-family: var(--ff-label);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--surface-a50);
}

.AirportForecastWidget__updated {
  margin-left: auto;
  font-family: var(--ff-label);
  font-size: 9px;
  letter-spacing: 0.05em;
  color: var(--surface-a20);
}

.AirportForecastWidget__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}

.AirportForecastWidget__stat {
  background: var(--surface-a06);
  border-radius: var(--r-sm);
  padding: 8px 6px;
  text-align: center;
}

.AirportForecastWidget__stat-label {
  font-family: var(--ff-label);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--surface-a20);
  margin-bottom: 4px;
  white-space: nowrap;
}

.AirportForecastWidget__stat-val {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: 16px;
  color: var(--surface-raised);
  line-height: 1;
}

.AirportForecastWidget__chart {
  height: 140px;
  margin-top: 4px;
}
</style>
