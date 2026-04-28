<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

interface AdminOrder {
  orderId: string;
  orderType: string;
  pickupDateTime: string;
  pickupAddress: string;
  dropoffAddress: string;
  vehicleType: string;
  estimatedFare: number;
  distanceKm: number;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  passengerName: string;
  driverName: string | null;
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  'airport-pickup':  '接機',
  'airport-dropoff': '送機',
  'charter':         '包車',
  'transfer':        '接送',
};
const VEHICLE_LABEL: Record<string, string> = {
  sedan: '轎車', mpv: 'MPV', suv: 'SUV', van: '廂型',
};
const STATUS_LABEL: Record<string, string> = {
  pending:     '待確認',
  confirmed:   '已確認',
  in_progress: '進行中',
  completed:   '已完成',
  cancelled:   '已取消',
};
const STATUS_CLASS: Record<string, string> = {
  pending:     'is-pending',
  confirmed:   'is-confirmed',
  in_progress: 'is-progress',
  completed:   'is-done',
  cancelled:   'is-cancel',
};

const loading = ref(false);
const orders = ref<AdminOrder[]>([]);
const filterStatus = ref('');

const filteredOrders = computed(() =>
  filterStatus.value ? orders.value.filter((o) => o.status === filterStatus.value) : orders.value,
);

const _loadMock = () => {
  orders.value = [
    {
      orderId: 'A1B2C3D4', orderType: 'airport-pickup',
      pickupDateTime: $dayjs().add(2, 'hour').toISOString(),
      pickupAddress: '桃園國際機場 第一航廈（T1）', dropoffAddress: '台北市信義區市府路1號',
      vehicleType: 'mpv', estimatedFare: 1800, distanceKm: 42,
      status: 'confirmed', passengerName: '林先生', driverName: '陳志明',
    },
    {
      orderId: 'E5F6G7H8', orderType: 'airport-dropoff',
      pickupDateTime: $dayjs().add(4, 'hour').toISOString(),
      pickupAddress: '新北市板橋區縣民大道一段188號', dropoffAddress: '桃園國際機場 第二航廈（T2）',
      vehicleType: 'sedan', estimatedFare: 1200, distanceKm: 34,
      status: 'pending', passengerName: '張小姐', driverName: null,
    },
    {
      orderId: 'I9J0K1L2', orderType: 'charter',
      pickupDateTime: $dayjs().add(1, 'day').toISOString(),
      pickupAddress: '台北市中正區忠孝西路一段49號', dropoffAddress: '台中市西屯區台灣大道三段99號',
      vehicleType: 'suv', estimatedFare: 4500, distanceKm: 168,
      status: 'pending', passengerName: '王總監', driverName: null,
    },
    {
      orderId: 'M3N4O5P6', orderType: 'transfer',
      pickupDateTime: $dayjs().subtract(1, 'hour').toISOString(),
      pickupAddress: '台北市大安區忠孝東路四段', dropoffAddress: '台北松山機場',
      vehicleType: 'sedan', estimatedFare: 800, distanceKm: 12,
      status: 'in_progress', passengerName: '黃先生', driverName: '劉建宏',
    },
    {
      orderId: 'Q7R8S9T0', orderType: 'airport-pickup',
      pickupDateTime: $dayjs().subtract(3, 'hour').toISOString(),
      pickupAddress: '桃園國際機場 第二航廈（T2）', dropoffAddress: '台北市南港區經貿二路',
      vehicleType: 'van', estimatedFare: 2200, distanceKm: 55,
      status: 'completed', passengerName: '吳小姐', driverName: '張維安',
    },
  ];
};

onMounted(() => {
  loading.value = true;
  setTimeout(() => { _loadMock(); loading.value = false; }, 500);
});
</script>

