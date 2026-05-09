<script setup lang="ts">
// P19：driver/trip 重寫
// 移除上下線按鈕（GPS watch 由 layout 接管）
// 顯示「我的任務列表」+ 每張卡片狀態對應主按鈕（前往/到點/上車/下車）
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const driverGeo = useDriverGeolocation();

interface ActionConfig {
  next: 'en_route' | 'arrived_pickup' | 'in_transit' | 'completed';
  label: string;
}

// 用 Record<string, ...> 讓 template 不用 type cast；TypeScript 對 missing key 容錯
const ACTION_BY_STATUS: Record<string, ActionConfig> = {
  confirmed:       { next: 'en_route',       label: '前往上車點' },
  en_route:        { next: 'arrived_pickup', label: '已到達上車點' },
  arrived_pickup:  { next: 'in_transit',     label: '乘客已上車' },
  in_transit:      { next: 'completed',      label: '乘客已下車（完成）' },
};

const STATUS_LABEL: Record<string, string> = {
  confirmed:      '已接單',
  en_route:       '前往上車',
  arrived_pickup: '已到達上車點',
  in_transit:     '行程中',
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  'airport-pickup':  '接機',
  'airport-dropoff': '送機',
  'charter':         '包車',
  'transfer':        '接送',
};

const VEHICLE_LABEL: Record<string, string> = {
  sedan: '商務轎車', mpv: '商務 MPV', suv: '商務 SUV', van: '廂型車',
};

const orders = ref<AssignedOrder[]>([]);
const loading = ref(false);
const advancing = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const ApiLoadAssignedOrders = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAssignedOrders();
    if (res.status.code === $enum.apiStatus.success && Array.isArray(res.data)) {
      orders.value = res.data as AssignedOrder[];
    } else {
      console.error('[driver/trip] load failed:', res.status.message);
      orders.value = [];
    }
  } finally {
    loading.value = false;
  }
};

const ClickAdvance = async (order: AssignedOrder) => {
  if (advancing.value) return;
  const cfg = ACTION_BY_STATUS[order.orderStatus];
  if (!cfg) return;

  advancing.value = order.orderId;
  try {
    // P19：操作訂單時即時上傳當前座標（跳過 5m / 60s / accuracy 檢查）
    await driverGeo.UploadNow();

    const res = await $api.PatchOrder(order.orderId, { orderStatus: cfg.next });
    if (res.status.code === $enum.apiStatus.success) {
      ElMessage({ message: `已更新：${cfg.label}`, type: 'success' });
      await ApiLoadAssignedOrders(); // completed 會從列表消失
    } else {
      ElMessage({ message: '狀態更新失敗，請重試', type: 'error' });
    }
  } catch (err) {
    console.error('[driver/trip] advance failed:', err);
    ElMessage({ message: '狀態更新失敗', type: 'error' });
  } finally {
    advancing.value = null;
  }
};

const _OnVisibilityChange = () => {
  if (!document.hidden) ApiLoadAssignedOrders();
};

onMounted(() => {
  ApiLoadAssignedOrders();
  pollTimer = setInterval(ApiLoadAssignedOrders, 30_000);
  document.addEventListener('visibilitychange', _OnVisibilityChange);
});

onUnmounted(() => {
  if (pollTimer !== null) clearInterval(pollTimer);
  document.removeEventListener('visibilitychange', _OnVisibilityChange);
});
</script>

