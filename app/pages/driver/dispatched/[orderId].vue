<script setup lang="ts">
import type { DriverDispatchedOrderDetail } from '@/protocol/fetch-api/api/driver';

definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const route = useRoute();
const orderId = computed(() => String(route.params.orderId ?? ''));

const loading = ref(false);
const submitting = ref(false);
const order = ref<DriverDispatchedOrderDetail | null>(null);
const errMsg = ref('');

const ORDER_TYPE_LABEL: Record<string, string> = {
  'airport-pickup':  '接機',
  'airport-dropoff': '送機',
  'charter':         '包車',
  'transfer':        '接送',
};

const orderShort = computed(() =>
  order.value ? order.value.orderId.slice(0, 8).toUpperCase() : '',
);

const preferenceChips = computed(() =>
  (order.value?.preferences?.tagSnapshot ?? []).map((t) => t.name.zh_tw),
);

const pickupAddr = computed(() => {
  if (!order.value) return '';
  return order.value.pickupLocation.displayName || order.value.pickupLocation.address;
});
const dropoffAddr = computed(() => {
  if (!order.value) return '';
  return order.value.dropoffLocation.displayName || order.value.dropoffLocation.address;
});

const myBidStatus = computed(() => order.value?.myBidStatus ?? 'none');

const ApiLoadOrder = async () => {
  if (!orderId.value) return;
  loading.value = true;
  errMsg.value = '';
  try {
    const res = await $api.GetDispatchedOrderDetail(orderId.value);
    if (res.status?.code === 200 && res.data) {
      order.value = res.data as DriverDispatchedOrderDetail;
    } else {
      order.value = null;
      errMsg.value = res.status?.message?.zh_tw ?? '訂單已不在派發中或無權檢視';
    }
  } finally {
    loading.value = false;
  }
};

const ClickBid = async () => {
  if (!order.value || submitting.value) return;
  submitting.value = true;
  try {
    const res = await $api.PostOrderBid(order.value.orderId);
    if (res.status.code === 200) {
      ElMessage({ message: '已喊單，請等候管理員指派', type: 'success' });
      await ApiLoadOrder();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '喊單失敗', type: 'error' });
    }
  } finally {
    submitting.value = false;
  }
};

const ClickWithdraw = async () => {
  if (!order.value || submitting.value) return;
  submitting.value = true;
  try {
    const res = await $api.DeleteOrderBid(order.value.orderId);
    if (res.status.code === 200) {
      ElMessage({ message: '已撤回喊單', type: 'success' });
      await ApiLoadOrder();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '撤回失敗', type: 'error' });
    }
  } finally {
    submitting.value = false;
  }
};

const ClickBack = () => {
  navigateTo('/driver/dispatched');
};

onMounted(ApiLoadOrder);
</script>

