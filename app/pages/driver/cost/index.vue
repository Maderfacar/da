<script setup lang="ts">
// PageDriverCost 司機營運成本與損益計算器
//
// 改自 driver/driver.html（v2）：
//   - 移除：header 標題列 / footer / 兩張 chart.js 圖表 / 每月+每年損益兩個結果欄位
//   - 保留：即時結果（3 項）/ 成本項目設定（9 項）/ 營運參數（3 項）/ 每公里成本明細
//   - 新增：localStorage 持久化（key='driver-cost-calculator-v1'），下次回來輸入值還在
//
// 計算邏輯沿用原 driver.html calculate()：
//   monthlyFixed = 車貸 + 保險 + 保養 + 停車 + 勞健保
//   monthlyKm = dailyKm × workDays
//   monthlyTire = (monthlyKm / 50000) × tireCost
//   monthlyMisc = miscDaily × workDays
//   monthlyOil/Toll = 各自 perKm × monthlyKm
//   dailyTotalCost = (monthlyFixed + monthlyOil + monthlyToll + monthlyTire + monthlyMisc) / workDays
//   costPerKm = dailyTotalCost / dailyKm
//   dailyProfit = dailyRevenue − dailyTotalCost

definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

// ── 輸入欄位 ─────────────────────────────────────────────
// 每月固定
const carLoan = ref(30000);
const insurance = ref(1667);
const maintenance = ref(5000);
const parking = ref(3500);
const laborIns = ref(2950);
// 每公里變動
const oilPerKm = ref(2.5);
const tollPerKm = ref(0.83);
const tireCost = ref(20000);
// 每上班日
const miscDaily = ref(500);
// 營運參數
const dailyKm = ref(300);
const dailyRevenue = ref(3000);
const workDays = ref(20);

// ── 計算（純 computed，依賴變動自動 reactive）─────────────────
const monthlyFixed = computed(() =>
  carLoan.value + insurance.value + maintenance.value + parking.value + laborIns.value,
);
const monthlyKm = computed(() => dailyKm.value * Math.max(workDays.value, 1));
const monthlyTire = computed(() => (monthlyKm.value / 50000) * tireCost.value);
const monthlyMisc = computed(() => miscDaily.value * Math.max(workDays.value, 1));
const monthlyOil = computed(() => oilPerKm.value * monthlyKm.value);
const monthlyToll = computed(() => tollPerKm.value * monthlyKm.value);
const monthlyVariable = computed(() =>
  monthlyOil.value + monthlyToll.value + monthlyTire.value + monthlyMisc.value,
);
const monthlyTotalCost = computed(() => monthlyFixed.value + monthlyVariable.value);
const dailyTotalCost = computed(() => monthlyTotalCost.value / Math.max(workDays.value, 1));
const costPerKmTotal = computed(() => (dailyKm.value > 0 ? dailyTotalCost.value / dailyKm.value : 0));
const dailyProfit = computed(() => dailyRevenue.value - dailyTotalCost.value);

const tirePerKm = computed(() => tireCost.value / 50000);

// 每公里成本明細（template 用）
const breakdownRows = computed(() => [
  { label: '車貸',       perKm: monthlyKm.value > 0 ? carLoan.value / monthlyKm.value : 0 },
  { label: '保險',       perKm: monthlyKm.value > 0 ? insurance.value / monthlyKm.value : 0 },
  { label: '車輛保養',   perKm: monthlyKm.value > 0 ? maintenance.value / monthlyKm.value : 0 },
  { label: '停車月租',   perKm: monthlyKm.value > 0 ? parking.value / monthlyKm.value : 0 },
  { label: '勞健保',     perKm: monthlyKm.value > 0 ? laborIns.value / monthlyKm.value : 0 },
  { label: '油費',       perKm: oilPerKm.value },
  { label: '過路費',     perKm: tollPerKm.value },
  { label: '輪胎',       perKm: tirePerKm.value },
  { label: '雜項開支',   perKm: dailyKm.value > 0 ? miscDaily.value / dailyKm.value : 0 },
]);

const profitLabel = computed(() =>
  `${dailyProfit.value.toFixed(0)} 元（${dailyProfit.value < 0 ? '虧損' : '獲利'}）`,
);

// ── localStorage 持久化 ─────────────────────────────────
const STORAGE_KEY = 'driver-cost-calculator-v1';

