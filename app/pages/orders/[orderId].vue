<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const orderId = computed(() => String(route.params.orderId ?? ''));

const order = ref<OrderDetail | null>(null);
const loading = ref(true);
const errorMsg = ref<string>('');
const cancelling = ref(false);

// 狀態色卡（沿用 orders/index.vue + 補 en_route / arrived_pickup）
// Wave 3-P1：cream 底色 → 全部調整為深色系（rgba 白色系不可讀）
const STATUS_COLOR: Record<string, string> = {
  pending:        '#b45309',  // amber-700
  confirmed:      '#1B4F8A',  // navy（與 dropoff dot 同色）
  en_route:       '#6d28d9',  // violet-700
  arrived_pickup: '#0e7490',  // cyan-700
  in_transit:     '#15803d',  // green-700
  completed:      '#6B6560',  // var(--da-gray)
  cancelled:      '#dc2626',
};

// 乘客可主動取消的狀態（行程中 / 已完成 / 已取消 都不可）
const CAN_CANCEL_STATUS = new Set(['pending', 'confirmed']);
// 司機卡顯示的狀態（confirmed 後 + completed 仍顯示）
const DRIVER_VISIBLE_STATUSES = new Set(['confirmed', 'en_route', 'arrived_pickup', 'in_transit', 'completed']);

const StatusText = (status: string) => t(`status.${status}`, status);
const StatusColor = (status: string) => STATUS_COLOR[status] ?? '#6B6560';
const FormatDate = (iso: string) => (iso ? $dayjs(iso).format('YYYY/MM/DD HH:mm') : '');
const FormatFare = (fare: number) => `NT$ ${fare.toLocaleString()}`;
const FormatDistance = (km: number) => `${km.toFixed(1)} km`;
const VehicleLabel = (v: string) => t(`vehicle.${v}`, v);
const ExtraLabel = (id: string) => t(`fleet.extras.${id}`, id);

const CanCancel = (status: string) => CAN_CANCEL_STATUS.has(status);
const ShowDriver = computed(() => {
  if (!order.value) return false;
  return DRIVER_VISIBLE_STATUSES.has(order.value.orderStatus) && order.value.driver != null;
});

const ShortOrderId = computed(() => order.value?.orderId.slice(0, 8).toUpperCase() ?? '');

// tel: 格式化（去掉空白與符號，保留 + 與數字）
const DriverTelHref = computed(() => {
  const phone = order.value?.driver?.phone;
  if (!phone) return '';
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
});

const ApiLoadOrder = async () => {
  if (!orderId.value) return;
  const isFirstLoad = !order.value;
  if (isFirstLoad) loading.value = true;
  try {
    const res = await $api.GetOrder(orderId.value);
    if (res.status?.code !== $enum.apiStatus.success) {
      const msg = res.status?.message?.zh_tw ?? t('orderDetail.loadFailed');
      errorMsg.value = msg;
      // 403 / 404 直接回列表（無權檢視或訂單不存在）
      if (res.status?.code === 403 || res.status?.code === 404) {
        ElMessage({ message: msg, type: 'error' });
        router.replace('/orders');
        return;
      }
      ElMessage({ message: msg, type: 'error' });
      return;
    }
    errorMsg.value = '';
    order.value = res.data as OrderDetail;
  } finally {
    if (isFirstLoad) loading.value = false;
  }
};

const ClickCancel = async () => {
  if (!order.value || !CanCancel(order.value.orderStatus)) return;
  if (cancelling.value) return;
  const ok = await UseAsk(t('orders.cancel.confirm'));
  if (!ok) return;
  cancelling.value = true;
  const res = await $api.PatchOrder(order.value.orderId, { orderStatus: 'cancelled' });
  cancelling.value = false;
  if (res.status?.code !== $enum.apiStatus.success) {
    ElMessage({ message: res.status?.message?.zh_tw ?? t('orders.cancel.failed'), type: 'error' });
    return;
  }
  ElMessage({ message: t('orders.cancel.success'), type: 'success' });
  await ApiLoadOrder();
};

// 30s polling + visibility refresh（沿用 orders/index.vue 模式）
let pollTimer: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL = 30_000;
const onVisibility = () => { if (document.visibilityState === 'visible') ApiLoadOrder(); };

