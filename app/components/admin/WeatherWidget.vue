<script setup lang="ts">
// 桃園機場所在地氣象資訊
const loading = ref(true);
const weather = ref<WeatherSummary | null>(null);

// 天氣代碼 → Emoji（CWA 天氣現象代碼）
const WEATHER_ICON: Record<number, string> = {
  1: '☀️',   // 晴
  2: '🌤️',  // 晴時多雲
  3: '⛅',   // 多雲時晴
  4: '🌥️',  // 多雲
  5: '☁️',   // 多雲時陰
  6: '☁️',   // 陰
  7: '🌦️',  // 陰時多雲
  8: '🌧️',  // 短暫雨
  9: '🌧️',  // 間歇雨
  10: '🌧️', // 持續性雨
  11: '🌩️', // 短暫陣雨或雷雨
  12: '⛈️',  // 短暫陣雨
  13: '🌩️', // 午後短暫雷陣雨
  14: '⛈️',  // 短暫雷陣雨
  15: '🌨️', // 有靄或有霧
  16: '🌫️', // 有霧
};

const weatherIcon = computed(() => {
  if (!weather.value) return '🌡️';
  return WEATHER_ICON[weather.value.weatherCode] ?? '🌡️';
});

const ApiGetWeather = async () => {
  loading.value = true;
  const res = await $api.GetWeather();
  if (res.status.code === $enum.apiStatus.success || res.data) {
    weather.value = _parseWeather(res.data);
  }
  loading.value = false;
};

function _parseWeather(data: unknown): WeatherSummary | null {
  const raw = data as any;
  const location = raw?.records?.location?.[0];
  if (!location) return null;

  const elementMap: Record<string, { parameterName: string; parameterValue?: string }> = {};
  for (const el of location.weatherElement ?? []) {
    const first = (el.time as any[])?.[0]?.parameter;
    if (first) elementMap[el.elementName as string] = first;
  }

  return {
    description: elementMap.Wx?.parameterName ?? '--',
    weatherCode: Number(elementMap.Wx?.parameterValue ?? 0),
    maxTemp: elementMap.MaxT?.parameterName ?? '--',
    minTemp: elementMap.MinT?.parameterName ?? '--',
    rainProbability: elementMap.PoP?.parameterName ?? '--',
  };
}

onMounted(ApiGetWeather);
</script>

<template lang="pug">
.WeatherWidget
  .WeatherWidget__header
    .WeatherWidget__label WEATHER · 桃園
    .WeatherWidget__loading(v-if="loading") 載入中...

  template(v-if="!loading && weather")
    .WeatherWidget__main
      .WeatherWidget__icon {{ weatherIcon }}
      .WeatherWidget__desc {{ weather.description }}
    .WeatherWidget__stats
      .WeatherWidget__stat
        .WeatherWidget__stat-label 最高
        .WeatherWidget__stat-val {{ weather.maxTemp }}°C
      .WeatherWidget__stat
        .WeatherWidget__stat-label 最低
        .WeatherWidget__stat-val {{ weather.minTemp }}°C
      .WeatherWidget__stat
        .WeatherWidget__stat-label 降雨
        .WeatherWidget__stat-val {{ weather.rainProbability }}%

  .WeatherWidget__error(v-if="!loading && !weather")
    .WeatherWidget__error-icon ⚠️
    div
      p.WeatherWidget__error-text 氣象資料無法取得
      p.WeatherWidget__error-hint CWA API 連線中斷或金鑰未設定
</template>

<style lang="scss" scoped>
.WeatherWidget {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  padding: 12px 14px;
}

.WeatherWidget__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.WeatherWidget__label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: #38bdf8; // sky blue
}

.WeatherWidget__loading {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.2);
}

.WeatherWidget__main {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.WeatherWidget__icon {
  font-size: 28px;
  line-height: 1;
}

.WeatherWidget__desc {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #fff;
}

.WeatherWidget__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.WeatherWidget__stat {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  padding: 8px 6px;
  text-align: center;
}

.WeatherWidget__stat-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.25);
  margin-bottom: 4px;
}

.WeatherWidget__stat-val {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 16px;
  color: #38bdf8;
  line-height: 1;
}

.WeatherWidget__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: rgba(255, 80, 80, 0.08);
  border: 1px solid rgba(255, 80, 80, 0.25);
  border-radius: 8px;
  padding: 10px 12px;
}

.WeatherWidget__error-icon { font-size: 14px; flex-shrink: 0; }

.WeatherWidget__error-text {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 120, 120, 0.9);
  margin: 0;
}

.WeatherWidget__error-hint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
  margin: 2px 0 0;
}
</style>
