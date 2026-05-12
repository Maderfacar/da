<script setup lang="ts">
// PageDriverCost 司機營運成本與損益計算器
//
// 改自 driver/driver.html（v2）：
//   - 移除：header 標題列 / footer / 兩張 chart.js 圖表 / 每月+每年損益兩個結果欄位
//   - 保留：即時結果（3 項）/ 成本項目設定（9 項）/ 營運參數（3 項）/ 每公里成本明細
//
// P30：跟帳號走（取代原本的 localStorage 持久化）
//   - 12 欄位預設 0（過往為 driver.html v2 範例值，已改為 0 讓 driver 自行輸入）
//   - onMounted：client SDK 讀 drivers/{uid}.costSettings 套入
//   - 「儲存到帳號」按鈕：PATCH /nuxt-api/drivers/me/cost-settings 寫 Firestore
//   - 跨裝置 / 重登後仍可載入
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
import type { DriverCostSettings } from '@/protocol/fetch-api/api/driver';

definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const authStore = StoreAuth();
const { user } = storeToRefs(authStore);
const lineUid = computed(() => {
  const uid = user.value?.uid ?? '';
  return uid.startsWith('line:') ? uid.slice(5) : uid;
});

// ── 輸入欄位（P30：預設 0，等 driver 輸入後存到帳號）─────────────
// 每月固定
const carLoan = ref(0);
const insurance = ref(0);
const maintenance = ref(0);
const parking = ref(0);
const laborIns = ref(0);
// 每公里變動
const oilPerKm = ref(0);
const tollPerKm = ref(0);
const tireCost = ref(0);
// 每上班日
const miscDaily = ref(0);
// 營運參數
const dailyKm = ref(0);
const dailyRevenue = ref(0);
const workDays = ref(0);

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

const tirePerKm = computed(() => (tireCost.value > 0 ? tireCost.value / 50000 : 0));

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

// ── 跟帳號走：load + save ────────────────────────────────────
const loading = ref(false);
const saving = ref(false);

const ApiLoadCostSettings = async () => {
  if (!lineUid.value) return;
  loading.value = true;
  try {
    const { getFirestore, doc, getDoc } = await import('firebase/firestore');
    const { getApps } = await import('firebase/app');
    const app = getApps()[0];
    if (!app) return;
    const db = getFirestore(app);
    const snap = await getDoc(doc(db, 'drivers', lineUid.value));
    if (!snap.exists()) return;
    const settings = snap.data()?.costSettings as DriverCostSettings | undefined;
    if (!settings) return;

    if (typeof settings.carLoan === 'number') carLoan.value = settings.carLoan;
    if (typeof settings.insurance === 'number') insurance.value = settings.insurance;
    if (typeof settings.maintenance === 'number') maintenance.value = settings.maintenance;
    if (typeof settings.parking === 'number') parking.value = settings.parking;
    if (typeof settings.laborIns === 'number') laborIns.value = settings.laborIns;
    if (typeof settings.oilPerKm === 'number') oilPerKm.value = settings.oilPerKm;
    if (typeof settings.tollPerKm === 'number') tollPerKm.value = settings.tollPerKm;
    if (typeof settings.tireCost === 'number') tireCost.value = settings.tireCost;
    if (typeof settings.miscDaily === 'number') miscDaily.value = settings.miscDaily;
    if (typeof settings.dailyKm === 'number') dailyKm.value = settings.dailyKm;
    if (typeof settings.dailyRevenue === 'number') dailyRevenue.value = settings.dailyRevenue;
    if (typeof settings.workDays === 'number') workDays.value = settings.workDays;
  } catch (err) {
    console.warn('[driver/cost] load from Firestore failed:', err);
  } finally {
    loading.value = false;
  }
};

const ClickSave = async () => {
  saving.value = true;
  const res = await $api.UpdateDriverCostSettings({
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
  });
  saving.value = false;
  if (res.status.code === 200) {
    ElMessage({ message: '已儲存到您的帳號', type: 'success' });
  } else {
    ElMessage({ message: res.status.message.zh_tw ?? '儲存失敗', type: 'error' });
  }
};

onMounted(ApiLoadCostSettings);
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

  //- ── 儲存到帳號（P30 新增）──────────────────────────────────
  .PageDriverCost__save-bar
    button.PageDriverCost__save-btn(
      :disabled="saving || loading"
      @click="ClickSave"
    )
      template(v-if="saving") 儲存中...
      template(v-else-if="loading") 載入中...
      template(v-else) 儲存到我的帳號
    .PageDriverCost__save-hint 儲存後跨裝置 / 重新登入皆可載入
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

// ── 儲存區（P30）──────────────────────────────────────────
.PageDriverCost__save-bar {
  position: sticky;
  bottom: 16px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 20px;
}

.PageDriverCost__save-btn {
  padding: 12px 24px;
  border-radius: 10px;
  border: none;
  background: $accent;
  color: #fff;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  min-width: 160px;

  &:hover:not(:disabled) { background: darken($accent, 8%); }
  &:active:not(:disabled) { transform: scale(0.98); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
}

.PageDriverCost__save-hint {
  font-size: 0.85rem;
  color: $muted;
  flex: 1;
  text-align: right;
}

// ── 手機版調整 ────────────────────────────────────────────
@media (max-width: 600px) {
  .PageDriverCost { padding: 12px; }
  .PageDriverCost__section,
  .PageDriverCost__result-section { padding: 16px; }
  .PageDriverCost__cost-table th { width: 36%; }
  .PageDriverCost__cost-table th,
  .PageDriverCost__cost-table td { padding: 10px 8px; font-size: 0.9rem; }

  .PageDriverCost__save-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .PageDriverCost__save-btn { width: 100%; }
  .PageDriverCost__save-hint { text-align: center; }
}
</style>
