<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

const loading = ref(false);
const orders = ref<OrderItem[]>([]);
const cancellingId = ref<string>('');

// status 文字走 i18n（status.{key}）；色碼留在前端（不參與翻譯）
const STATUS_COLOR: Record<string, string> = {
  pending:    '#f59e0b',
  confirmed:  '#38bdf8',
  in_transit: '#4ade80',
  completed:  'rgba(255,255,255,0.4)',
  cancelled:  '#f87171',
};

// P17：可取消狀態（pending / confirmed 才允許乘客主動取消，行程中或已完成不可）
const CAN_CANCEL_STATUS = new Set(['pending', 'confirmed']);

const ApiLoadOrders = async () => {
  // P17：query.userId 不傳，server 強制使用 auth.lineUid（passenger 只能讀自己）
  loading.value = true;
  try {
    const res = await $api.GetOrderList({});
    if (res.status?.code !== $enum.apiStatus.success) {
      console.error('[orders] load failed:', res.status?.message?.zh_tw);
      ElMessage({ message: res.status?.message?.zh_tw ?? t('orders.loadFailed'), type: 'error' });
      orders.value = [];
      return;
    }
    orders.value = Array.isArray(res.data) ? res.data : [];
  } finally {
    loading.value = false;
  }
};

// P17：訂單取消（pending / confirmed 才可取消）
// P36：取消按鈕被 NuxtLink 卡片包覆，需 stop 冒泡避免一邊取消一邊跳詳情頁
const ClickCancel = async (e: Event, orderId: string, orderStatus: string) => {
  e.preventDefault();
  e.stopPropagation();
  if (!CAN_CANCEL_STATUS.has(orderStatus)) return;
  if (cancellingId.value) return;
  const ok = await UseAsk(t('orders.cancel.confirm'));
  if (!ok) return;
  cancellingId.value = orderId;
  const res = await $api.PatchOrder(orderId, { orderStatus: 'cancelled' });
  cancellingId.value = '';
  if (res.status?.code !== $enum.apiStatus.success) {
    ElMessage({ message: res.status?.message?.zh_tw ?? t('orders.cancel.failed'), type: 'error' });
    return;
  }
  ElMessage({ message: t('orders.cancel.success'), type: 'success' });
  await ApiLoadOrders();
};

// P17：30 秒輪詢一次（與 admin / driver 端一致），visibility 切回時也立即重 load
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL = 30_000;
const onVisibility = () => { if (document.visibilityState === 'visible') ApiLoadOrders(); };

onMounted(() => {
  ApiLoadOrders();
  pollTimer = setInterval(ApiLoadOrders, POLL_INTERVAL);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
});

const FormatDate = (iso: string) => $dayjs(iso).format('MM/DD HH:mm');
const FormatFare = (fare: number) => `NT$ ${fare.toLocaleString()}`;
const StatusText = (status: string) => t(`status.${status}`, status);
const StatusColor = (status: string) => STATUS_COLOR[status] ?? 'rgba(255,255,255,0.4)';
const OrderTypeLabel = (orderType: string) => t(`orderType.${orderType}`, orderType);
const VehicleLabel = (vehicleType: string) => t(`vehicle.${vehicleType}`, vehicleType);
const CanCancel = (status: string) => CAN_CANCEL_STATUS.has(status);
</script>