onMounted(() => {
  ApiLoadOrder();
  pollTimer = setInterval(ApiLoadOrder, POLL_INTERVAL);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template lang="pug">
.PageOrderDetail
  //- 返回列表
  .PageOrderDetail__topbar
    NuxtLink.PageOrderDetail__back(to="/orders")
      span ←
      span {{ $t('orderDetail.backToList') }}

  //- 載入中（首次）
  .PageOrderDetail__loading(v-if="loading")
    .PageOrderDetail__spinner

  //- 載入失敗 / 訂單不存在
  .PageOrderDetail__error(v-else-if="!order")
    .PageOrderDetail__error-icon ⚠️
    p.PageOrderDetail__error-text {{ errorMsg || $t('orderDetail.notFound') }}
    NuxtLink.PageOrderDetail__error-link(to="/orders") {{ $t('orderDetail.backToList') }}

  template(v-else)
    //- 頁首：訂單編號 + 狀態
    .PageOrderDetail__header
      .PageOrderDetail__header-label ORDER DETAIL
      .PageOrderDetail__header-row
        h1.PageOrderDetail__header-id {{ '#' + ShortOrderId }}
        .PageOrderDetail__status(:style="{ color: StatusColor(order.orderStatus) }") {{ StatusText(order.orderStatus) }}

    //- 路徑卡
    section.PageOrderDetail__section
      .PageOrderDetail__section-label ROUTE
      .PageOrderDetail__route
        .PageOrderDetail__route-point
          span.PageOrderDetail__route-dot.is-pickup
          .PageOrderDetail__route-text
            .PageOrderDetail__route-tag {{ $t('orderDetail.route.pickup') }}
            .PageOrderDetail__route-addr {{ order.pickupLocation?.displayName || order.pickupLocation?.address || '—' }}

        template(v-if="order.stopovers && order.stopovers.length")
          template(v-for="(s, i) in order.stopovers" :key="i")
            .PageOrderDetail__route-line
            .PageOrderDetail__route-point
              span.PageOrderDetail__route-dot.is-stopover
              .PageOrderDetail__route-text
                .PageOrderDetail__route-tag {{ $t('orderDetail.route.stopover', { n: i + 1 }) }}
                .PageOrderDetail__route-addr {{ s.displayName || s.address }}

        .PageOrderDetail__route-line
        .PageOrderDetail__route-point
          span.PageOrderDetail__route-dot.is-dropoff
          .PageOrderDetail__route-text
            .PageOrderDetail__route-tag {{ $t('orderDetail.route.dropoff') }}
            .PageOrderDetail__route-addr {{ order.dropoffLocation?.displayName || order.dropoffLocation?.address || '—' }}

      .PageOrderDetail__route-meta
        .PageOrderDetail__route-meta-item
          .PageOrderDetail__route-meta-label DISTANCE
          .PageOrderDetail__route-meta-val {{ FormatDistance(order.distanceKm) }}
        .PageOrderDetail__route-meta-item
          .PageOrderDetail__route-meta-label ETA
          .PageOrderDetail__route-meta-val {{ $t('orderDetail.route.eta', { min: order.estimatedTime }) }}

    //- 司機卡（confirmed 後才顯示）
    section.PageOrderDetail__section.is-driver(v-if="ShowDriver && order.driver")
      .PageOrderDetail__section-label DRIVER
      .PageOrderDetail__driver
        img.PageOrderDetail__driver-avatar(
          v-if="order.driver.pictureUrl"
          :src="order.driver.pictureUrl"
          :alt="order.driver.displayName"
        )
        .PageOrderDetail__driver-avatar-fallback(v-else) 🚖
        .PageOrderDetail__driver-info
          .PageOrderDetail__driver-name {{ order.driver.displayName || $t('orderDetail.driverCard.unknownName') }}
          .PageOrderDetail__driver-meta
            span.PageOrderDetail__driver-plate(v-if="order.driver.plateNumber") {{ order.driver.plateNumber }}
            span.PageOrderDetail__driver-vehicle(v-if="order.driver.vehicleType") {{ VehicleLabel(order.driver.vehicleType) }}

        a.PageOrderDetail__driver-call(
          v-if="order.driver.phone"
          :href="DriverTelHref"
        )
          span 📞
          span {{ $t('orderDetail.driverCard.call') }}
        .PageOrderDetail__driver-call.is-disabled(v-else) {{ $t('orderDetail.driverCard.noPhone') }}

    //- 訂單資訊
    section.PageOrderDetail__section
      .PageOrderDetail__section-label TRIP INFO
      dl.PageOrderDetail__info
        .PageOrderDetail__info-row
          dt.PageOrderDetail__info-label {{ $t('orderDetail.info.pickupTime') }}
          dd.PageOrderDetail__info-val {{ FormatDate(order.pickupDateTime) }}
        .PageOrderDetail__info-row
          dt.PageOrderDetail__info-label {{ $t('orderDetail.info.vehicle') }}
          dd.PageOrderDetail__info-val {{ VehicleLabel(order.vehicleType) }}
        .PageOrderDetail__info-row
          dt.PageOrderDetail__info-label {{ $t('orderDetail.info.passengers') }}
          dd.PageOrderDetail__info-val {{ $t('orderDetail.info.passengerVal', { n: order.passengerCount }) }}
        .PageOrderDetail__info-row(v-if="order.extraServices && order.extraServices.length")
          dt.PageOrderDetail__info-label {{ $t('orderDetail.info.extras') }}
          dd.PageOrderDetail__info-val {{ order.extraServices.map(ExtraLabel).join('、') }}
        .PageOrderDetail__info-row(v-if="order.flightNumber")
          dt.PageOrderDetail__info-label {{ $t('orderDetail.info.flight') }}
          dd.PageOrderDetail__info-val
            | {{ order.flightNumber }}
            template(v-if="order.terminal") &nbsp;·&nbsp;{{ order.terminal }}
        .PageOrderDetail__info-row(v-if="order.notes")
          dt.PageOrderDetail__info-label {{ $t('orderDetail.info.notes') }}
          dd.PageOrderDetail__info-val.is-notes {{ order.notes }}
        .PageOrderDetail__info-row.is-fare
          dt.PageOrderDetail__info-label {{ $t('orderDetail.info.fare') }}
          dd.PageOrderDetail__info-val.is-fare {{ FormatFare(order.estimatedFare) }}

    //- 取消按鈕（pending / confirmed 才顯示）
    button.PageOrderDetail__cancel(
      v-if="CanCancel(order.orderStatus)"
      :disabled="cancelling"
      @click="ClickCancel"
    ) {{ cancelling ? $t('orders.cancel.loading') : $t('orders.cancel.btn') }}
</template>

<style lang="scss" scoped>
// Wave 3-P1：cream theme 對齊 booking 家族；司機卡採 dark accent（對應 booking success-id pattern）
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageOrderDetail {
  padding: 72px 16px 100px;
  min-height: 100svh;
  background: var(--da-cream);
  color: var(--da-dark);
}

// ── Topbar ───────────────────────────────────────────────
.PageOrderDetail__topbar { margin-bottom: 14px; }

.PageOrderDetail__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--da-gray);
  text-decoration: none;
  transition: color 0.15s;

  &:hover { color: var(--da-amber); }
}

