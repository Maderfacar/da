<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

// ── 篩選條件 ─────────────────────────────────────────────────
const selectedDate = ref($dayjs().format('YYYY-MM-DD'));
const selectedTerminal = ref<'all' | 'T1' | 'T2'>('all');
type DirectionValue = 'all' | 'arrival' | 'departure'
  | 'transit-arrival' | 'transit-departure' | 'overnight-departure' | 'total';
const selectedDirection = ref<DirectionValue>('all');

const DATE_SHORTCUTS = [
  { label: '今天', offset: 0 },
  { label: '明天', offset: 1 },
];

const TERMINAL_OPTIONS = [
  { value: 'all', label: '全端' },
  { value: 'T1',  label: '第一航廈' },
  { value: 'T2',  label: '第二航廈' },
];

// P28：擴 4 個 direction 對齊 XLS 5 欄資料
//   - all                  進出境合計（出+入，不含轉機/過境）
//   - arrival / departure  單方向
//   - transit-*            轉機（不出機場）
//   - overnight-departure  過境離站
//   - total                全部流量（5 欄總和）
const DIRECTION_OPTIONS = [
  { value: 'all',                 label: '進出境合計' },
  { value: 'arrival',             label: '入境' },
  { value: 'departure',           label: '出境' },
  { value: 'transit-arrival',     label: '到站轉機' },
  { value: 'transit-departure',   label: '轉機離站' },
  { value: 'overnight-departure', label: '過境離站' },
  { value: 'total',               label: '全部流量' },
];

// ── 資料狀態 ─────────────────────────────────────────────────
type MockReason = 'firebase-not-configured' | 'xls-not-found' | 'parse-failed' | 'unknown-error';

const loading = ref(false);
const isMockData = ref(false);
const mockReason = ref<MockReason | null>(null);
const peakHour = ref<number | null>(null);
const peakCount = ref(0);
const totalCount = ref(0);

interface HourData { hour: number; forecastCount: number; actualCount: number | null }
const hourData = ref<HourData[]>([]);

// 根據 mockReason 顯示不同 banner 文案
const mockMessage = computed(() => {
  switch (mockReason.value) {
    case 'firebase-not-configured': return '⚠️ 設定錯誤 — Firebase Service Account 未設定';
    case 'xls-not-found':           return '⚠️ 機場尚未上傳此日期 XLS — 通常隔日凌晨更新';
    case 'parse-failed':            return '⚠️ XLS 解析失敗 — 機場檔案格式可能已變更，請通知工程';
    case 'unknown-error':           return '⚠️ 抓取人流資料時發生未知錯誤 — 請檢查 server logs';
    default:                         return '⚠️ 目前顯示模擬資料';
  }
});

// ── 資料載入 ──────────────────────────────────────────────────
const ApiLoadFlow = async () => {
  loading.value = true;
  isMockData.value = false;
  mockReason.value = null;
  try {
    const res = await $fetch<{
      data: { date: string; hours: HourData[]; isMock?: boolean; mockReason?: MockReason };
      status: { code: number };
    }>(`/api/airport/flow?date=${selectedDate.value}&terminal=${selectedTerminal.value}&direction=${selectedDirection.value}`);

    const hours = res?.data?.hours ?? [];
    hourData.value = hours;
    isMockData.value = res?.data?.isMock ?? true;
    mockReason.value = res?.data?.mockReason ?? null;

    const counts = hours.map((h) => h.forecastCount);
    totalCount.value = counts.reduce((a, b) => a + b, 0);
    const maxVal = Math.max(...counts);
    peakCount.value = maxVal;
    peakHour.value = maxVal > 0 ? counts.indexOf(maxVal) : null;
  } catch {
    hourData.value = [];
  } finally {
    loading.value = false;
  }
};

// ── 日期快捷 ─────────────────────────────────────────────────
const SetDateOffset = (offset: number) => {
  selectedDate.value = $dayjs().add(offset, 'day').format('YYYY-MM-DD');
};

const terminalLabel = computed(() => {
  const t = TERMINAL_OPTIONS.find((o) => o.value === selectedTerminal.value);
  const d = DIRECTION_OPTIONS.find((o) => o.value === selectedDirection.value);
  return `${t?.label ?? '全端'} · ${d?.label ?? '進出境合計'}`;
});

// ── 監聽篩選變更 ──────────────────────────────────────────────
watch([selectedDate, selectedTerminal, selectedDirection], ApiLoadFlow);
onMounted(ApiLoadFlow);
</script>

<template lang="pug">
.PageTraffic
  //- 頁首
  .PageTraffic__header
    .PageTraffic__header-label AIRPORT INTELLIGENCE
    h1.PageTraffic__header-title 機場人流預測
    p.PageTraffic__header-sub 24-HOUR PASSENGER FLOW FORECAST

  //- 雙欄：左（圖表）右（氣象）
  .PageTraffic__layout

    //- 左欄
    .PageTraffic__main

      //- 篩選列
      .PageTraffic__filters
        .PageTraffic__filter-group
          label.PageTraffic__filter-label 日期
          .PageTraffic__date-shortcuts
            button.PageTraffic__shortcut(
              v-for="s in DATE_SHORTCUTS"
              :key="s.offset"
              @click="SetDateOffset(s.offset)"
              :class="{ 'is-active': selectedDate === $dayjs().add(s.offset, 'day').format('YYYY-MM-DD') }"
            ) {{ s.label }}

        .PageTraffic__filter-group
          label.PageTraffic__filter-label 航廈
          .PageTraffic__seg
            button.PageTraffic__seg-btn(
              v-for="opt in TERMINAL_OPTIONS"
              :key="opt.value"
              :class="{ 'is-active': selectedTerminal === opt.value }"
              @click="selectedTerminal = opt.value as any"
            ) {{ opt.label }}

        .PageTraffic__filter-group
          label.PageTraffic__filter-label 方向
          .PageTraffic__seg
            button.PageTraffic__seg-btn(
              v-for="opt in DIRECTION_OPTIONS"
              :key="opt.value"
              :class="{ 'is-active': selectedDirection === opt.value }"
              @click="selectedDirection = opt.value as any"
            ) {{ opt.label }}

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
          .PageTraffic__stat-label 日期
          .PageTraffic__stat-val {{ selectedDate }}
          .PageTraffic__stat-unit {{ terminalLabel }}

      //- 模擬資料警告（依 mockReason 顯示精準訊息）
      .PageTraffic__mock-badge(v-if="isMockData && !loading")
        span {{ mockMessage }}

      //- 圖表區
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
      .PageTraffic__aside-title WEATHER · 桃園機場
      WeatherWidget