<template lang="pug">
.PageAdminOrders
  .PageAdminOrders__header
    .PageAdminOrders__header-label ORDER MANAGEMENT
    h1.PageAdminOrders__header-title 訂單管理

  .PageAdminOrders__toolbar
    .PageAdminOrders__filters
      button.PageAdminOrders__filter-btn(
        v-for="(label, key) in { '': '全部', pending: '待確認', confirmed: '已確認', in_progress: '進行中', completed: '已完成', cancelled: '已取消' }"
        :key="key"
        :class="{ 'is-active': filterStatus === key }"
        @click="filterStatus = key"
      ) {{ label }}
    .PageAdminOrders__count {{ filteredOrders.length }} 筆

  //- Loading
  .PageAdminOrders__loading(v-if="loading")
    .PageAdminOrders__spinner

  //- 列表
  template(v-else)
    .PageAdminOrders__empty(v-if="!filteredOrders.length")
      p 暫無符合條件的訂單

    .PageAdminOrders__table(v-else)
      .PageAdminOrders__row.is-head
        span 訂單
        span 行程類型
        span 用車時間
        span 乘客
        span 司機
        span 車型
        span 費用
        span 狀態

      .PageAdminOrders__row(v-for="o in filteredOrders" :key="o.orderId")
        .PageAdminOrders__cell.is-id
          span.PageAdminOrders__order-id \#{{ o.orderId.slice(0, 6) }}
        .PageAdminOrders__cell
          span.PageAdminOrders__type-badge {{ ORDER_TYPE_LABEL[o.orderType] ?? o.orderType }}
        .PageAdminOrders__cell.is-time {{ $dayjs(o.pickupDateTime).format('MM/DD HH:mm') }}
        .PageAdminOrders__cell {{ o.passengerName }}
        .PageAdminOrders__cell
          span(v-if="o.driverName") {{ o.driverName }}
          span.PageAdminOrders__unassigned(v-else) 未分派
        .PageAdminOrders__cell {{ VEHICLE_LABEL[o.vehicleType] ?? o.vehicleType }}
        .PageAdminOrders__cell.is-fare NT$ {{ o.estimatedFare.toLocaleString() }}
        .PageAdminOrders__cell
          span.PageAdminOrders__status(:class="STATUS_CLASS[o.status]") {{ STATUS_LABEL[o.status] }}
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$text: rgba(255, 255, 255, 0.8);
$muted: rgba(255, 255, 255, 0.35);

.PageAdminOrders {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageAdminOrders__header {
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

.PageAdminOrders__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.PageAdminOrders__filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.PageAdminOrders__filter-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 12px;
  border-radius: 100px;
  border: 1px solid $border;
  background: $surface;
  color: $muted;
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.1);
    color: $amber;
  }
}

.PageAdminOrders__count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
}

.PageAdminOrders__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageAdminOrders__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.PageAdminOrders__empty {
  text-align: center;
  padding: 60px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: $muted;
}

.PageAdminOrders__table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PageAdminOrders__row {
  display: grid;
  grid-template-columns: 90px 80px 100px 80px 80px 60px 90px 80px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  background: $surface;
  border: 1px solid $border;

  &.is-head {
    background: transparent;
    border-color: transparent;
    padding-bottom: 4px;

    span {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: $muted;
      text-transform: uppercase;
    }
  }
}

.PageAdminOrders__cell {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  color: $text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.is-time { color: rgba(255, 255, 255, 0.6); }
  &.is-fare { font-weight: 700; color: $amber; }
}

.PageAdminOrders__order-id {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
  letter-spacing: 0.05em;
}

.PageAdminOrders__type-badge {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 100px;
  background: rgba($amber, 0.12);
  border: 1px solid rgba($amber, 0.25);
  color: $amber;
}

.PageAdminOrders__unassigned {
  color: rgba(255, 255, 255, 0.2);
  font-size: 11px;
}

.PageAdminOrders__status {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: 100px;

  &.is-pending   { background: rgba(255, 200, 0, 0.12); border: 1px solid rgba(255, 200, 0, 0.3); color: #f5c518; }
  &.is-confirmed { background: rgba(100, 200, 255, 0.1); border: 1px solid rgba(100, 200, 255, 0.3); color: #64c8ff; }
  &.is-progress  { background: rgba($amber, 0.12); border: 1px solid rgba($amber, 0.3); color: $amber; }
  &.is-done      { background: rgba(80, 200, 120, 0.1); border: 1px solid rgba(80, 200, 120, 0.3); color: #50c878; }
  &.is-cancel    { background: rgba(255, 80, 80, 0.1); border: 1px solid rgba(255, 80, 80, 0.2); color: rgba(255, 100, 100, 0.8); }
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