interface PersistedState {
  carLoan: number; insurance: number; maintenance: number; parking: number; laborIns: number;
  oilPerKm: number; tollPerKm: number; tireCost: number;
  miscDaily: number;
  dailyKm: number; dailyRevenue: number; workDays: number;
}

const _LoadFromStorage = () => {
  if (!import.meta.client) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Partial<PersistedState>;
    if (typeof data.carLoan === 'number') carLoan.value = data.carLoan;
    if (typeof data.insurance === 'number') insurance.value = data.insurance;
    if (typeof data.maintenance === 'number') maintenance.value = data.maintenance;
    if (typeof data.parking === 'number') parking.value = data.parking;
    if (typeof data.laborIns === 'number') laborIns.value = data.laborIns;
    if (typeof data.oilPerKm === 'number') oilPerKm.value = data.oilPerKm;
    if (typeof data.tollPerKm === 'number') tollPerKm.value = data.tollPerKm;
    if (typeof data.tireCost === 'number') tireCost.value = data.tireCost;
    if (typeof data.miscDaily === 'number') miscDaily.value = data.miscDaily;
    if (typeof data.dailyKm === 'number') dailyKm.value = data.dailyKm;
    if (typeof data.dailyRevenue === 'number') dailyRevenue.value = data.dailyRevenue;
    if (typeof data.workDays === 'number') workDays.value = data.workDays;
  } catch (err) {
    console.warn('[driver/cost] localStorage load failed:', err);
  }
};

const _SaveToStorage = () => {
  if (!import.meta.client) return;
  try {
    const payload: PersistedState = {
      carLoan: carLoan.value,
      insurance: insurance.value,
      maintenance: maintenance.value,
      parking: parking.value,
      laborIns: laborIns.value,
      oilPerKm: oilPerKm.value,
      tollPerKm: tollPerKm.value,
      tireCost: tireCost.value,
      miscDaily: miscDaily.value,
      dailyKm: dailyKm.value,
      dailyRevenue: dailyRevenue.value,
      workDays: workDays.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[driver/cost] localStorage save failed:', err);
  }
};

onMounted(_LoadFromStorage);

// 任一欄位變動 → 寫 localStorage（reactivity 自動觸發）
watch(
  [carLoan, insurance, maintenance, parking, laborIns,
    oilPerKm, tollPerKm, tireCost, miscDaily,
    dailyKm, dailyRevenue, workDays],
  _SaveToStorage,
);
</script>

<template lang="pug">
.PageDriverCost
  //- ── 即時計算結果（3 項：每日總成本 / 每公里成本 / 每日損益）─────
  .PageDriverCost__result-section
    h2.PageDriverCost__heading 即時計算結果
    .PageDriverCost__result-box
      .PageDriverCost__result-item
        span 每日總成本
        span.PageDriverCost__result-val {{ dailyTotalCost.toFixed(0) }} 元
      .PageDriverCost__result-item
        span 每公里成本
        span.PageDriverCost__result-val {{ costPerKmTotal.toFixed(2) }} 元/km
      .PageDriverCost__result-item
        span 每日損益
        span.PageDriverCost__result-val(:class="dailyProfit >= 0 ? 'is-positive' : 'is-negative'")
          | {{ profitLabel }}

  //- ── 1. 成本項目設定 ────────────────────────────────────────
  section.PageDriverCost__section
    h2.PageDriverCost__heading 1. 成本項目設定
    table.PageDriverCost__cost-table
      thead
        tr
          th 項目
          th 單位
          th 數值
      tbody
        //- 每月固定
        tr
          td 車貸
          td 每月
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="carLoan")
        tr
          td 保險
          td 每月
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="insurance")
        tr
          td 車輛保養
          td 每月
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="maintenance")
        tr
          td 停車月租
          td 每月
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="parking")
        tr
          td 勞健保
          td 每月
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="laborIns")
        //- 每公里變動
        tr
          td 油費
          td 每公里
          td
            input.PageDriverCost__input(type="number" inputmode="decimal" step="0.01" v-model.number="oilPerKm")
        tr
          td 過路費
          td 每公里
          td
            input.PageDriverCost__input(type="number" inputmode="decimal" step="0.01" v-model.number="tollPerKm")
        tr
          td 輪胎
          td 每5萬公里
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="tireCost")
        //- 每上班日
        tr
          td 雜項開支
          td 每上班日
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="miscDaily")

  //- ── 2. 營運參數 ─────────────────────────────────────────────
  section.PageDriverCost__section.is-alt
    h2.PageDriverCost__heading 2. 營運參數（每日輸入，可即時試算）
    table.PageDriverCost__cost-table
      tbody
        tr
          td 每日行駛里程
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="dailyKm")
        tr
          td 每日營業收入
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="dailyRevenue")
        tr
          td 每月上班天數
          td
            input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="workDays")

  //- ── 3. 每公里成本明細拆解 ──────────────────────────────────
  section.PageDriverCost__section
    h2.PageDriverCost__heading 3. 每公里成本明細拆解
    table.PageDriverCost__breakdown-table
      thead
        tr
          th 項目
          th.PageDriverCost__breakdown-num 每公里金額
      tbody
        tr(v-for="row in breakdownRows" :key="row.label")
          td {{ row.label }}
          td.PageDriverCost__breakdown-num {{ row.perKm.toFixed(2) }}
        tr.PageDriverCost__breakdown-total
          td 總計
          td.PageDriverCost__breakdown-num {{ costPerKmTotal.toFixed(2) }} 元