</template>

<style lang="scss" scoped>

.PageTraffic {
  padding: 80px 20px 32px;
  min-height: 100svh;
  background: var(--surface-deep);
  color: var(--surface-raised);
}

// ── 頁首 ──────────────────────────────────────────────────
.PageTraffic__header { margin-bottom: 28px; }

.PageTraffic__header-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  &::before { content: ''; width: 20px; height: 1.5px; background: var(--da-amber); }
}

.PageTraffic__header-title {
  font-family: var(--ff-display);
  font-size: var(--fs-display);
  color: var(--surface-raised);
  letter-spacing: var(--ls-snug);
  line-height: var(--lh-flat);
}

.PageTraffic__header-sub {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-kicker);
  color: var(--surface-a30);
  margin-top: 4px;
}

// ── 雙欄版型 ──────────────────────────────────────────────
.PageTraffic__layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.PageTraffic__main {
  flex: 1;
  min-width: 0;
}

.PageTraffic__aside {
  width: 260px;
  flex-shrink: 0;
  position: sticky;
  top: 72px;
}

// ── 手機（< 768px）：雙欄 → 單欄、aside 移到底部 ──────────
@media (max-width: 767.98px) {
  .PageTraffic {
    padding: 72px 14px 28px;
  }

  .PageTraffic__header { margin-bottom: 20px; }
  .PageTraffic__header-title { font-size: var(--fs-h1); }

  .PageTraffic__layout {
    flex-direction: column;
    gap: 16px;
  }

  .PageTraffic__aside {
    width: 100%;
    position: static;
    order: 2;
  }

  .PageTraffic__filters {
    gap: 10px;
    margin-bottom: 16px;
  }

  .PageTraffic__filter-group {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  // 統計三欄 → 兩欄（小手機再降 1 欄）
  .PageTraffic__stats {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .PageTraffic__stat-card { padding: 12px 14px; }
  .PageTraffic__stat-val { font-size: var(--fs-h2); }

  .PageTraffic__chart-wrapper {
    height: 280px;
    padding: 12px;
  }
}

@media (max-width: 479.98px) {
  .PageTraffic__stats {
    grid-template-columns: 1fr;
  }

  .PageTraffic__seg-btn,
  .PageTraffic__shortcut {
    padding: 6px 12px;
    font-size: var(--fs-label);
  }
}

.PageTraffic__aside-title {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--note);
  margin-bottom: 10px;
}

// ── 篩選列 ────────────────────────────────────────────────
.PageTraffic__filters {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 24px;
}

.PageTraffic__filter-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.PageTraffic__filter-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--surface-a30);
  min-width: 36px;
}

.PageTraffic__date-shortcuts {
  display: flex;
  gap: 6px;
}

.PageTraffic__shortcut {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 5px 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--surface-a12);
  background: transparent;
  color: var(--surface-a50);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &.is-active {
    background: var(--da-amber);
    border-color: var(--da-amber);
    color: var(--surface-raised);
  }
}


.PageTraffic__seg {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  row-gap: 6px;
}

.PageTraffic__seg-btn {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
  padding: 5px 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--surface-a12);
  background: transparent;
  color: var(--surface-a40);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &.is-active {
    background: var(--accent-a20);
    border-color: var(--accent-a50);
    color: var(--da-amber);
  }
}

// ── 統計摘要 ──────────────────────────────────────────────
.PageTraffic__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.PageTraffic__stat-card {
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-lg);
  padding: 14px 16px;

  &.is-peak {
    border-color: var(--accent-a30);
    background: var(--accent-a06);
  }
}

.PageTraffic__stat-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps-lg);
  text-transform: uppercase;
  color: var(--surface-a30);
  margin-bottom: 4px;
}

.PageTraffic__stat-val {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h2);
  color: var(--surface-raised);
  line-height: var(--lh-flat);
  letter-spacing: var(--ls-snug);

  .is-peak & { color: var(--da-amber); }
}

.PageTraffic__stat-unit {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a30);
  margin-top: 2px;
}

// ── 模擬資料警告 ───────────────────────────────────────────
.PageTraffic__mock-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--wait-a08);
  border: 1px solid var(--wait-a30);
  border-radius: var(--r-sm);
  padding: 8px 12px;
  margin-bottom: 14px;

  span {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--ls-label);
    color: var(--wait);
  }
}

// ── 圖表 ──────────────────────────────────────────────────
.PageTraffic__chart-wrapper {
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-lg);
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
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-md);
  padding: 14px 16px;
}

.PageTraffic__suggest-icon { font-size: var(--fs-body-lg); flex-shrink: 0; margin-top: 1px; }

.PageTraffic__suggest-text {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--surface-a72);
  line-height: var(--lh-normal);

  strong { color: var(--da-amber); font-weight: 700; }
}
</style>
