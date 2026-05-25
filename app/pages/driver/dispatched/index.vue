<script setup lang="ts">
import type { DriverDispatchedOrderItem } from '@/protocol/fetch-api/api/driver';

definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const loading = ref(false);
const withdrawing = ref<string | null>(null);
const orders = ref<DriverDispatchedOrderItem[]>([]);
const activeTab = ref<'available' | 'mine'>('available');

// 縣市過濾（共用 UiCityFilter）— 上/下車地 toggle + 縣市/行政區多選
interface CityFilterState {
  regionField: 'pickup' | 'dropoff';
  cities: string[];
  districts: string[];
}
const cityFilter = ref<CityFilterState>({ regionField: 'pickup', cities: [], districts: [] });

// 從當前已載入 orders 聚合 distinct district（依 regionField + cities filter）
const availableDistricts = computed<string[]>(() => {
  const field = cityFilter.value.regionField;
  const citySet = new Set(cityFilter.value.cities);
  if (citySet.size === 0) return [];
  const set = new Set<string>();
  for (const o of orders.value) {
    const loc = field === 'dropoff' ? o.dropoffLocation : o.pickupLocation;
    const city = ((loc as { city?: string })?.city ?? '').trim();
    const cityKey = city || '__unknown__';
    if (!citySet.has(city) && !citySet.has(cityKey)) continue;
    const d = ((loc as { district?: string })?.district ?? '').trim() || '__unknown__';
    set.add(d);
  }
  return Array.from(set).sort();
});

const availableOrders = computed(() => orders.value.filter((o) => o.myBidStatus !== 'bid'));
const myBids = computed(() => orders.value.filter((o) => o.myBidStatus === 'bid'));

const ApiLoadOrders = async () => {
  loading.value = true;
  try {
    const params: { regionField?: 'pickup' | 'dropoff'; cities?: string; districts?: string } = {};
    if (cityFilter.value.cities.length > 0) {
      params.regionField = cityFilter.value.regionField;
      params.cities = cityFilter.value.cities.join(',');
      if (cityFilter.value.districts.length > 0) {
        params.districts = cityFilter.value.districts.join(',');
      }
    }
    const res = await $api.GetDispatchedOrders(params);
    if (res.status?.code === 200) {
      orders.value = (res.data as DriverDispatchedOrderItem[]) ?? [];
    } else {
      orders.value = [];
    }
  } finally {
    loading.value = false;
  }
};

const ClickOpen = (orderId: string) => {
  navigateTo(`/driver/dispatched/${orderId}`);
};

const ClickWithdraw = async (orderId: string) => {
  if (withdrawing.value) return;
  withdrawing.value = orderId;
  try {
    const res = await $api.DeleteOrderBid(orderId);
    if (res.status.code === 200) {
      ElMessage({ message: '已撤回喊單', type: 'success' });
      await ApiLoadOrders();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '撤回失敗', type: 'error' });
    }
  } finally {
    withdrawing.value = null;
  }
};

onMounted(ApiLoadOrders);
</script>

<template lang="pug">
.PageDriverDispatched
  .PageDriverDispatched__header
    .PageDriverDispatched__header-label DISPATCHED ORDERS
    h1.PageDriverDispatched__header-title 訂單需求單

  //- 縣市 / 行政區過濾（pickup OR dropoff toggle + 多選）
  .PageDriverDispatched__filter
    UiCityFilter(
      v-model="cityFilter"
      :available-districts="availableDistricts"
      @change="ApiLoadOrders"
    )

  .PageDriverDispatched__tabs
    button.PageDriverDispatched__tab(
      :class="{ 'is-active': activeTab === 'available' }"
      type="button"
      @click="activeTab = 'available'"
    )
      | 可接訂單
      span.PageDriverDispatched__tab-count {{ availableOrders.length }}
    button.PageDriverDispatched__tab(
      :class="{ 'is-active': activeTab === 'mine' }"
      type="button"
      @click="activeTab = 'mine'"
    )
      | 已喊單
      span.PageDriverDispatched__tab-count {{ myBids.length }}

  .PageDriverDispatched__loading(v-if="loading")
    .PageDriverDispatched__spinner

  template(v-else)
    template(v-if="activeTab === 'available'")
      .PageDriverDispatched__empty(v-if="!availableOrders.length")
        .PageDriverDispatched__empty-icon 📭
        p 目前無待接訂單
        small 派發中的訂單會即時出現在這裡
      .PageDriverDispatched__list(v-else)
        DriverDispatchedOrderCard(
          v-for="o in availableOrders"
          :key="o.orderId"
          :order="o"
          @open="ClickOpen"
        )

    template(v-else)
      .PageDriverDispatched__empty(v-if="!myBids.length")
        .PageDriverDispatched__empty-icon 🙋
        p 您目前未對任何訂單喊單
        small 從「可接訂單」進去詳情可以喊單
      .PageDriverDispatched__list(v-else)
        DriverDispatchedOrderCard(
          v-for="o in myBids"
          :key="o.orderId"
          :order="o"
          show-withdraw
          :busy="withdrawing === o.orderId"
          @open="ClickOpen"
          @withdraw="ClickWithdraw"
        )
</template>

<style lang="scss" scoped>
$amber: #d4860a;

.PageDriverDispatched {
  padding: 80px 16px 32px;
  min-height: 100svh;
  background: #0d0f14;
  color: #fff;
}

.PageDriverDispatched__header {
  margin-bottom: 20px;

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

.PageDriverDispatched__filter {
  margin-bottom: 12px;
}

.PageDriverDispatched__tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.PageDriverDispatched__tab {
  position: relative;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 10px 16px;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition: color 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;

  &:hover { color: rgba(255, 255, 255, 0.75); }

  &.is-active {
    color: $amber;
    &::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: $amber;
    }
  }
}

.PageDriverDispatched__tab-count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
}

.PageDriverDispatched__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageDriverDispatched__spinner {
  width: 28px; height: 28px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.PageDriverDispatched__empty {
  text-align: center;
  padding: 60px 16px;
  color: rgba(255, 255, 255, 0.45);

  p {
    font-family: 'Noto Sans TC', sans-serif;
    font-size: 14px;
    margin: 8px 0 4px;
    color: rgba(255, 255, 255, 0.75);
  }

  small {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
  }
}

.PageDriverDispatched__empty-icon {
  font-size: 40px;
  line-height: 1;
}

.PageDriverDispatched__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