// ── 載入中 ───────────────────────────────────────────────
.PageOrderDetail__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageOrderDetail__spinner {
  width: 32px;
  height: 32px;
  border: 2px solid rgba(212, 134, 10, 0.2);
  border-top-color: var(--da-amber);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 錯誤狀態 ─────────────────────────────────────────────
.PageOrderDetail__error {
  text-align: center;
  padding: 60px 20px;

  &-icon { font-size: 48px; margin-bottom: 12px; }

  &-text {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 14px;
    color: var(--da-gray);
    margin-bottom: 18px;
  }

  &-link {
    display: inline-block;
    font-family: $font-condensed;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 9px 22px;
    border-radius: 100px;
    background: var(--da-amber);
    color: #fff;
    text-decoration: none;
  }
}

// ── 頁首 ────────────────────────────────────────────────
.PageOrderDetail__header { margin-bottom: 16px; }

.PageOrderDetail__header-label {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.25em;
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  &::before { content: ''; width: 16px; height: 1.5px; background: var(--da-amber); }
}

.PageOrderDetail__header-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.PageOrderDetail__header-id {
  font-family: $font-display;
  font-size: 26px;
  letter-spacing: 0.06em;
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;
}

.PageOrderDetail__status {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

// ── Section（cream 玻璃卡）──────────────────────────────
.PageOrderDetail__section {
  background: var(--da-glass-bg);
  border: 1px solid var(--da-glass-border);
  border-radius: 18px;
  padding: 18px 16px;
  margin-bottom: 14px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--da-glass-shadow);

  // 司機卡：dark accent（對應 booking success-id pattern，視覺重點突顯）
  &.is-driver {
    background: var(--da-dark);
    border-color: rgba(212, 134, 10, 0.35);
    color: var(--da-cream);
    box-shadow: 0 8px 32px rgba(26, 24, 20, 0.18);
  }
}

.PageOrderDetail__section-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  color: var(--da-amber);
  margin-bottom: 12px;

  .is-driver & { color: var(--da-amber-light); }
}

