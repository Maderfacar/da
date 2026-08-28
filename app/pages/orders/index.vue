<script setup lang="ts">
import { DESIGN_COLORS } from '~shared/design-colors';
// 歷史訂單頁（原 /orders + /profile 合併）
// Section 順序：使用者頭像卡 → 我的旅程 → 我的訂單（日期篩選 + 列表）→ 客服資訊
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { t } = useI18n();

const loading = ref(false);
const orders = ref<OrderItem[]>([]);
const cancellingId = ref<string>('');

// 日期過濾（共用 UiDateRangeFilter）
const dateRange = ref<{ from: string | null; to: string | null }>({ from: null, to: null });

// status 文字走 i18n（status.{key}）；色碼留在前端（不參與翻譯）
const STATUS_COLOR: Record<string, string> = {
  pending:    DESIGN_COLORS.wait,
  confirmed:  DESIGN_COLORS.note,
  in_transit: DESIGN_COLORS.good,
  completed:  DESIGN_COLORS.inkSoft,  // 次要文字
  cancelled:  DESIGN_COLORS.stop,
};

// 可取消狀態（pending / confirmed 才允許乘客主動取消）
const CAN_CANCEL_STATUS = new Set(['pending', 'confirmed']);

// 預設僅顯示「距離現在最近的上一筆（已過）訂單」；
// 使用者選日期後改顯示該範圍內全部訂單。
const isDateFiltered = computed(() => Boolean(dateRange.value.from || dateRange.value.to));
const displayOrders = computed<OrderItem[]>(() => {
  if (isDateFiltered.value) return orders.value;
  const now = Date.now();
  return [...orders.value]
    .filter((o) => $dayjs(o.pickupDateTime).valueOf() <= now)
    .sort((a, b) => $dayjs(b.pickupDateTime).valueOf() - $dayjs(a.pickupDateTime).valueOf())
    .slice(0, 1);
});

const ApiLoadOrders = async () => {
  // server 強制使用 auth.lineUid（passenger 只能讀自己）；from / to 範圍過濾 pickupDateTime
  //
  // 2026-08-29：未登入直接 return。此頁受 middleware/auth 保護，但 SSR 階段 middleware 直接
  // return（見 middleware/auth 檔頭），所以訪客深連結進來時本頁仍會 mount 一次、送出一發
  // 必然 401 的請求，然後在 console 印一行紅字 —— 導向 /login 之後那行紅字還留在那裡，
  // 看起來像網站壞了。訪客沒有訂單可讀，這一發請求從來就沒有意義。
  if (!StoreAuth().isSignIn) return;
  loading.value = true;
  try {
    const params: GetOrderListParams = {};
    if (dateRange.value.from) params.from = dateRange.value.from;
    if (dateRange.value.to) params.to = dateRange.value.to;
    const res = await $api.GetOrderList(params);
    if (res.status?.code !== $enum.apiStatus.success) {
      console.error('[history] load failed:', res.status?.message?.zh_tw);
      ElMessage({ message: res.status?.message?.zh_tw ?? t('orders.loadFailed'), type: 'error' });
      orders.value = [];
      return;
    }
    orders.value = Array.isArray(res.data) ? res.data : [];
  } finally {
    loading.value = false;
  }
};

// 訂單取消（pending / confirmed 才可取消）
// 取消按鈕被 NuxtLink 卡片包覆，需 stop 冒泡避免一邊取消一邊跳詳情頁
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

// 30 秒輪詢一次，visibility 切回時也立即重 load
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
const StatusColor = (status: string) => STATUS_COLOR[status] ?? DESIGN_COLORS.inkSoft;
const OrderTypeLabel = (orderType: string) => t(`orderType.${orderType}`, orderType);
const VehicleLabel = (vehicleType: string) => t(`vehicle.${vehicleType}`, vehicleType);
const CanCancel = (status: string) => CAN_CANCEL_STATUS.has(status);
</script>

