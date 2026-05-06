<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const { user } = storeToRefs(StoreAuth());

const loading = ref(false);
const accepting = ref<string | null>(null);
const orders = ref<AvailableOrder[]>([]);

const ORDER_TYPE_LABEL: Record<string, string> = {
  'airport-pickup':  '接機',
  'airport-dropoff': '送機',
  'charter':         '包車',
  'transfer':        '接送',
};
const VEHICLE_LABEL: Record<string, string> = {
  sedan: '商務轎車', mpv: '商務 MPV', suv: '商務 SUV', van: '廂型車',
};

const ApiLoadOrders = async () => {
  loading.value = true;
  const res = await $api.GetAvailableOrders();
  orders.value = (res.data as AvailableOrder[]) ?? [];
  loading.value = false;
};

const ClickAccept = async (order: AvailableOrder) => {
  if (!user.value?.uid) return;
  accepting.value = order.orderId;
  const res = await $api.PatchOrder(order.orderId, {
    orderStatus: 'confirmed',
    assignedDriverId: user.value.uid,
  });
  accepting.value = null;
  if (res.status.code === 200) {
    orders.value = orders.value.filter((o) => o.orderId !== order.orderId);
    ElMessage({ message: `已接單 #${order.orderId.slice(0, 8).toUpperCase()}`, type: 'success' });
  } else {
    ElMessage({ message: '接單失敗，請重試', type: 'error' });
  }
};

const ClickDecline = (orderId: string) => {
  orders.value = orders.value.filter((o) => o.orderId !== orderId);
};

onMounted(ApiLoadOrders);
</script>

<template lang="pug">
.PageDriverPending
  .PageDriverPending__header
    .PageDriverPending__header-label AVAILABLE ORDERS
    h1.PageDriverPending__header-title 待接訂單

  //- Loading
  .PageDriverPending__loading(v-if="loading")
    .PageDriverPending__spinner

  //- 空狀態
  .PageDriverPending__empty(v-else-if="!orders.length")
    .PageDriverPending__empty-icon 📭
    p 目前沒有待接訂單
    small 請稍後重新整理

  //- 訂單列表
  template(v-else)
    .PageDriverPending__card(v-for="order in orders" :key="order.orderId")
      .PageDriverPending__card-head
        .PageDriverPending__type-badge {{ ORDER_TYPE_LABEL[order.orderType] ?? order.orderType }}
        .PageDriverPending__vehicle {{ VEHICLE_LABEL[order.vehicleType] ?? order.vehicleType }}
        .PageDriverPending__id \#{{ order.orderId.slice(0, 8).toUpperCase() }}

      .PageDriverPending__time
        span.PageDriverPending__time-label 用車時間
        span.PageDriverPending__time-val {{ $dayjs(order.pickupDateTime).format('MM/DD HH:mm') }}

      .PageDriverPending__route
        .PageDriverPending__route-point.is-pickup
          .PageDriverPending__route-dot
          span {{ order.pickupLocation?.displayName || order.pickupLocation?.address }}
        .PageDriverPending__route-line
        .PageDriverPending__route-point.is-dropoff
          .PageDriverPending__route-dot
          span {{ order.dropoffLocation?.displayName || order.dropoffLocation?.address }}

      .PageDriverPending__card-foot
        .PageDriverPending__meta
          span {{ order.distanceKm }} km
          span NT$ {{ order.estimatedFare.toLocaleString() }}
        .PageDriverPending__btns
          button.PageDriverPending__btn.is-decline(
            :disabled="accepting === order.orderId"
            @click="ClickDecline(order.orderId)"
          ) 略過
          button.PageDriverPending__btn.is-accept(
            :disabled="!!accepting"
            @click="ClickAccept(order)"
          ) {{ accepting === order.orderId ? '接單中...' : '接單' }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;

.PageDriverPending {
  padding: 80px 16px 100px;
  min-height: 100svh;
  background: #0d0f14;
  color: #fff;
}

.PageDriverPending__header {
  margin-bottom: 24px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: $amber;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    &::before { content: ''; width: 20px; height: 1.5px; background: $amber; }
  }

  &-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 36px;
    letter-spacing: 0.04em;
    color: #fff;
  }
}

.PageDriverPending__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageDriverPending__spinner {
  width: 28px; height: 28px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.PageDriverPending__empty {
  text-align: center;
  padding: 60px 0;

  &-icon { font-size: 48px; margin-bottom: 12px; }

  p {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 15px;
    color: rgba(255, 255, 255, 0.5);
  }

  small {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.25);
  }
}

.PageDriverPending__card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 14px;

  &-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  &-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
}

.PageDriverPending__type-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  border-radius: 100px;
  background: rgba($amber, 0.15);
  border: 1px solid rgba($amber, 0.3);
  color: $amber;
}

.PageDriverPending__vehicle {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.4);
}

.PageDriverPending__id {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.2);
  margin-left: auto;
}

.PageDriverPending__time {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;

  &-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.3);
    text-transform: uppercase;
  }

  &-val {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 18px;
    color: #fff;
    letter-spacing: 0.05em;
  }
}

.PageDriverPending__route { display: flex; flex-direction: column; gap: 0; }

.PageDriverPending__route-point {
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

.PageDriverPending__route-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;

  .is-pickup & { background: $amber; }
  .is-dropoff & { background: transparent; border: 2px solid rgba(255, 255, 255, 0.4); }
}

.PageDriverPending__route-line {
  width: 1.5px;
  height: 14px;
  background: rgba(255, 255, 255, 0.12);
  margin-left: 4px;
}

.PageDriverPending__meta {
  display: flex;
  gap: 14px;

  span {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.5);
  }
}

.PageDriverPending__btns { display: flex; gap: 8px; }

.PageDriverPending__btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 8px 18px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;
  border: none;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-decline {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.4);
  }

  &.is-accept {
    background: $amber;
    color: #fff;

    &:active:not(:disabled) { transform: scale(0.97); }
  }
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
