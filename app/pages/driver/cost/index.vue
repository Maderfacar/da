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
// P33（2026-05-13）：
//   - 油費 / 過路費 從「每公里」改「每月」直接輸入（與其他每月固定項一致）
//   - Firestore field 改名：oilPerKm → oilMonthly、tollPerKm → tollMonthly
//   - load 向下兼容：先讀新欄位，找不到再讀舊欄位 × 預估每月里程（舊值 × 25 工作日 × 250 公里），
//     或乾脆 fallback 為 0 讓 driver 重新輸入（採後者，避免錯誤推估）
//   - 樣式改為深色 + amber + Barlow Condensed，對齊 driver/dashboard / driver/profile 設計
//
// 計算邏輯（P33 後）：
//   monthlyFixed = 車貸 + 保險 + 保養 + 停車 + 勞健保
//   monthlyKm = dailyKm × workDays
//   monthlyTire = (monthlyKm / 50000) × tireCost
//   monthlyMisc = miscDaily × workDays
//   monthlyOil/Toll = 直接 input
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
// P33：每月變動（原每公里改每月）
const oilMonthly = ref(0);
const tollMonthly = ref(0);
// 每 5 萬公里
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
// P33：油費/過路費直接是每月金額，不再從 perKm × monthlyKm 推算
const monthlyOil = computed(() => oilMonthly.value);
const monthlyToll = computed(() => tollMonthly.value);
const monthlyVariable = computed(() =>
  monthlyOil.value + monthlyToll.value + monthlyTire.value + monthlyMisc.value,
);
const monthlyTotalCost = computed(() => monthlyFixed.value + monthlyVariable.value);
const dailyTotalCost = computed(() => monthlyTotalCost.value / Math.max(workDays.value, 1));
const costPerKmTotal = computed(() => (dailyKm.value > 0 ? dailyTotalCost.value / dailyKm.value : 0));
const dailyProfit = computed(() => dailyRevenue.value - dailyTotalCost.value);

const tirePerKm = computed(() => (tireCost.value > 0 ? tireCost.value / 50000 : 0));
// P33：每公里成本明細裡油費/過路費要倒推每公里值（給明細看）
const oilPerKmDerived = computed(() => (monthlyKm.value > 0 ? oilMonthly.value / monthlyKm.value : 0));
const tollPerKmDerived = computed(() => (monthlyKm.value > 0 ? tollMonthly.value / monthlyKm.value : 0));