</template>

<style lang="scss" scoped>
$primary: #2c3e50;
$accent: #3498db;
$muted: #7f8c8d;
$border: #ecf0f1;

.PageDriverCost {
  max-width: 1280px;
  margin: 0 auto;
  padding: 20px;
  background: #f4f6f9;
  min-height: 100svh;
  color: $primary;
  font-family: 'Noto Sans TC', system-ui, sans-serif;
}

// ── 共用：每段區塊 ─────────────────────────────────────────
.PageDriverCost__section {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  padding: 24px;
  margin-bottom: 20px;
}

.PageDriverCost__section.is-alt {
  background: #f8f9fa;
}

.PageDriverCost__heading {
  font-size: 1.2rem;
  font-weight: 700;
  color: $primary;
  margin-bottom: 14px;
}

// ── 即時計算結果 ──────────────────────────────────────────
.PageDriverCost__result-section {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  padding: 24px;
  margin-bottom: 20px;
}

.PageDriverCost__result-box {
  background: #f8f9fa;
  border-radius: 10px;
  padding: 8px 18px;
}

.PageDriverCost__result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid $border;
  font-size: 1.1rem;
}

.PageDriverCost__result-item:last-child { border-bottom: none; }

.PageDriverCost__result-val {
  font-weight: 700;
  font-size: 1.25rem;
}

.PageDriverCost__result-val.is-positive { color: #27ae60; }
.PageDriverCost__result-val.is-negative { color: #e74c3c; }

// ── 表格 ──────────────────────────────────────────────────
.PageDriverCost__cost-table {
  width: 100%;
  border-collapse: collapse;
}

.PageDriverCost__cost-table th,
.PageDriverCost__cost-table td {
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid $border;
  font-size: 0.98rem;
}

.PageDriverCost__cost-table th {
  background: #f8f9fa;
  font-weight: 600;
  width: 28%;
}

.PageDriverCost__cost-table tr:last-child td { border-bottom: none; }

.PageDriverCost__input {
  width: 100%;
  padding: 8px 12px;
  border: 2px solid #dfe6e9;
  border-radius: 8px;
  text-align: right;
  font-size: 1rem;
  font-family: inherit;
  background: #fff;
}

.PageDriverCost__input:focus {
  outline: none;
  border-color: $accent;
}

// ── 每公里明細 ────────────────────────────────────────────
.PageDriverCost__breakdown-table {
  width: 100%;
  background: #f8f9fa;
  border-radius: 10px;
  overflow: hidden;
  border-collapse: collapse;
}

.PageDriverCost__breakdown-table th,
.PageDriverCost__breakdown-table td {
  padding: 12px 16px;
  border-bottom: 1px solid $border;
  font-size: 0.98rem;
}

.PageDriverCost__breakdown-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.PageDriverCost__breakdown-total {
  background: $border;
  font-weight: 700;
}

.PageDriverCost__breakdown-total td { font-size: 1.05rem; }

// ── 手機版調整 ────────────────────────────────────────────
@media (max-width: 600px) {
  .PageDriverCost { padding: 12px; }
  .PageDriverCost__section,
  .PageDriverCost__result-section { padding: 16px; }
  .PageDriverCost__cost-table th { width: 36%; }
  .PageDriverCost__cost-table th,
  .PageDriverCost__cost-table td { padding: 10px 8px; font-size: 0.9rem; }
}
</style>