<template lang="pug">
.PageDriverTrip
  //- 頁首
  .PageDriverTrip__header
    .PageDriverTrip__header-label MISSION CONTROL
    h1.PageDriverTrip__header-title 我的任務
    p.PageDriverTrip__header-sub DRIVER OPERATIONS

  //- Loading
  .PageDriverTrip__loading(v-if="loading && !orders.length")
    .PageDriverTrip__spinner

  //- 空狀態
  .PageDriverTrip__empty(v-else-if="!orders.length")
    .PageDriverTrip__empty-icon 📭
    p 目前沒有指派任務
    small 請至「搶單」頁查看可接訂單

  //- 任務列表
  template(v-else)
    .PageDriverTrip__card(v-for="order in orders" :key="order.orderId")
      //- 卡片頭：類型 / 車型 / 訂單號 / 當前狀態
      .PageDriverTrip__card-head
        .PageDriverTrip__type-badge {{ ORDER_TYPE_LABEL[order.orderType] ?? order.orderType }}
        .PageDriverTrip__vehicle {{ VEHICLE_LABEL[order.vehicleType] ?? order.vehicleType }}
        .PageDriverTrip__id \#{{ order.orderId.slice(-6).toUpperCase() }}

      //- 當前狀態徽章
      .PageDriverTrip__status-badge(:class="`is-${order.orderStatus}`")
        | {{ STATUS_LABEL[order.orderStatus] }}

      //- 用車時間
      .PageDriverTrip__time
        span.PageDriverTrip__time-label 用車時間
        span.PageDriverTrip__time-val {{ $dayjs(order.pickupDateTime).format('MM/DD HH:mm') }}

      //- 路線
      .PageDriverTrip__route
        .PageDriverTrip__route-point.is-pickup
          .PageDriverTrip__route-dot
          span {{ order.pickupLocation?.displayName || order.pickupLocation?.address }}
        .PageDriverTrip__route-line
        .PageDriverTrip__route-point.is-dropoff
          .PageDriverTrip__route-dot
          span {{ order.dropoffLocation?.displayName || order.dropoffLocation?.address }}

      //- meta：距離 / 估價
      .PageDriverTrip__meta
        span {{ order.distanceKm }} km
        span NT$ {{ order.estimatedFare.toLocaleString() }}
        span(v-if="order.passengerCount > 1") {{ order.passengerCount }} 人

      //- 主操作按鈕
      button.PageDriverTrip__action(
        :disabled="advancing === order.orderId"
        @click="ClickAdvance(order)"
      ) {{ advancing === order.orderId ? '處理中...' : ACTION_BY_STATUS[order.orderStatus]?.label }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageDriverTrip {
  padding: 20px 16px 100px;
  min-height: 100vh;
  background: var(--da-dark);
  color: #fff;
}

// ── 頁首 ──────────────────────────────────────────────────
.PageDriverTrip__header {
  margin-bottom: 24px;
}

.PageDriverTrip__header-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: $amber;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  &::before { content: ''; width: 20px; height: 1.5px; background: $amber; }
}

.PageDriverTrip__header-title {
  font-family: $font-display;
  font-size: 36px;
  letter-spacing: 0.04em;
  color: #fff;
  line-height: 1;
}

.PageDriverTrip__header-sub {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 4px;
}

// ── Loading ───────────────────────────────────────────────
.PageDriverTrip__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageDriverTrip__spinner {
  width: 28px; height: 28px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 空狀態 ────────────────────────────────────────────────
.PageDriverTrip__empty {
  text-align: center;
  padding: 60px 0;
}

.PageDriverTrip__empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.PageDriverTrip__empty p {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.5);
}

.PageDriverTrip__empty small {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.25);
}

// ── 任務卡片 ──────────────────────────────────────────────
.PageDriverTrip__card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 14px;
}

.PageDriverTrip__card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.PageDriverTrip__type-badge {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  border-radius: 100px;
  background: rgba($amber, 0.15);
  border: 1px solid rgba($amber, 0.3);
  color: $amber;
}

.PageDriverTrip__vehicle {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.4);
}

.PageDriverTrip__id {
  font-family: $font-condensed;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
  margin-left: auto;
  letter-spacing: 0.08em;
}

// 當前狀態徽章
.PageDriverTrip__status-badge {
  display: inline-block;
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 4px 12px;
  border-radius: 8px;
  margin-bottom: 12px;

  &.is-confirmed       { background: rgba(74, 222, 128, 0.12); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); }
  &.is-en_route        { background: rgba(96, 165, 250, 0.12); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); }
  &.is-arrived_pickup  { background: rgba(251, 191, 36, 0.12); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); }
  &.is-in_transit      { background: rgba($amber, 0.12); color: $amber; border: 1px solid rgba($amber, 0.4); }
}

// 用車時間
.PageDriverTrip__time {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.PageDriverTrip__time-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
}

.PageDriverTrip__time-val {
  font-family: $font-display;
  font-size: 18px;
  color: #fff;
  letter-spacing: 0.05em;
}

// 路線
.PageDriverTrip__route {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 14px;
}

.PageDriverTrip__route-point {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  span {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.75);
    line-height: 1.4;
    padding: 2px 0;
  }
}

.PageDriverTrip__route-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;

  .is-pickup & { background: $amber; }
  .is-dropoff & { background: transparent; border: 2px solid rgba(255, 255, 255, 0.4); }
}

.PageDriverTrip__route-line {
  width: 1.5px;
  height: 14px;
  background: rgba(255, 255, 255, 0.12);
  margin-left: 4px;
}

// meta
.PageDriverTrip__meta {
  display: flex;
  gap: 14px;
  padding: 12px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 14px;
}

.PageDriverTrip__meta span {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.05em;
}

// 主操作按鈕
.PageDriverTrip__action {
  width: 100%;
  font-family: $font-condensed;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 14px 20px;
  border-radius: 12px;
  border: none;
  background: $amber;
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.6; cursor: not-allowed; }

  &:active:not(:disabled) { transform: scale(0.98); }
}
</style>