// 每公里成本明細（template 用）
const breakdownRows = computed(() => [
  { label: '車貸',       perKm: monthlyKm.value > 0 ? carLoan.value / monthlyKm.value : 0 },
  { label: '保險',       perKm: monthlyKm.value > 0 ? insurance.value / monthlyKm.value : 0 },
  { label: '車輛保養',   perKm: monthlyKm.value > 0 ? maintenance.value / monthlyKm.value : 0 },
  { label: '停車月租',   perKm: monthlyKm.value > 0 ? parking.value / monthlyKm.value : 0 },
  { label: '勞健保',     perKm: monthlyKm.value > 0 ? laborIns.value / monthlyKm.value : 0 },
  { label: '油費',       perKm: oilPerKmDerived.value },
  { label: '過路費',     perKm: tollPerKmDerived.value },
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
    // P33：油費 / 過路費先讀新欄位，找不到時舊欄位（每公里）× 預估每月里程當粗略 fallback
    //      若舊欄位也沒有 → 維持 0 讓 driver 重新輸入（避免錯誤估算誤導）
    if (typeof settings.oilMonthly === 'number') {
      oilMonthly.value = settings.oilMonthly;
    } else if (typeof settings.oilPerKm === 'number' && typeof settings.dailyKm === 'number' && typeof settings.workDays === 'number') {
      const est = settings.dailyKm * Math.max(settings.workDays, 1);
      oilMonthly.value = settings.oilPerKm * est;
    }
    if (typeof settings.tollMonthly === 'number') {
      tollMonthly.value = settings.tollMonthly;
    } else if (typeof settings.tollPerKm === 'number' && typeof settings.dailyKm === 'number' && typeof settings.workDays === 'number') {
      const est = settings.dailyKm * Math.max(settings.workDays, 1);
      tollMonthly.value = settings.tollPerKm * est;
    }
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
  // P33：只寫新欄位 oilMonthly / tollMonthly；舊欄位 server 仍接受寫入以兼容
  //      但本 client 不再寫，舊欄位會逐筆 driver 個人 migration 自然淘汰
  const res = await $api.UpdateDriverCostSettings({
    carLoan: carLoan.value,
    insurance: insurance.value,
    maintenance: maintenance.value,
    parking: parking.value,
    laborIns: laborIns.value,
    oilMonthly: oilMonthly.value,
    tollMonthly: tollMonthly.value,
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
  //- 頁首（對齊 driver/dashboard 設計）
  .PageDriverCost__header
    .PageDriverCost__header-label COST CALCULATOR
    h1.PageDriverCost__header-title 損益計算
    p.PageDriverCost__header-sub 營運成本試算與每公里成本拆解

  //- ── 即時計算結果（3 項：每日總成本 / 每公里成本 / 每日損益）─────
  section.PageDriverCost__section
    .PageDriverCost__section-label LIVE RESULT
    .PageDriverCost__result-stats
      .PageDriverCost__stat
        .PageDriverCost__stat-label DAILY COST
        .PageDriverCost__stat-val {{ dailyTotalCost.toFixed(0) }}
        .PageDriverCost__stat-unit 每日總成本 · NT$
      .PageDriverCost__stat
        .PageDriverCost__stat-label PER KM
        .PageDriverCost__stat-val {{ costPerKmTotal.toFixed(2) }}
        .PageDriverCost__stat-unit 每公里成本 · 元/km
      .PageDriverCost__stat(:class="dailyProfit >= 0 ? 'is-positive' : 'is-negative'")
        .PageDriverCost__stat-label DAILY P/L
        .PageDriverCost__stat-val {{ dailyProfit.toFixed(0) }}
        .PageDriverCost__stat-unit {{ dailyProfit >= 0 ? '今日獲利' : '今日虧損' }} · NT$

  //- ── 1. 成本項目設定 ────────────────────────────────────────
  section.PageDriverCost__section
    .PageDriverCost__section-label STEP 01
    h2.PageDriverCost__heading 成本項目設定

    .PageDriverCost__field-list
      //- 每月固定
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 車貸
          small 每月
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="carLoan" placeholder="0")
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 保險
          small 每月
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="insurance" placeholder="0")
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 車輛保養
          small 每月
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="maintenance" placeholder="0")
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 停車月租
          small 每月
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="parking" placeholder="0")
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 勞健保
          small 每月
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="laborIns" placeholder="0")

      //- P33：油費 / 過路費 改每月直接輸入
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 油費
          small 每月
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="oilMonthly" placeholder="0")
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 過路費
          small 每月
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="tollMonthly" placeholder="0")

      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 輪胎
          small 每 5 萬公里
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="tireCost" placeholder="0")

      //- 每上班日
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 雜項開支
          small 每上班日
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="miscDaily" placeholder="0")

  //- ── 2. 營運參數 ─────────────────────────────────────────────
  section.PageDriverCost__section
    .PageDriverCost__section-label STEP 02
    h2.PageDriverCost__heading 營運參數
    p.PageDriverCost__heading-sub 可即時試算

    .PageDriverCost__field-list
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 每日行駛里程
          small 公里
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="dailyKm" placeholder="0")
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 每日營業收入
          small NT$
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="dailyRevenue" placeholder="0")
      .PageDriverCost__field
        label.PageDriverCost__field-label
          span 每月上班天數
          small 天
        input.PageDriverCost__input(type="number" inputmode="numeric" v-model.number="workDays" placeholder="0")

  //- ── 3. 每公里成本明細拆解 ──────────────────────────────────
  section.PageDriverCost__section
    .PageDriverCost__section-label STEP 03
    h2.PageDriverCost__heading 每公里成本明細

    .PageDriverCost__breakdown
      .PageDriverCost__breakdown-row(v-for="row in breakdownRows" :key="row.label")
        span.PageDriverCost__breakdown-label {{ row.label }}
        span.PageDriverCost__breakdown-num {{ row.perKm.toFixed(2) }}
      .PageDriverCost__breakdown-row.is-total
        span.PageDriverCost__breakdown-label 總計
        span.PageDriverCost__breakdown-num {{ costPerKmTotal.toFixed(2) }} 元

  //- ── 儲存到帳號（P30 新增）──────────────────────────────────
  .PageDriverCost__save-bar
    button.PageDriverCost__save-btn(
      :disabled="saving || loading"
      @click="ClickSave"
    )
      template(v-if="saving") 儲存中...
      template(v-else-if="loading") 載入中...
      template(v-else) 儲存到我的帳號
    .PageDriverCost__save-hint 跨裝置 / 重新登入皆可載入
</template>

<style lang="scss" scoped>
$amber: #d4860a;

