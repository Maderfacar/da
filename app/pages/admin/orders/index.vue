<script setup lang="ts">
import type { AdminOrder, AdminUser } from '@/protocol/fetch-api/api/admin';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

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
  in_transit:  '進行中',
  completed:   '已完成',
  cancelled:   '已取消',
};
const STATUS_CLASS: Record<string, string> = {
  pending:     'is-pending',
  confirmed:   'is-confirmed',
  in_transit:  'is-progress',
  completed:   'is-done',
  cancelled:   'is-cancel',
};

const loading = ref(false);
const orders = ref<AdminOrder[]>([]);
const drivers = ref<AdminUser[]>([]);
const filterStatus = ref('');
const assigningOrderId = ref<string | null>(null);
const selectedDriverUid = ref('');

const filteredOrders = computed(() =>
  filterStatus.value ? orders.value.filter((o) => o.orderStatus === filterStatus.value) : orders.value
);

const ApiLoadOrders = async () => {
  loading.value = true;
  const res = await $api.GetAllOrders();
  orders.value = (res.data as AdminOrder[]) ?? [];
  loading.value = false;
};

const ApiLoadDrivers = async () => {
  const res = await $api.GetAdminUsers({ role: 'driver', approved: true });
  drivers.value = (res.data as AdminUser[]) ?? [];
};

const ClickOpenAssign = (orderId: string, currentDriverId: string) => {
  assigningOrderId.value = orderId;
  selectedDriverUid.value = currentDriverId ?? '';
};

const ClickConfirmAssign = async () => {
  if (!assigningOrderId.value || !selectedDriverUid.value) return;
  const res = await $api.PatchOrder(assigningOrderId.value, {
    orderStatus: 'confirmed',
    assignedDriverId: selectedDriverUid.value,
  });
  if (res.status.code === 200) {
    const idx = orders.value.findIndex((o) => o.orderId === assigningOrderId.value);
    if (idx >= 0) {
      orders.value[idx] = {
        ...orders.value[idx],
        orderStatus: 'confirmed',
        assignedDriverId: selectedDriverUid.value,
      };
    }
    ElMessage({ message: '指派成功', type: 'success' });
  } else {
    ElMessage({ message: '指派失敗', type: 'error' });
  }
  assigningOrderId.value = null;
  selectedDriverUid.value = '';
};

const DriverNameOf = (uid: string) => {
  if (!uid) return null;
  return drivers.value.find((d) => d.uid === uid)?.displayName ?? `UID:${uid.slice(0, 6)}`;
};

onMounted(() => {
  ApiLoadOrders();
  ApiLoadDrivers();
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
        v-for="(label, key) in { '': '全部', pending: '待確認', confirmed: '已確認', in_transit: '進行中', completed: '已完成', cancelled: '已取消' }"
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
        span 司機
        span 車型
        span 費用
        span 狀態
        span 操作

      .PageAdminOrders__row(v-for="o in filteredOrders" :key="o.orderId")
        .PageAdminOrders__cell.is-id
          span.PageAdminOrders__order-id \#{{ o.orderId.slice(0, 8).toUpperCase() }}
        .PageAdminOrders__cell
          span.PageAdminOrders__type-badge {{ ORDER_TYPE_LABEL[o.orderType] ?? o.orderType }}
        .PageAdminOrders__cell.is-time {{ $dayjs(o.pickupDateTime).format('MM/DD HH:mm') }}
        .PageAdminOrders__cell
          span(v-if="DriverNameOf(o.assignedDriverId)") {{ DriverNameOf(o.assignedDriverId) }}
          span.PageAdminOrders__unassigned(v-else) 未分派
        .PageAdminOrders__cell {{ VEHICLE_LABEL[o.vehicleType] ?? o.vehicleType }}
        .PageAdminOrders__cell.is-fare NT$ {{ o.estimatedFare.toLocaleString() }}
        .PageAdminOrders__cell
          span.PageAdminOrders__status(:class="STATUS_CLASS[o.orderStatus]") {{ STATUS_LABEL[o.orderStatus] ?? o.orderStatus }}
        .PageAdminOrders__cell
          button.PageAdminOrders__assign-btn(
            v-if="o.orderStatus === 'pending' || o.orderStatus === 'confirmed'"
            @click="ClickOpenAssign(o.orderId, o.assignedDriverId)"
          ) 指派

  //- 指派司機彈窗
  .PageAdminOrders__modal-mask(v-if="assigningOrderId" @click.self="assigningOrderId = null")
    .PageAdminOrders__modal
      .PageAdminOrders__modal-title 指派司機
      .PageAdminOrders__modal-body
        label.PageAdminOrders__modal-label 選擇司機
        select.PageAdminOrders__modal-select(v-model="selectedDriverUid")
          option(value="" disabled) 請選擇司機
          option(v-for="d in drivers" :key="d.uid" :value="d.uid") {{ d.displayName }}
      .PageAdminOrders__modal-actions
        button.PageAdminOrders__modal-cancel(@click="assigningOrderId = null") 取消
        button.PageAdminOrders__modal-confirm(
          :disabled="!selectedDriverUid"
          @click="ClickConfirmAssign"
        ) 確認指派
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
  overflow-x: auto;
}

.PageAdminOrders__row {
  display: grid;
  grid-template-columns: 100px 80px 100px 90px 60px 90px 80px 60px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  background: $surface;
  border: 1px solid $border;
  min-width: 680px;

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

.PageAdminOrders__assign-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid rgba($amber, 0.35);
  background: rgba($amber, 0.08);
  color: $amber;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { background: rgba($amber, 0.16); }
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

// ── 指派彈窗 ──────────────────────────────────────────────────
.PageAdminOrders__modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.PageAdminOrders__modal {
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 24px;
  width: 100%;
  max-width: 360px;
}

.PageAdminOrders__modal-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.06em;
  color: #fff;
  margin-bottom: 20px;
}

.PageAdminOrders__modal-body { margin-bottom: 20px; }

.PageAdminOrders__modal-label {
  display: block;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: $muted;
  margin-bottom: 8px;
}

.PageAdminOrders__modal-select {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid $border;
  background: $surface;
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  outline: none;

  option { background: #161b22; }
}

.PageAdminOrders__modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.PageAdminOrders__modal-cancel {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 9px 18px;
  border-radius: 10px;
  border: 1px solid $border;
  background: $surface;
  color: $muted;
  cursor: pointer;
}

.PageAdminOrders__modal-confirm {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 9px 18px;
  border-radius: 10px;
  border: none;
  background: $amber;
  color: #fff;
  cursor: pointer;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
