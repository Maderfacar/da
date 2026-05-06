<script setup lang="ts">
definePageMeta({ layout: 'front-desk', middleware: ['auth', 'role'] });

const { user } = storeToRefs(StoreAuth());

const loading = ref(false);
const orders = ref<OrderItem[]>([]);

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  pending:    { text: '等待確認', color: '#f59e0b' },
  confirmed:  { text: '已確認',   color: '#38bdf8' },
  in_transit: { text: '行程中',   color: '#4ade80' },
  completed:  { text: '已完成',   color: 'rgba(255,255,255,0.4)' },
  cancelled:  { text: '已取消',   color: '#f87171' },
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  'airport-pickup':  '接機',
  'airport-dropoff': '送機',
  'charter':         '包車',
  'transfer':        '接送',
};

const VEHICLE_LABEL: Record<string, string> = {
  sedan:   '房車',
  suv:     'SUV',
  van:     '廂型',
  premium: '商務',
};

const ApiLoadOrders = async () => {
  if (!user.value?.uid) return;
  loading.value = true;
  const res = await $api.GetOrderList({ userId: user.value.uid });
  orders.value = res.data ?? [];
  loading.value = false;
};

onMounted(ApiLoadOrders);

const FormatDate = (iso: string) => $dayjs(iso).format('MM/DD HH:mm');
const FormatFare = (fare: number) => `NT$ ${fare.toLocaleString()}`;
const StatusOf = (status: string) => STATUS_LABEL[status] ?? { text: status, color: 'rgba(255,255,255,0.4)' };
</script>

<template lang="pug">
.PageOrders
  .PageOrders__header
    .PageOrders__header-label MY TRIPS
    h1.PageOrders__header-title 我的訂單

  //- 載入中
  .PageOrders__loading(v-if="loading")
    .PageOrders__spinner

  //- 無訂單
  .PageOrders__empty(v-else-if="orders.length === 0")
    .PageOrders__empty-icon 🚗
    p.PageOrders__empty-text 尚無訂單紀錄
    NuxtLink.PageOrders__empty-link(to="/booking") 立即訂車

  //- 訂單列表
  .PageOrders__list(v-else)
    .PageOrders__card(v-for="o in orders" :key="o.orderId")
      .PageOrders__card-top
        .PageOrders__type-badge {{ ORDER_TYPE_LABEL[o.orderType] ?? o.orderType }}
        .PageOrders__status(:style="{ color: StatusOf(o.orderStatus).color }") {{ StatusOf(o.orderStatus).text }}

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
        span.PageOrders__vehicle {{ VEHICLE_LABEL[o.vehicleType] ?? o.vehicleType }}
        span.PageOrders__fare {{ FormatFare(o.estimatedFare) }}
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
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  padding: 14px 16px;
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