// ── Route ──────────────────────────────────────────────
.PageOrderDetail__route { margin-bottom: 14px; }

.PageOrderDetail__route-point {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.PageOrderDetail__route-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;

  &.is-pickup   { background: var(--da-amber); }
  &.is-stopover { background: var(--da-gray-light); }
  &.is-dropoff  { background: #1B4F8A; }
}

.PageOrderDetail__route-text { min-width: 0; flex: 1; }

.PageOrderDetail__route-tag {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--da-gray-light);
}

.PageOrderDetail__route-addr {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--da-dark);
  margin-top: 2px;
  word-break: break-word;
}

.PageOrderDetail__route-line {
  width: 1px;
  height: 14px;
  background: var(--da-gray-pale);
  margin-left: 4.5px;
}

.PageOrderDetail__route-meta {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 6px;
}

.PageOrderDetail__route-meta-item {
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid var(--da-gray-pale);
  border-radius: 12px;
  padding: 10px 12px;
}

.PageOrderDetail__route-meta-label {
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--da-gray);
}

.PageOrderDetail__route-meta-val {
  font-family: $font-display;
  font-size: 20px;
  letter-spacing: 0.04em;
  color: var(--da-dark);
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

// ── Driver（dark accent 內元素）──────────────────────────
.PageOrderDetail__driver {
  display: flex;
  align-items: center;
  gap: 12px;
}

.PageOrderDetail__driver-avatar,
.PageOrderDetail__driver-avatar-fallback {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba(240, 168, 48, 0.5);
  flex-shrink: 0;
}

.PageOrderDetail__driver-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  background: rgba(255, 255, 255, 0.08);
}

.PageOrderDetail__driver-info { flex: 1; min-width: 0; }

.PageOrderDetail__driver-name {
  font-family: $font-condensed;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--da-cream);
}

.PageOrderDetail__driver-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-family: $font-condensed;
  font-size: 11px;
  color: rgba(245, 242, 236, 0.6);
  letter-spacing: 0.06em;
  margin-top: 3px;

  & > span + span {
    padding-left: 8px;
    border-left: 1px solid rgba(255, 255, 255, 0.12);
  }
}

.PageOrderDetail__driver-call {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--da-amber);
  border: 1px solid var(--da-amber);
  border-radius: 100px;
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #fff;
  text-decoration: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s;

  &:hover { background: var(--da-amber-light); border-color: var(--da-amber-light); }

  &.is-disabled {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
    color: rgba(245, 242, 236, 0.4);
    cursor: not-allowed;
  }
}

// ── Trip info ──────────────────────────────────────────
.PageOrderDetail__info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
}

.PageOrderDetail__info-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--da-gray-pale);

  &:last-child { border-bottom: 0; padding-bottom: 0; }

  &.is-fare {
    padding-top: 10px;
    border-top: 1px solid rgba(212, 134, 10, 0.25);
    border-bottom: 0;
    margin-top: 4px;
  }
}

.PageOrderDetail__info-label {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--da-gray);
  flex-shrink: 0;
}

.PageOrderDetail__info-val {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: var(--da-dark);
  text-align: right;
  margin: 0;

  &.is-notes {
    text-align: left;
    flex: 1;
    max-width: 65%;
    word-break: break-word;
    line-height: 1.5;
  }

  &.is-fare {
    font-family: $font-display;
    font-size: 22px;
    color: var(--da-amber);
    letter-spacing: 0.04em;
  }
}

// ── Cancel button（cream 版紅色 light）──────────────────
.PageOrderDetail__cancel {
  display: block;
  width: 100%;
  padding: 12px;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.25);
  border-radius: 12px;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #dc2626;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s, transform 0.1s;

  &:hover:not(:disabled) { background: rgba(220, 38, 38, 0.14); }
  &:active { transform: scale(0.99); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