.PageDriverCost {
  padding: 80px 20px 32px;
  min-height: 100svh;
  background: #0d0f14;
  color: #fff;
}

// ── 頁首（對齊 dashboard） ─────────────────────────────────
.PageDriverCost__header {
  margin-bottom: 28px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: $amber;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    &::before { content: ''; width: 20px; height: 1.5px; background: $amber; }
  }

  &-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 40px;
    letter-spacing: 0.04em;
    line-height: 1;
    color: #fff;
  }

  &-sub {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.45);
    margin-top: 6px;
  }
}

// ── Section 卡片 ──────────────────────────────────────────
.PageDriverCost__section {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 16px;
}

.PageDriverCost__section-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: $amber;
  margin-bottom: 10px;
}

.PageDriverCost__heading {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.05em;
  color: #fff;
  line-height: 1;
}

.PageDriverCost__heading-sub {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 4px;
  margin-bottom: 14px;
}

// ── 即時結果（仿 dashboard stat）──────────────────────────
.PageDriverCost__result-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 12px;
}

@media (max-width: 479.98px) {
  .PageDriverCost__result-stats {
    grid-template-columns: 1fr;
  }
}

.PageDriverCost__stat {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;

  &.is-positive { border-color: rgba(80, 200, 120, 0.4); }
  &.is-negative { border-color: rgba(231, 76, 60, 0.45); }
}

.PageDriverCost__stat-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: rgba(255, 255, 255, 0.3);
}

.PageDriverCost__stat-val {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  color: #fff;
  line-height: 1;
  font-variant-numeric: tabular-nums;

  .PageDriverCost__stat.is-positive & { color: #50c878; }
  .PageDriverCost__stat.is-negative & { color: #f87171; }
}

.PageDriverCost__stat-unit {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.45);
}

// ── 欄位列表 ──────────────────────────────────────────────
.PageDriverCost__field-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.PageDriverCost__field {
  display: grid;
  grid-template-columns: 1fr 140px;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  transition: border-color 0.2s;

  &:focus-within { border-color: rgba($amber, 0.5); }
}

.PageDriverCost__field-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  span {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.85);
  }

  small {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    letter-spacing: 0.15em;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
  }
}

.PageDriverCost__input {
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  width: 100%;
  outline: none;

  &::placeholder { color: rgba(255, 255, 255, 0.2); }
  &:focus { border-color: $amber; }
}

// ── 每公里明細 ────────────────────────────────────────────
.PageDriverCost__breakdown {
  margin-top: 12px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 10px;
  overflow: hidden;
}

.PageDriverCost__breakdown-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 11px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;

  &:last-child { border-bottom: none; }

  &.is-total {
    background: rgba($amber, 0.08);
    border-top: 1px solid rgba($amber, 0.3);
    font-weight: 700;
  }
}

.PageDriverCost__breakdown-label {
  color: rgba(255, 255, 255, 0.75);

  .is-total & { color: #fff; font-size: 14px; letter-spacing: 0.06em; }
}

.PageDriverCost__breakdown-num {
  color: rgba(255, 255, 255, 0.9);
  font-variant-numeric: tabular-nums;

  .is-total & { color: $amber; font-size: 15px; font-weight: 700; }
}

// ── 儲存區（P30）──────────────────────────────────────────
.PageDriverCost__save-bar {
  position: sticky;
  bottom: 16px;
  margin-top: 20px;
  background: rgba(20, 23, 30, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.PageDriverCost__save-btn {
  flex-shrink: 0;
  padding: 11px 22px;
  border-radius: 100px;
  border: 1.5px solid rgba($amber, 0.6);
  background: rgba($amber, 0.15);
  color: #f5c842;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;

  &:hover:not(:disabled) { opacity: 0.85; }
  &:active:not(:disabled) { transform: scale(0.98); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.PageDriverCost__save-hint {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.35);
  flex: 1;
  text-align: right;
}

// ── 手機版調整 ────────────────────────────────────────────
@media (max-width: 600px) {
  .PageDriverCost { padding: 72px 14px 28px; }
  .PageDriverCost__section { padding: 16px; }
  .PageDriverCost__header-title { font-size: 32px; }
  .PageDriverCost__heading { font-size: 19px; }
  .PageDriverCost__field {
    grid-template-columns: 1fr 110px;
    padding: 9px 10px;
  }
  .PageDriverCost__input { font-size: 15px; padding: 7px 10px; }

  .PageDriverCost__save-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .PageDriverCost__save-btn { width: 100%; }
  .PageDriverCost__save-hint { text-align: center; }
}
</style>