<template lang="pug">
.PageDriverDispatchedDetail
  button.PageDriverDispatchedDetail__back(type="button" @click="ClickBack") ‹ 返回接單看板

  .PageDriverDispatchedDetail__loading(v-if="loading")
    .PageDriverDispatchedDetail__spinner

  template(v-else-if="!order")
    .PageDriverDispatchedDetail__error
      .PageDriverDispatchedDetail__error-icon ⚠️
      p {{ errMsg || '訂單載入失敗' }}
      button.PageDriverDispatchedDetail__action.is-secondary(type="button" @click="ClickBack") 返回看板

  template(v-else)
    .PageDriverDispatchedDetail__header
      .PageDriverDispatchedDetail__header-type {{ ORDER_TYPE_LABEL[order.orderType] ?? order.orderType }}
      .PageDriverDispatchedDetail__header-id \#{{ orderShort }}
      .PageDriverDispatchedDetail__header-bidcount {{ order.activeBidCount }} 司機喊單中
      .PageDriverDispatchedDetail__header-bid-tag(v-if="myBidStatus === 'bid'") 您已喊單
      .PageDriverDispatchedDetail__header-bid-tag.is-withdraw(v-else-if="myBidStatus === 'withdrawn'") 您已撤回

    .PageDriverDispatchedDetail__section
      .PageDriverDispatchedDetail__section-title 用車時間
      .PageDriverDispatchedDetail__section-val {{ $dayjs(order.pickupDateTime).format('YYYY/MM/DD (ddd) HH:mm') }}

    .PageDriverDispatchedDetail__section
      .PageDriverDispatchedDetail__section-title 行程路線
      .PageDriverDispatchedDetail__addr-card.is-pickup
        .PageDriverDispatchedDetail__addr-tag 上車
        .PageDriverDispatchedDetail__addr-text {{ pickupAddr }}
      template(v-if="order.stopovers && order.stopovers.length")
        .PageDriverDispatchedDetail__addr-card.is-stop(v-for="(stop, i) in order.stopovers" :key="i")
          .PageDriverDispatchedDetail__addr-tag 停靠 {{ i + 1 }}
          .PageDriverDispatchedDetail__addr-text
            | {{ ((stop as { displayName?: string; address?: string }).displayName) || ((stop as { displayName?: string; address?: string }).address) }}
      .PageDriverDispatchedDetail__addr-card.is-dropoff
        .PageDriverDispatchedDetail__addr-tag 下車
        .PageDriverDispatchedDetail__addr-text {{ dropoffAddr }}

    .PageDriverDispatchedDetail__section(v-if="preferenceChips.length")
      .PageDriverDispatchedDetail__section-title 乘客偏好（已鎖價）
      .PageDriverDispatchedDetail__chips
        span.PageDriverDispatchedDetail__chip(v-for="(c, i) in preferenceChips" :key="i") {{ c }}
      .PageDriverDispatchedDetail__hint 接單前請確認您的車輛 / 標籤是否符合乘客期待，否則被指派後仍可能被取消。

    .PageDriverDispatchedDetail__section(v-if="order.flightNumber || order.terminal")
      .PageDriverDispatchedDetail__section-title 航班資訊
      .PageDriverDispatchedDetail__section-row(v-if="order.flightNumber")
        span.PageDriverDispatchedDetail__section-key 航班
        span.PageDriverDispatchedDetail__section-val {{ order.flightNumber }}
      .PageDriverDispatchedDetail__section-row(v-if="order.terminal")
        span.PageDriverDispatchedDetail__section-key 航廈
        span.PageDriverDispatchedDetail__section-val {{ order.terminal }}

    .PageDriverDispatchedDetail__section(v-if="order.notes")
      .PageDriverDispatchedDetail__section-title 乘客備註
      .PageDriverDispatchedDetail__notes {{ order.notes }}

    .PageDriverDispatchedDetail__section
      .PageDriverDispatchedDetail__section-title 費用 / 距離
      .PageDriverDispatchedDetail__section-row
        span.PageDriverDispatchedDetail__section-key 預估車資
        span.PageDriverDispatchedDetail__section-val.is-fare NT$ {{ order.estimatedFare.toLocaleString() }}
      .PageDriverDispatchedDetail__section-row
        span.PageDriverDispatchedDetail__section-key 距離
        span.PageDriverDispatchedDetail__section-val {{ order.distanceKm }} km
      //- Booking v2 批次 2：人數顯示「大人 X / 兒童 Y」（child=0 退回「N 人」）
      .PageDriverDispatchedDetail__section-row
        span.PageDriverDispatchedDetail__section-key 人數
        span.PageDriverDispatchedDetail__section-val(v-if="(order.childCount ?? 0) > 0") 大人 {{ order.adultCount ?? 1 }} / 兒童 {{ order.childCount }}
        span.PageDriverDispatchedDetail__section-val(v-else) {{ order.passengerCount }} 人

    .PageDriverDispatchedDetail__actions
      button.PageDriverDispatchedDetail__action.is-primary(
        v-if="myBidStatus !== 'bid'"
        :disabled="submitting"
        type="button"
        @click="ClickBid"
      ) {{ submitting ? '處理中...' : (myBidStatus === 'withdrawn' ? '重新喊單' : '我要喊這單（競標）') }}
      button.PageDriverDispatchedDetail__action.is-danger(
        v-else
        :disabled="submitting"
        type="button"
        @click="ClickWithdraw"
      ) {{ submitting ? '處理中...' : '撤回喊單' }}
</template>

<style lang="scss" scoped>





.PageDriverDispatchedDetail {
  padding: 80px 16px 100px;
  min-height: 100svh;
  background: var(--ink);
  color: var(--surface-raised);
}

