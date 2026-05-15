<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

const loading = ref(false);
const orders = ref<OrderItem[]>([]);
const cancellingId = ref<string>('');

// Wave 1 P3：日期過濾（共用 UiDateRangeFilter）
const dateRange = ref<{ from: string | null; to: string | null }>({ from: null, to: null });

// status 文字走 i18n（status.{key}）；色碼留在前端（不參與翻譯）
// Wave 3-P1：cream 底色 → 調整為深色系，completed 用 muted gray、cancelled 用 #dc2626
const STATUS_COLOR: Record<string, string> = {
  pending:    '#b45309',  // amber-700（cream 底可讀）
  confirmed:  '#1B4F8A',  // 與 dropoff dot 同色
  in_transit: '#15803d',  // green-700
  completed:  '#6B6560',  // var(--da-gray)
  cancelled:  '#dc2626',
};

// P17：可取消狀態（pending / confirmed 才允許乘客主動取消，行程中或已完成不可）
const CAN_CANCEL_STATUS = new Set(['pending', 'confirmed']);

const ApiLoadOrders = async () => {
  // P17：query.userId 不傳，server 強制使用 auth.lineUid（passenger 只能讀自己）
  // Wave 1 P3：from / to 範圍過濾 pickupDateTime
  loading.value = true;
  try {
    const params: GetOrderListParams = {};
    if (dateRange.value.from) params.from = dateRange.value.from;
    if (dateRange.value.to) params.to = dateRange.value.to;
    const res = await $api.GetOrderList(params);
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
const StatusColor = (status: string) => STATUS_COLOR[status] ?? '#6B6560';
const OrderTypeLabel = (orderType: string) => t(`orderType.${orderType}`, orderType);
const VehicleLabel = (vehicleType: string) => t(`vehicle.${vehicleType}`, vehicleType);
const CanCancel = (status: string) => CAN_CANCEL_STATUS.has(status);
</script>

<template lang="pug">
.PageOrders
  .PageOrders__header
    .PageOrders__header-label MY TRIPS
    h1.PageOrders__header-title {{ $t('orders.title') }}

  //- Wave 1 P3：日期過濾（cream theme 對齊 booking 家族）
  .PageOrders__toolbar
    UiDateRangeFilter(
      v-model="dateRange"
      mode="single"
      granularity="day"
      theme="cream"
      size="md"
      @change="ApiLoadOrders"
    )

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
// Wave 3-P1：cream theme 對齊 booking 家族
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageOrders {
  padding: 72px 16px 100px;
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
}

// ── Wave 1 P3：日期過濾 toolbar ────────────────────────────────
.PageOrders__toolbar {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 16px;
}

// ── 頁首 ───────────────────────────────────────────────────────
.PageOrders__header {
  margin-bottom: 20px;

  &-label {
    font-family: $font-condensed;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.25em;
    color: var(--da-amber);
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    &::before { content: ''; width: 16px; height: 1.5px; background: var(--da-amber); }
  }

  &-title {
    font-family: $font-display;
    font-size: 32px;
    letter-spacing: 0.04em;
    color: var(--da-dark);
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
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: var(--da-amber);
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
    color: var(--da-gray);
    margin-bottom: 20px;
  }

  &-link {
    display: inline-block;
    font-family: $font-condensed;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 10px 24px;
    border-radius: 100px;
    background: var(--da-amber);
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
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 18px;
  padding: 14px 16px;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);
  transition: background 0.15s, border-color 0.15s, transform 0.1s, box-shadow 0.15s;

  &:hover {
    background: rgba(250, 248, 244, 0.92);
    border-color: rgba(212, 134, 10, 0.32);
    box-shadow: 0 6px 24px rgba(26, 24, 20, 0.08);
  }

  &:active { transform: scale(0.998); }
}

// P17：取消按鈕（pending / confirmed 狀態才顯示）— cream 版紅色 light
.PageOrders__cancel {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.25);
  border-radius: 10px;
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #dc2626;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s, transform 0.1s;

  &:hover:not(:disabled) { background: rgba(220, 38, 38, 0.14); }
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
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--da-amber);
  background: var(--da-amber-pale);
  border: 1px solid rgba(212, 134, 10, 0.30);
  border-radius: 100px;
  padding: 2px 10px;
}

.PageOrders__status {
  font-family: $font-condensed;
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

  &.is-pickup  { background: var(--da-amber); }
  &.is-dropoff { background: #1B4F8A; }
}

.PageOrders__route-line {
  width: 1px;
  height: 12px;
  background: var(--da-gray-pale);
  margin-left: 3.5px;
}

.PageOrders__route-addr {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: var(--da-dark);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// ── 卡片底部 ─────────────────────────────────────────────────
.PageOrders__card-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  border-top: 1px solid var(--da-gray-pale);
  padding-top: 10px;
}

.PageOrders__date,
.PageOrders__vehicle {
  font-family: $font-condensed;
  font-size: 11px;
  color: var(--da-gray);
}

.PageOrders__fare {
  margin-left: auto;
  font-family: $font-display;
  font-size: 16px;
  color: var(--da-amber);
  letter-spacing: 0.05em;
}
</style>