<template lang="pug">
.PageOrders
  .PageOrders__header
    .PageOrders__header-label MY TRIPS
    h1.PageOrders__header-title {{ $t('orders.title') }}

  //- 載入中
  .PageOrders__loading(v-if="loading")
    .PageOrders__spinner

  //- 無訂單
  .PageOrders__empty(v-else-if="orders.length === 0")
    .PageOrders__empty-icon 🚗
    p.PageOrders__empty-text {{ $t('orders.empty.text') }}
    NuxtLink.PageOrders__empty-link(to="/booking") {{ $t('orders.empty.btn') }}

  //- 訂單列表
  .PageOrders__list(v-else)
    NuxtLink.PageOrders__card(
      v-for="o in orders"
      :key="o.orderId"
      :to="`/orders/${o.orderId}`"
    )
      .PageOrders__card-top
        .PageOrders__type-badge {{ OrderTypeLabel(o.orderType) }}
        .PageOrders__status(:style="{ color: StatusColor(o.orderStatus) }") {{ StatusText(o.orderStatus) }}

      .PageOrders__route
        .PageOrders__route-row
          span.PageOrders__route-dot.is-pickup
          span.PageOrders__route-addr {{ o.pickupLocation?.displayName || o.pickupLocation?.address }}
        .PageOrders__route-line
        .PageOrders__route-row
          span.PageOrders__route-dot.is-dropoff
          span.PageOrders__route-addr {{ o.dropoffLocation?.displayName || o.dropoffLocation?.address }}

      .PageOrders__card-footer
        span.PageOrders__date {{ FormatDate(o.pickupDateTime) }}
        span.PageOrders__vehicle {{ VehicleLabel(o.vehicleType) }}
        span.PageOrders__fare {{ FormatFare(o.estimatedFare) }}

      //- P17：取消按鈕（pending / confirmed 才顯示）
      //- P36：卡片改為 NuxtLink，取消按鈕需 stop 冒泡避免一邊取消一邊跳詳情頁
      button.PageOrders__cancel(
        v-if="CanCancel(o.orderStatus)"
        :disabled="cancellingId === o.orderId"
        @click="ClickCancel($event, o.orderId, o.orderStatus)"
      ) {{ cancellingId === o.orderId ? $t('orders.cancel.loading') : $t('orders.cancel.btn') }}
</template>

<style lang="scss" scoped>
$bg: #0d1117;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.07);
$amber: #d4860a;

.PageOrders {
  padding: 72px 16px 100px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

// ── 頁首 ───────────────────────────────────────────────────────
.PageOrders__header {
  margin-bottom: 20px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.25em;
    color: $amber;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    &::before { content: ''; width: 16px; height: 1.5px; background: $amber; }
  }

  &-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 32px;
    letter-spacing: 0.04em;
    color: #fff;
  }
}

// ── 載入中 ────────────────────────────────────────────────────
.PageOrders__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageOrders__spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 無訂單 ────────────────────────────────────────────────────
.PageOrders__empty {
  text-align: center;
  padding: 80px 20px;

  &-icon { font-size: 48px; margin-bottom: 16px; }

  &-text {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 20px;
  }

  &-link {
    display: inline-block;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 10px 24px;
    border-radius: 100px;
    background: $amber;
    color: #fff;
    text-decoration: none;
  }
}

// ── 訂單卡片 ──────────────────────────────────────────────────
.PageOrders__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.PageOrders__card {
  display: block;
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  padding: 14px 16px;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba($amber, 0.28);
  }

  &:active { transform: scale(0.998); }
}

// P17：取消按鈕（pending / confirmed 狀態才顯示）
.PageOrders__cancel {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: 10px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #f87171;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;

  &:hover { opacity: 0.85; }
  &:active { transform: scale(0.99); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.PageOrders__card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.PageOrders__type-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: $amber;
  background: rgba($amber, 0.1);
  border: 1px solid rgba($amber, 0.25);
  border-radius: 100px;
  padding: 2px 10px;
}

.PageOrders__status {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

// ── 路線 ─────────────────────────────────────────────────────
.PageOrders__route {
  margin-bottom: 12px;
}

.PageOrders__route-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.PageOrders__route-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.is-pickup  { background: $amber; }
  &.is-dropoff { background: #38bdf8; }
}

.PageOrders__route-line {
  width: 1px;
  height: 12px;
  background: rgba(255, 255, 255, 0.12);
  margin-left: 3.5px;
}

.PageOrders__route-addr {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// ── 卡片底部 ─────────────────────────────────────────────────
.PageOrders__card-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  border-top: 1px solid $border;
  padding-top: 10px;
}

.PageOrders__date,
.PageOrders__vehicle {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.PageOrders__fare {
  margin-left: auto;
  font-family: 'Bebas Neue', sans-serif;
  font-size: 16px;
  color: $amber;
  letter-spacing: 0.05em;
}
</style>