.PageDriverDispatchedDetail__back {
  font-family: var(--ff-label);
  font-size: 12px;
  letter-spacing: 0.06em;
  padding: 6px 0;
  border: none;
  background: none;
  color: var(--surface-a40);
  cursor: pointer;
  margin-bottom: 16px;
  &:hover { color: var(--surface-raised); }
}

.PageDriverDispatchedDetail__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--surface-a06);
}

.PageDriverDispatchedDetail__header-type {
  font-family: var(--ff-label);
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent);
}

.PageDriverDispatchedDetail__header-id {
  font-family: var(--ff-label);
  font-size: 13px;
  color: var(--surface-a40);
}

.PageDriverDispatchedDetail__header-bidcount {
  font-family: var(--ff-label);
  font-size: 11px;
  color: var(--accent);
  margin-left: auto;
}

.PageDriverDispatchedDetail__header-bid-tag {
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--good-a15);
  border: 1px solid var(--good-a30);
  color: var(--good);

  &.is-withdraw {
    background: var(--stop-a08);
    border-color: var(--stop-a30);
    color: var(--stop);
  }
}

.PageDriverDispatchedDetail__section {
  margin-bottom: 20px;
}

.PageDriverDispatchedDetail__section-title {
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--surface-a40);
  margin-bottom: 6px;
}

.PageDriverDispatchedDetail__section-val {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: 24px;
  letter-spacing: 0.04em;
  color: var(--surface-raised);

  &.is-fare {
    font-family: var(--ff-label);
    font-size: 18px;
    font-weight: 700;
    color: var(--accent);
  }
}

.PageDriverDispatchedDetail__section-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 6px 0;
  border-bottom: 1px dashed var(--surface-a06);
  &:last-child { border-bottom: none; }
}

.PageDriverDispatchedDetail__section-key {
  font-family: var(--ff-ui);
  font-size: 12px;
  color: var(--surface-a40);
}

.PageDriverDispatchedDetail__addr-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 6px;
  border-radius: var(--r-md);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
}

.PageDriverDispatchedDetail__addr-tag {
  font-family: var(--ff-label);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent);
  flex-shrink: 0;
}

.PageDriverDispatchedDetail__addr-text {
  font-family: var(--ff-ui);
  font-size: 13px;
  color: var(--surface-a82);
  flex: 1;
  word-break: break-all;
}

.PageDriverDispatchedDetail__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.PageDriverDispatchedDetail__chip {
  font-family: var(--ff-ui);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent-a90);
}

.PageDriverDispatchedDetail__hint {
  font-family: var(--ff-ui);
  font-size: 11px;
  color: var(--surface-a40);
  line-height: 1.6;
}

.PageDriverDispatchedDetail__notes {
  font-family: var(--ff-ui);
  font-size: 13px;
  color: var(--surface-a82);
  line-height: 1.7;
  padding: 10px 12px;
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-md);
  white-space: pre-wrap;
  word-break: break-all;
}

.PageDriverDispatchedDetail__actions {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 8px;
  padding: 16px 0 0;
  margin-top: 24px;
  background: linear-gradient(to top, var(--ink) 60%, transparent);
}

.PageDriverDispatchedDetail__action {
  flex: 1;
  font-family: var(--ff-label);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 14px 18px;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: var(--accent);
    color: var(--surface-raised);
    &:hover:not(:disabled) { background: var(--accent-deep); }
  }

  &.is-secondary {
    background: var(--surface-a06);
    color: var(--surface-a82);
    border-color: var(--surface-a06);
    &:hover:not(:disabled) { background: var(--surface-a06); }
  }

  &.is-danger {
    background: var(--stop-a08);
    color: var(--stop);
    border-color: var(--stop-a30);
    &:hover:not(:disabled) { background: var(--stop-a15); }
  }
}

.PageDriverDispatchedDetail__loading,
.PageDriverDispatchedDetail__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 0;
}

.PageDriverDispatchedDetail__error {
  color: var(--surface-a40);
  text-align: center;
  p {
    font-family: var(--ff-ui);
    font-size: 14px;
    margin: 0;
  }
}

.PageDriverDispatchedDetail__error-icon {
  font-size: 36px;
}

.PageDriverDispatchedDetail__spinner {
  width: 28px; height: 28px;
  border: 2px solid var(--accent-a20);
  border-top-color: var(--accent);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
