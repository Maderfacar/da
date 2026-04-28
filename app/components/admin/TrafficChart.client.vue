<script setup lang="ts">
import type { Chart, ChartData, ChartOptions } from 'chart.js';

interface HourData { hour: number; forecastCount: number; actualCount: number | null }

const props = defineProps<{ hours: HourData[]; loading: boolean }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
let chartInstance: Chart | null = null;

const _RenderChart = async (hours: HourData[]) => {
  if (!canvasEl.value) return;

  const { Chart, registerables } = await import('chart.js');
  Chart.register(...registerables);

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const labels = hours.map((h) => `${String(h.hour).padStart(2, '0')}:00`);
  const forecastData = hours.map((h) => h.forecastCount);
  const actualData = hours.map((h) => h.actualCount ?? null);
  const maxVal = Math.max(...forecastData);

  const bgColors = forecastData.map((v) =>
    v === maxVal && maxVal > 0 ? 'rgba(212, 134, 10, 0.9)' : 'rgba(212, 134, 10, 0.3)',
  );
  const borderColors = forecastData.map((v) =>
    v === maxVal && maxVal > 0 ? 'rgba(212, 134, 10, 1)' : 'rgba(212, 134, 10, 0.5)',
  );

  const datasets: ChartData<'bar'>['datasets'] = [
    {
      label: '預計人流',
      data: forecastData,
      backgroundColor: bgColors,
      borderColor: borderColors,
      borderWidth: 1,
      borderRadius: 4,
    },
  ];

  const hasActual = actualData.some((v) => v !== null);
  if (hasActual) {
    datasets.push({
      label: '實際人流',
      data: actualData as number[],
      backgroundColor: 'rgba(34, 197, 94, 0.5)',
      borderColor: 'rgba(34, 197, 94, 0.9)',
      borderWidth: 1,
      borderRadius: 4,
    });
  }

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: 'rgba(255,255,255,0.6)', font: { size: 12 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()} 人次`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: 'rgba(255,255,255,0.45)', font: { size: 11 } },
        grid: { color: 'rgba(255,255,255,0.05)' },
      },
      y: {
        ticks: {
          color: 'rgba(255,255,255,0.45)',
          font: { size: 11 },
          callback: (v) => `${Number(v).toLocaleString()}`,
        },
        grid: { color: 'rgba(255,255,255,0.06)' },
        beginAtZero: true,
      },
    },
  };

  chartInstance = new Chart(canvasEl.value, {
    type: 'bar',
    data: { labels, datasets },
    options,
  });
};

watch(() => props.hours, (val) => _RenderChart(val), { deep: true });

onUnmounted(() => {
  chartInstance?.destroy();
});
</script>

<template lang="pug">
.TrafficChart
  .TrafficChart__loading(v-if="loading")
    .TrafficChart__spinner
  canvas(ref="canvasEl" v-show="!loading")
</template>

<style lang="scss" scoped>
.TrafficChart {
  width: 100%;
  height: 100%;
  position: relative;

  canvas { width: 100% !important; height: 100% !important; }
}

.TrafficChart__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.TrafficChart__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: var(--da-amber);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