<template lang="pug">
.PageOrders
  .PageOrders__header
    .PageOrders__header-label TRIP HISTORY
    h1.PageOrders__header-title {{ $t('orders.title') }}

  //- Section 1：使用者頭像卡
  PassengerHistoryUserCard

  //- Section 2：我的旅程
  PassengerHistoryJourneys

  //- Section 3：我的訂單（日期篩選 + 列表）
  section.PageOrders__orders
    .PageOrders__orders-label MY ORDERS
    h2.PageOrders__orders-title {{ $t('orders.heading') }}
    .PageOrders__orders-bar
      UiDateRangeFilter(
        v-model="dateRange"
        mode="single"
        granularity="day"
        theme="cream"
        size="md"
        @change="ApiLoadOrders"
      )
      p.PageOrders__orders-note {{ $t('orders.note') }}

    //- 載入中
    .PageOrders__loading(v-if="loading")
      .PageOrders__spinner

    //- 無訂單
    .PageOrders__empty(v-else-if="displayOrders.length === 0")
      .PageOrders__empty-icon 🚗
      p.PageOrders__empty-text {{ $t('orders.empty.text') }}
      NuxtLink.PageOrders__empty-link(to="/booking") {{ $t('orders.empty.btn') }}

    //- 訂單列表
    .PageOrders__list(v-else)
      NuxtLink.PageOrders__card(
        v-for="o in displayOrders"
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

        //- 取消按鈕（pending / confirmed 才顯示）；卡片為 NuxtLink，需 stop 冒泡
        button.PageOrders__cancel(
          v-if="CanCancel(o.orderStatus)"
          :disabled="cancellingId === o.orderId"
          @click="ClickCancel($event, o.orderId, o.orderStatus)"
        ) {{ cancellingId === o.orderId ? $t('orders.cancel.loading') : $t('orders.cancel.btn') }}

  //- Section 4：我的折扣碼／推薦進度（推薦獎勵機制 Phase 3）
  PassengerReferralPanel

  //- Section 5：客服資訊
  PassengerHistorySupport
</template>

<style lang="scss" scoped>
// cream theme 對齊 booking 家族

.PageOrders {
  padding: 72px 24px 0;
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
}

// ── 頁首（對齊 fare）──────────────────────────────────────────
.PageOrders__header {
  padding: 32px 0;

  &-label {
    font-family: var(--ff-label);
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--ls-kicker);
    text-transform: uppercase;
    color: var(--accent-text);
    margin-bottom: 10px;
  }

  &-title {
    font-family: var(--ff-display);
    font-size: clamp(48px, 14vw, 64px);
    line-height: var(--lh-flat);
    color: var(--da-dark);
  }
}

// ── Section 3：我的訂單 ────────────────────────────────────────
.PageOrders__orders {
  margin-bottom: 16px;
}

.PageOrders__orders-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--accent-text);
  margin-bottom: 6px;
}

.PageOrders__orders-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-label);
  color: var(--da-dark);
  margin-bottom: 12px;
}

.PageOrders__orders-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 16px;
}

.PageOrders__orders-note {
  flex: 1;
  min-width: 180px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  line-height: var(--lh-normal);
  letter-spacing: var(--ls-snug);
  color: var(--da-gray);
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
  border: 2px solid var(--accent-a20);
  border-top-color: var(--da-amber);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 無訂單 ────────────────────────────────────────────────────
.PageOrders__empty {
  text-align: center;
  padding: 60px 20px;

  &-icon { font-size: var(--fs-display); margin-bottom: 16px; }

  &-text {
    font-family: var(--ff-ui);
    font-size: var(--fs-body);
    color: var(--da-gray);
    margin-bottom: 20px;
  }

  &-link {
    display: inline-block;
    font-family: var(--ff-label);
    font-size: var(--fs-body-sm);
    font-weight: 700;
    letter-spacing: var(--ls-wide);
    padding: 10px 24px;
    border-radius: var(--r-pill);
    background: var(--da-amber);
    color: var(--surface-raised);
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
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-radius: var(--r-lg);
  padding: 14px 16px;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--surface-a88);
    border-color: var(--accent-a30);
    box-shadow: var(--shadow-pop);
  }

  &:active { transform: scale(0.998); }
}

// 取消按鈕（pending / confirmed 狀態才顯示）— cream 版紅色 light
.PageOrders__cancel {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--stop-a08);
  border: 1px solid var(--stop-a30);
  border-radius: var(--r-md);
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--stop);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) { background: var(--stop-a15); }
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
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  color: var(--accent-text);
  background: var(--da-amber-pale);
  border: 1px solid var(--accent-a30);
  border-radius: var(--r-pill);
  padding: 2px 10px;
}

.PageOrders__status {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-label);
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
  border-radius: var(--r-round);
  flex-shrink: 0;

  &.is-pickup  { background: var(--da-amber); }
  &.is-dropoff { background: var(--note); }
}

.PageOrders__route-line {
  width: 1px;
  height: 12px;
  background: var(--da-gray-pale);
  margin-left: 3.5px;
}

.PageOrders__route-addr {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
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
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--da-gray);
}

.PageOrders__fare {
  margin-left: auto;
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-body-lg);
  color: var(--accent-text);
  letter-spacing: var(--ls-label);
}
</style>
