<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

interface Driver {
  driverId: string;
  name: string;
  phone: string;
  vehicleType: string;
  licensePlate: string;
  status: 'online' | 'offline' | 'on_trip';
  todayTrips: number;
  todayEarnings: number;
  rating: number;
}

const VEHICLE_LABEL: Record<string, string> = {
  sedan: '商務轎車', mpv: '商務 MPV', suv: '商務 SUV', van: '廂型車',
};
const STATUS_LABEL: Record<string, string> = {
  online:   '上線中',
  offline:  '離線',
  on_trip:  '任務中',
};
const STATUS_CLASS: Record<string, string> = {
  online:   'is-online',
  offline:  'is-offline',
  on_trip:  'is-trip',
};

const loading = ref(false);
const drivers = ref<Driver[]>([]);
const filterStatus = ref('');

const filteredDrivers = computed(() =>
  filterStatus.value ? drivers.value.filter((d) => d.status === filterStatus.value) : drivers.value,
);

const onlineCount = computed(() => drivers.value.filter((d) => d.status !== 'offline').length);

const _loadMock = () => {
  drivers.value = [
    { driverId: 'D001', name: '陳志明', phone: '0912-345-678', vehicleType: 'mpv', licensePlate: 'ABC-1234', status: 'on_trip', todayTrips: 3, todayEarnings: 4800, rating: 4.9 },
    { driverId: 'D002', name: '劉建宏', phone: '0923-456-789', vehicleType: 'sedan', licensePlate: 'DEF-5678', status: 'online', todayTrips: 1, todayEarnings: 800, rating: 4.7 },
    { driverId: 'D003', name: '張維安', phone: '0934-567-890', vehicleType: 'suv', licensePlate: 'GHI-9012', status: 'online', todayTrips: 2, todayEarnings: 3200, rating: 4.8 },
    { driverId: 'D004', name: '林育誠', phone: '0945-678-901', vehicleType: 'van', licensePlate: 'JKL-3456', status: 'offline', todayTrips: 0, todayEarnings: 0, rating: 4.6 },
    { driverId: 'D005', name: '王俊傑', phone: '0956-789-012', vehicleType: 'sedan', licensePlate: 'MNO-7890', status: 'offline', todayTrips: 4, todayEarnings: 5200, rating: 4.5 },
  ];
};

onMounted(() => {
  loading.value = true;
  setTimeout(() => { _loadMock(); loading.value = false; }, 500);
});
</script>

<template lang="pug">
.PageAdminDrivers
  .PageAdminDrivers__header
    .PageAdminDrivers__header-label DRIVER MANAGEMENT
    h1.PageAdminDrivers__header-title 司機管理

  .PageAdminDrivers__summary
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label TOTAL DRIVERS
      .PageAdminDrivers__summary-val {{ drivers.length }}
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label ON DUTY
      .PageAdminDrivers__summary-val {{ onlineCount }}
    .PageAdminDrivers__summary-item
      .PageAdminDrivers__summary-label ON TRIP
      .PageAdminDrivers__summary-val {{ drivers.filter(d => d.status === 'on_trip').length }}

  .PageAdminDrivers__toolbar
    .PageAdminDrivers__filters
      button.PageAdminDrivers__filter-btn(
        v-for="(label, key) in { '': '全部', online: '上線中', on_trip: '任務中', offline: '離線' }"
        :key="key"
        :class="{ 'is-active': filterStatus === key }"
        @click="filterStatus = key"
      ) {{ label }}

  .PageAdminDrivers__loading(v-if="loading")
    .PageAdminDrivers__spinner

  template(v-else)
    .PageAdminDrivers__empty(v-if="!filteredDrivers.length")
      p 暫無司機資料

    .PageAdminDrivers__list(v-else)
      .PageAdminDrivers__card(v-for="d in filteredDrivers" :key="d.driverId")
        .PageAdminDrivers__card-top
          .PageAdminDrivers__avatar {{ d.name.slice(0, 1) }}
          .PageAdminDrivers__info
            .PageAdminDrivers__name {{ d.name }}
            .PageAdminDrivers__phone {{ d.phone }}
          span.PageAdminDrivers__status(:class="STATUS_CLASS[d.status]") {{ STATUS_LABEL[d.status] }}

        .PageAdminDrivers__card-meta
          .PageAdminDrivers__meta-item
            span.PageAdminDrivers__meta-label 車型
            span.PageAdminDrivers__meta-val {{ VEHICLE_LABEL[d.vehicleType] ?? d.vehicleType }}
          .PageAdminDrivers__meta-item
            span.PageAdminDrivers__meta-label 車牌
            span.PageAdminDrivers__meta-val {{ d.licensePlate }}
          .PageAdminDrivers__meta-item
            span.PageAdminDrivers__meta-label 今日
            span.PageAdminDrivers__meta-val {{ d.todayTrips }} 趟
          .PageAdminDrivers__meta-item
            span.PageAdminDrivers__meta-label 收入
            span.PageAdminDrivers__meta-val.is-earnings NT$ {{ d.todayEarnings.toLocaleString() }}
          .PageAdminDrivers__meta-item
            span.PageAdminDrivers__meta-label 評分
            span.PageAdminDrivers__meta-val ⭐ {{ d.rating.toFixed(1) }}
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$muted: rgba(255, 255, 255, 0.35);

.PageAdminDrivers {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: $bg;
  color: #fff;
}

.PageAdminDrivers__header {
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

.PageAdminDrivers__summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.PageAdminDrivers__summary-item {
  background: $surface;
  border: 1px solid $border;
  border-radius: 14px;
  padding: 14px 16px;
}

.PageAdminDrivers__summary-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: $muted;
  margin-bottom: 6px;
}

.PageAdminDrivers__summary-val {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 28px;
  color: #fff;
  line-height: 1;
}

.PageAdminDrivers__toolbar {
  margin-bottom: 16px;
}

.PageAdminDrivers__filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.PageAdminDrivers__filter-btn {
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

.PageAdminDrivers__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageAdminDrivers__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.PageAdminDrivers__empty {
  text-align: center;
  padding: 60px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: $muted;
}

.PageAdminDrivers__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageAdminDrivers__card {
  background: $surface;
  border: 1px solid $border;
  border-radius: 16px;
  padding: 14px 16px;

  &-top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid $border;
  }

  &-meta {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
}

.PageAdminDrivers__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba($amber, 0.15);
  border: 1px solid rgba($amber, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: $amber;
  flex-shrink: 0;
}

.PageAdminDrivers__info { flex: 1; min-width: 0; }

.PageAdminDrivers__name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
}

.PageAdminDrivers__phone {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  color: $muted;
}

.PageAdminDrivers__status {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 10px;
  border-radius: 100px;
  flex-shrink: 0;

  &.is-online  { background: rgba(80, 200, 120, 0.1); border: 1px solid rgba(80, 200, 120, 0.3); color: #50c878; }
  &.is-trip    { background: rgba($amber, 0.12); border: 1px solid rgba($amber, 0.3); color: $amber; }
  &.is-offline { background: rgba(255, 255, 255, 0.05); border: 1px solid $border; color: $muted; }
}

.PageAdminDrivers__meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.PageAdminDrivers__meta-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: $muted;
}

.PageAdminDrivers__meta-val {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);

  &.is-earnings { color: $amber; }
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
