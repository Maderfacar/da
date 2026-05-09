<script setup lang="ts">
import type { AdminOrder, AdminUser } from '@/protocol/fetch-api/api/admin';
import { EXTRA_SERVICES, ORDER_TYPES, VEHICLE_CONFIGS } from '~shared/pricing';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const ORDER_TYPE_LABEL = Object.fromEntries(ORDER_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;
const VEHICLE_LABEL = Object.fromEntries(Object.entries(VEHICLE_CONFIGS).map(([k, v]) => [k, v.label])) as Record<string, string>;
const EXTRA_SERVICE_LABEL = Object.fromEntries(EXTRA_SERVICES.map((s) => [s.value, s.label])) as Record<string, string>;
const VEHICLE_OPTIONS = Object.values(VEHICLE_CONFIGS).map((c) => ({ value: c.type, label: c.label }));

const STATUS_LABEL: Record<string, string> = {
  pending:        '待確認',
  confirmed:      '已確認',
  en_route:       '前往上車',
  arrived_pickup: '已抵達',
  in_transit:     '行程中',
  completed:      '已完成',
  cancelled:      '已取消',
};
const STATUS_CLASS: Record<string, string> = {
  pending:        'is-pending',
  confirmed:      'is-confirmed',
  en_route:       'is-progress',
  arrived_pickup: 'is-progress',
  in_transit:     'is-progress',
  completed:      'is-done',
  cancelled:      'is-cancel',
};

const loading = ref(false);
const orders = ref<AdminOrder[]>([]);
const drivers = ref<AdminUser[]>([]);
const filterStatus = ref('');

// 舊版「指派彈窗」狀態（Commit C 會整合進新 modal；先保留以維持指派功能）
const assigningOrderId = ref<string | null>(null);
const selectedDriverUid = ref('');

// 新版 modal
const selectedOrder = ref<AdminOrder | null>(null);
const isEditing = ref(false);
const saving = ref(false);

interface EditForm {
  pickupDateTime: string; // for datetime-local input (YYYY-MM-DDTHH:mm)
  pickupLocation: GooglePlace | null;
  dropoffLocation: GooglePlace | null;
  stopovers: GooglePlace[];
  vehicleType: string;
  passengerCount: number;
  luggageCount: number;
  estimatedFare: number;
  extraServices: string[];
  flightNumber: string;
  terminal: string;
  notes: string;
}
const editForm = reactive<EditForm>({
  pickupDateTime: '',
  pickupLocation: null,
  dropoffLocation: null,
  stopovers: [],
  vehicleType: '',
  passengerCount: 1,
  luggageCount: 0,
  estimatedFare: 0,
  extraServices: [],
  flightNumber: '',
  terminal: '',
  notes: '',
});

const filteredOrders = computed(() =>
  filterStatus.value ? orders.value.filter((o) => o.orderStatus === filterStatus.value) : orders.value,
);

const ApiLoadOrders = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAllOrders();
    if (res.status?.code !== 200) {
      ElMessage({ message: res.status?.message?.zh_tw ?? '載入訂單失敗', type: 'error' });
      orders.value = [];
      return;
    }
    orders.value = Array.isArray(res.data) ? (res.data as AdminOrder[]) : [];
    // 同步刷新 modal 內訂單（如果開著）
    if (selectedOrder.value) {
      const fresh = orders.value.find((o) => o.orderId === selectedOrder.value!.orderId);
      if (fresh) selectedOrder.value = fresh;
    }
  } finally {
    loading.value = false;
  }
};

const ApiLoadDrivers = async () => {
  const res = await $api.GetAdminUsers({ role: 'driver', approved: true });
  if (res.status?.code !== 200) {
    drivers.value = [];
    return;
  }
  drivers.value = Array.isArray(res.data) ? (res.data as AdminUser[]) : [];
};

const DriverNameOf = (uid: string) => {
  if (!uid) return null;
  const cleanUid = uid.startsWith('line:') ? uid.slice(5) : uid;
  return drivers.value.find((d) => d.uid === cleanUid)?.displayName ?? `UID:${cleanUid.slice(0, 6)}`;
};

// ── 列表點擊開 modal ──────────────────────────────────────
const ClickOpenDetail = (order: AdminOrder) => {
  selectedOrder.value = order;
  isEditing.value = false;
};

const ClickCloseDetail = () => {
  selectedOrder.value = null;
  isEditing.value = false;
};

// ── 編輯模式 ───────────────────────────────────────────────
const ClickEditMode = () => {
  if (!selectedOrder.value) return;
  const o = selectedOrder.value;
  // 把 ISO 轉成 datetime-local 可吃的格式（YYYY-MM-DDTHH:mm）
  editForm.pickupDateTime = $dayjs(o.pickupDateTime).format('YYYY-MM-DDTHH:mm');
  editForm.pickupLocation = { ...o.pickupLocation } as GooglePlace;
  editForm.dropoffLocation = { ...o.dropoffLocation } as GooglePlace;
  editForm.stopovers = (o.stopovers ?? []).map((s) => ({ ...s } as GooglePlace));
  editForm.vehicleType = o.vehicleType;
  editForm.passengerCount = o.passengerCount ?? 1;
  editForm.luggageCount = o.luggageCount ?? 0;
  editForm.estimatedFare = o.estimatedFare ?? 0;
  editForm.extraServices = [...(o.extraServices ?? [])];
  editForm.flightNumber = o.flightNumber ?? '';
  editForm.terminal = o.terminal ?? '';
  editForm.notes = o.notes ?? '';
  isEditing.value = true;
};

const ClickCancelEdit = () => {
  isEditing.value = false;
};

// 停靠站操作
const ClickAddStopover = () => {
  editForm.stopovers.push({ address: '', lat: 0, lng: 0 } as GooglePlace);
};
const ClickRemoveStopover = (idx: number) => {
  editForm.stopovers.splice(idx, 1);
};

// 額外服務 toggle
const ClickToggleExtra = (val: string) => {
  const i = editForm.extraServices.indexOf(val);
  if (i >= 0) editForm.extraServices.splice(i, 1);
  else editForm.extraServices.push(val);
};

// 儲存
const ApiSaveEdit = async () => {
  if (!selectedOrder.value) return;
  // 前端必填驗證
  if (!editForm.pickupLocation?.address) {
    ElMessage({ message: '請選擇上車點', type: 'warning' }); return;
  }
  if (!editForm.dropoffLocation?.address) {
    ElMessage({ message: '請選擇下車點', type: 'warning' }); return;
  }
  if (editForm.stopovers.some((s) => !s.address)) {
    ElMessage({ message: '請選擇所有停靠站地點', type: 'warning' }); return;
  }
  if (editForm.passengerCount < 1) {
    ElMessage({ message: '人數至少 1 人', type: 'warning' }); return;
  }
  if (editForm.estimatedFare < 0) {
    ElMessage({ message: '費用不可為負', type: 'warning' }); return;
  }

  saving.value = true;
  try {
    const res = await $api.PatchOrder(selectedOrder.value.orderId, {
      pickupDateTime: $dayjs(editForm.pickupDateTime).toISOString(),
      pickupLocation: editForm.pickupLocation,
      dropoffLocation: editForm.dropoffLocation,
      stopovers: editForm.stopovers,
      vehicleType: editForm.vehicleType,
      passengerCount: editForm.passengerCount,
      luggageCount: editForm.luggageCount,
      estimatedFare: editForm.estimatedFare,
      extraServices: editForm.extraServices,
      flightNumber: editForm.flightNumber || null,
      terminal: editForm.terminal || null,
      notes: editForm.notes || null,
    });
    if (res.status.code === 200) {
      ElMessage({ message: '儲存成功', type: 'success' });
      isEditing.value = false;
      await ApiLoadOrders();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '儲存失敗', type: 'error' });
    }
  } finally {
    saving.value = false;
  }
};

// ── 舊版指派彈窗（Commit C 會整合）──────────────────────
const ClickOpenAssign = (orderId: string, currentDriverId: string) => {
  assigningOrderId.value = orderId;
  // 把 line: prefix 去掉再對 drivers.uid
  selectedDriverUid.value = currentDriverId?.startsWith('line:') ? currentDriverId.slice(5) : (currentDriverId ?? '');
};

const ClickConfirmAssign = async () => {
  if (!assigningOrderId.value || !selectedDriverUid.value) return;
  const res = await $api.PatchOrder(assigningOrderId.value, {
    orderStatus: 'confirmed',
    assignedDriverId: selectedDriverUid.value,
  });
  if (res.status.code === 200) {
    ElMessage({ message: '指派成功', type: 'success' });
    await ApiLoadOrders();
  } else {
    ElMessage({ message: '指派失敗', type: 'error' });
  }
  assigningOrderId.value = null;
  selectedDriverUid.value = '';
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

      .PageAdminOrders__row.is-clickable(
        v-for="o in filteredOrders"
        :key="o.orderId"
        @click="ClickOpenDetail(o)"
      )
        .PageAdminOrders__cell.is-id(data-label="訂單")
          span.PageAdminOrders__order-id \#{{ o.orderId.slice(0, 8).toUpperCase() }}
        .PageAdminOrders__cell.is-type(data-label="行程")
          span.PageAdminOrders__type-badge {{ ORDER_TYPE_LABEL[o.orderType] ?? o.orderType }}
        .PageAdminOrders__cell.is-time(data-label="用車時間") {{ $dayjs(o.pickupDateTime).format('MM/DD HH:mm') }}
        .PageAdminOrders__cell.is-driver(data-label="司機")
          span(v-if="DriverNameOf(o.assignedDriverId)") {{ DriverNameOf(o.assignedDriverId) }}
          span.PageAdminOrders__unassigned(v-else) 未分派
        .PageAdminOrders__cell.is-vehicle(data-label="車型") {{ VEHICLE_LABEL[o.vehicleType] ?? o.vehicleType }}
        .PageAdminOrders__cell.is-fare(data-label="費用") NT$ {{ o.estimatedFare.toLocaleString() }}
        .PageAdminOrders__cell.is-status(data-label="狀態")
          span.PageAdminOrders__status(:class="STATUS_CLASS[o.orderStatus]") {{ STATUS_LABEL[o.orderStatus] ?? o.orderStatus }}
        .PageAdminOrders__cell.is-action(@click.stop)
          button.PageAdminOrders__assign-btn(
            v-if="o.orderStatus === 'pending' || o.orderStatus === 'confirmed'"
            @click="ClickOpenAssign(o.orderId, o.assignedDriverId)"
          ) 指派

  //- ── Modal 詳情 ──────────────────────────────────────
  Transition(name="fade")
    .PageAdminOrders__modal-mask(v-if="selectedOrder" @click.self="ClickCloseDetail")
      .PageAdminOrders__modal
        //- Modal Header
        .PageAdminOrders__modal-head
          .PageAdminOrders__modal-head-left
            span.PageAdminOrders__modal-type {{ ORDER_TYPE_LABEL[selectedOrder.orderType] ?? selectedOrder.orderType }}
            span.PageAdminOrders__modal-vehicle {{ VEHICLE_LABEL[selectedOrder.vehicleType] ?? selectedOrder.vehicleType }}
            span.PageAdminOrders__modal-status(:class="STATUS_CLASS[selectedOrder.orderStatus]") {{ STATUS_LABEL[selectedOrder.orderStatus] ?? selectedOrder.orderStatus }}
          button.PageAdminOrders__modal-close(@click="ClickCloseDetail") ×

        .PageAdminOrders__modal-id \#{{ selectedOrder.orderId.toUpperCase() }}

        //- Body
        .PageAdminOrders__modal-body
          //- ============= 檢視模式 =============
          template(v-if="!isEditing")
            //- 用車時間
            .PageAdminOrders__section
              .PageAdminOrders__section-title 用車時間
              .PageAdminOrders__section-val {{ $dayjs(selectedOrder.pickupDateTime).format('YYYY/MM/DD (ddd) HH:mm') }}

            //- 乘客資訊
            .PageAdminOrders__section
              .PageAdminOrders__section-title 乘客資訊
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 姓名
                span.PageAdminOrders__section-val {{ selectedOrder.passengerName || '—' }}
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 人數 / 行李
                span.PageAdminOrders__section-val {{ selectedOrder.passengerCount }} 人 / {{ selectedOrder.luggageCount }} 件

            //- 司機資訊
            .PageAdminOrders__section
              .PageAdminOrders__section-title 司機
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 已指派
                span.PageAdminOrders__section-val(v-if="DriverNameOf(selectedOrder.assignedDriverId)") {{ DriverNameOf(selectedOrder.assignedDriverId) }}
                span.PageAdminOrders__section-val.is-muted(v-else) 未指派

            //- 路線
            .PageAdminOrders__section
              .PageAdminOrders__section-title 行程路線
              .PageAdminOrders__addr-card.is-pickup
                .PageAdminOrders__addr-tag 上車
                .PageAdminOrders__addr-text
                  .PageAdminOrders__addr-name {{ selectedOrder.pickupLocation.displayName || selectedOrder.pickupLocation.address }}
                  .PageAdminOrders__addr-full(v-if="selectedOrder.pickupLocation.displayName") {{ selectedOrder.pickupLocation.address }}
              template(v-if="selectedOrder.stopovers && selectedOrder.stopovers.length")
                .PageAdminOrders__addr-card.is-stop(v-for="(stop, i) in selectedOrder.stopovers" :key="i")
                  .PageAdminOrders__addr-tag 停靠 {{ i + 1 }}
                  .PageAdminOrders__addr-text
                    .PageAdminOrders__addr-name {{ stop.displayName || stop.address }}
                    .PageAdminOrders__addr-full(v-if="stop.displayName") {{ stop.address }}
              .PageAdminOrders__addr-card.is-dropoff
                .PageAdminOrders__addr-tag 下車
                .PageAdminOrders__addr-text
                  .PageAdminOrders__addr-name {{ selectedOrder.dropoffLocation.displayName || selectedOrder.dropoffLocation.address }}
                  .PageAdminOrders__addr-full(v-if="selectedOrder.dropoffLocation.displayName") {{ selectedOrder.dropoffLocation.address }}

            //- 航班
            .PageAdminOrders__section(v-if="selectedOrder.flightNumber || selectedOrder.terminal")
              .PageAdminOrders__section-title 航班資訊
              .PageAdminOrders__section-row(v-if="selectedOrder.flightNumber")
                span.PageAdminOrders__section-key 航班編號
                span.PageAdminOrders__section-val {{ selectedOrder.flightNumber }}
              .PageAdminOrders__section-row(v-if="selectedOrder.terminal")
                span.PageAdminOrders__section-key 航廈
                span.PageAdminOrders__section-val {{ selectedOrder.terminal }}

            //- 額外服務
            .PageAdminOrders__section(v-if="selectedOrder.extraServices && selectedOrder.extraServices.length")
              .PageAdminOrders__section-title 額外服務
              .PageAdminOrders__extras
                span.PageAdminOrders__extra-tag(v-for="s in selectedOrder.extraServices" :key="s") {{ EXTRA_SERVICE_LABEL[s] || s }}

            //- 備註
            .PageAdminOrders__section(v-if="selectedOrder.notes")
              .PageAdminOrders__section-title 備註
              .PageAdminOrders__notes {{ selectedOrder.notes }}

            //- 費用 / 距離
            .PageAdminOrders__section
              .PageAdminOrders__section-title 費用 / 距離
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 預估車資
                span.PageAdminOrders__section-val.is-fare NT$ {{ selectedOrder.estimatedFare.toLocaleString() }}
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 距離
                span.PageAdminOrders__section-val {{ selectedOrder.distanceKm }} km

            //- 取消原因（如已取消）
            .PageAdminOrders__section(v-if="selectedOrder.orderStatus === 'cancelled' && selectedOrder.cancelReason")
              .PageAdminOrders__section-title 取消原因
              .PageAdminOrders__notes {{ selectedOrder.cancelReason }}

          //- ============= 編輯模式 =============
          template(v-else)
            //- 用車時間
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 用車日期 / 時間
              input.PageAdminOrders__edit-input(type="datetime-local" v-model="editForm.pickupDateTime")

            //- 上車點
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 上車點
              PassengerBookingLocationInput(v-model="editForm.pickupLocation" placeholder="搜尋上車地點")

            //- 停靠站
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 停靠站
              .PageAdminOrders__stopover-list
                .PageAdminOrders__stopover-item(v-for="(_stop, i) in editForm.stopovers" :key="i")
                  .PageAdminOrders__stopover-num 停靠 {{ i + 1 }}
                  PassengerBookingLocationInput(v-model="editForm.stopovers[i]" placeholder="搜尋停靠地點")
                  button.PageAdminOrders__stopover-remove(@click="ClickRemoveStopover(i)" type="button") ×
              button.PageAdminOrders__stopover-add(@click="ClickAddStopover" type="button") + 新增停靠站

            //- 下車點
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 下車點
              PassengerBookingLocationInput(v-model="editForm.dropoffLocation" placeholder="搜尋下車地點")

            //- 車型 / 人數 / 行李（同列 grid）
            .PageAdminOrders__edit-grid
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 車型
                select.PageAdminOrders__edit-input(v-model="editForm.vehicleType")
                  option(v-for="opt in VEHICLE_OPTIONS" :key="opt.value" :value="opt.value") {{ opt.label }}
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 人數
                input.PageAdminOrders__edit-input(
                  type="number" v-model.number="editForm.passengerCount"
                  inputmode="numeric" min="1" max="20"
                )
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 行李
                input.PageAdminOrders__edit-input(
                  type="number" v-model.number="editForm.luggageCount"
                  inputmode="numeric" min="0" max="20"
                )

            //- 費用
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 費用 (NT$)
              input.PageAdminOrders__edit-input(
                type="number" v-model.number="editForm.estimatedFare"
                inputmode="numeric" min="0"
              )

            //- 額外服務
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 額外服務
              .PageAdminOrders__extras-pick
                button.PageAdminOrders__extra-pick-btn(
                  v-for="s in EXTRA_SERVICES"
                  :key="s.value"
                  type="button"
                  :class="{ 'is-active': editForm.extraServices.includes(s.value) }"
                  @click="ClickToggleExtra(s.value)"
                ) {{ s.label }}

            //- 航班 / 航廈（接送機才顯示但 admin 兩欄都可填）
            .PageAdminOrders__edit-grid
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 航班編號
                input.PageAdminOrders__edit-input(v-model="editForm.flightNumber" maxlength="20" placeholder="如 BR189")
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 航廈
                input.PageAdminOrders__edit-input(v-model="editForm.terminal" maxlength="10" placeholder="如 T1")

            //- 備註
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 備註
              textarea.PageAdminOrders__edit-textarea(
                v-model="editForm.notes"
                rows="3"
                maxlength="500"
                placeholder="（選填）特殊需求或備忘"
              )

        //- Footer 操作
        .PageAdminOrders__modal-foot
          template(v-if="!isEditing")
            button.PageAdminOrders__action.is-secondary(@click="ClickEditMode") 編輯訂單
          template(v-else)
            button.PageAdminOrders__action.is-secondary(@click="ClickCancelEdit" :disabled="saving") 取消編輯
            button.PageAdminOrders__action.is-primary(@click="ApiSaveEdit" :disabled="saving") {{ saving ? '儲存中...' : '儲存修改' }}

  //- 舊版指派司機彈窗（Commit C 會整合進新 modal）
  .PageAdminOrders__modal-mask(v-if="assigningOrderId" @click.self="assigningOrderId = null")
    .PageAdminOrders__assign-modal
      .PageAdminOrders__assign-modal-title 指派司機
      .PageAdminOrders__assign-modal-body
        label.PageAdminOrders__edit-label 選擇司機
        select.PageAdminOrders__edit-input(v-model="selectedDriverUid")
          option(value="" disabled) 請選擇司機
          option(v-for="d in drivers" :key="d.uid" :value="d.uid") {{ d.displayName }}
      .PageAdminOrders__assign-modal-actions
        button.PageAdminOrders__action.is-secondary(@click="assigningOrderId = null") 取消
        button.PageAdminOrders__action.is-primary(
          :disabled="!selectedDriverUid"
          @click="ClickConfirmAssign"
        ) 確認指派
</template>

<style lang="scss" scoped>
$bg: #0d0f14;
$surface: rgba(255, 255, 255, 0.04);
$surface-2: rgba(255, 255, 255, 0.08);
$border: rgba(255, 255, 255, 0.08);
$amber: #d4860a;
$amber-light: #f7b96a;
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
  transition: background 0.15s, border-color 0.15s;

  &.is-clickable {
    cursor: pointer;

    &:hover {
      background: $surface-2;
      border-color: rgba($amber, 0.25);
    }
  }

  &.is-head {
    background: transparent;
    border-color: transparent;
    padding-bottom: 4px;
    cursor: default;

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

@media (max-width: 767.98px) {
  .PageAdminOrders { padding: 80px 12px 100px; }

  .PageAdminOrders__table {
    overflow-x: visible;
    gap: 10px;
  }

  .PageAdminOrders__row.is-head { display: none; }

  .PageAdminOrders__row {
    grid-template-columns: 1fr 1fr;
    grid-template-areas:
      'id      status'
      'time    time'
      'driver  fare'
      'type    vehicle'
      'action  action';
    min-width: 0;
    padding: 14px 14px 12px;
    gap: 8px 12px;
  }

  .PageAdminOrders__cell {
    overflow: visible;
    white-space: normal;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 14px;
  }

  .PageAdminOrders__cell::before {
    content: attr(data-label);
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: $muted;
  }

  .PageAdminOrders__cell.is-id { grid-area: id; }
  .PageAdminOrders__order-id { font-size: 14px; color: #fff; font-weight: 700; }

  .PageAdminOrders__cell.is-status { grid-area: status; align-items: flex-end; }

  .PageAdminOrders__cell.is-time {
    grid-area: time;
    font-size: 16px;
    color: #fff;
    font-weight: 700;
    padding: 8px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .PageAdminOrders__cell.is-time::before { color: $muted; }

  .PageAdminOrders__cell.is-driver { grid-area: driver; }
  .PageAdminOrders__cell.is-fare { grid-area: fare; align-items: flex-end; font-size: 16px; }
  .PageAdminOrders__cell.is-type { grid-area: type; }
  .PageAdminOrders__cell.is-vehicle { grid-area: vehicle; align-items: flex-end; }

  .PageAdminOrders__cell.is-action {
    grid-area: action;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    align-items: flex-start;
  }
  .PageAdminOrders__cell.is-action::before { display: none; }

  .PageAdminOrders__assign-btn {
    width: 100%;
    padding: 10px 14px;
    font-size: 13px;
  }
}

@media (max-width: 479.98px) {
  .PageAdminOrders__row { padding: 12px; }
  .PageAdminOrders__cell.is-time { font-size: 15px; }
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

// ── Modal ──────────────────────────────────────────────────
.PageAdminOrders__modal-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.PageAdminOrders__modal {
  width: 100%;
  max-width: 640px;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  overflow: hidden;
}

.PageAdminOrders__modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid $border;

  &-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
}

.PageAdminOrders__modal-type {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 10px;
  border-radius: 100px;
  background: rgba($amber, 0.15);
  border: 1px solid rgba($amber, 0.3);
  color: $amber-light;
}

.PageAdminOrders__modal-vehicle {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.08em;
}

.PageAdminOrders__modal-status {
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

.PageAdminOrders__modal-close {
  width: 32px;
  height: 32px;
  border: none;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
}

.PageAdminOrders__modal-id {
  padding: 8px 20px 0;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: $muted;
}

.PageAdminOrders__modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

// ── 檢視 Section ──────────────────────────────────────────
.PageAdminOrders__section { }

.PageAdminOrders__section-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: $muted;
  margin-bottom: 8px;
}

.PageAdminOrders__section-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
}

.PageAdminOrders__section-key { color: rgba(255, 255, 255, 0.45); }

.PageAdminOrders__section-val {
  color: #fff;
  text-align: right;

  &.is-fare { color: $amber; font-weight: 700; }
  &.is-muted { color: $muted; }
}

.PageAdminOrders__notes {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.75);
  white-space: pre-wrap;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 10px 12px;
}

.PageAdminOrders__addr-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid $border;
  margin-bottom: 6px;

  &.is-pickup .PageAdminOrders__addr-tag { background: rgba($amber, 0.18); color: $amber; border-color: rgba($amber, 0.35); }
  &.is-stop   .PageAdminOrders__addr-tag { background: rgba(100, 200, 255, 0.12); color: #64c8ff; border-color: rgba(100, 200, 255, 0.3); }
  &.is-dropoff .PageAdminOrders__addr-tag { background: rgba(80, 200, 120, 0.1); color: #50c878; border-color: rgba(80, 200, 120, 0.3); }
}

.PageAdminOrders__addr-tag {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid;
  flex-shrink: 0;
  white-space: nowrap;
}

.PageAdminOrders__addr-text { flex: 1; min-width: 0; }

.PageAdminOrders__addr-name {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: #fff;
  line-height: 1.4;
  word-break: break-word;
}

.PageAdminOrders__addr-full {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
  margin-top: 2px;
  line-height: 1.4;
  word-break: break-word;
}

.PageAdminOrders__extras {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.PageAdminOrders__extra-tag {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 100px;
  background: rgba($amber, 0.1);
  color: $amber-light;
  border: 1px solid rgba($amber, 0.25);
}

// ── 編輯欄位 ──────────────────────────────────────────────
.PageAdminOrders__edit-field { display: flex; flex-direction: column; gap: 6px; }

.PageAdminOrders__edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}

@media (max-width: 479.98px) {
  .PageAdminOrders__edit-grid { grid-template-columns: 1fr 1fr; }
}

.PageAdminOrders__edit-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: $muted;
}

.PageAdminOrders__edit-input,
.PageAdminOrders__edit-textarea {
  width: 100%;
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid $border;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  outline: none;
  resize: none;
  box-sizing: border-box;
  transition: border-color 0.15s;

  &::placeholder { color: rgba(255, 255, 255, 0.2); }
  &:focus { border-color: rgba($amber, 0.4); }
}

.PageAdminOrders__edit-input[type="datetime-local"] {
  color-scheme: dark;
}

.PageAdminOrders__stopover-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageAdminOrders__stopover-item {
  display: grid;
  grid-template-columns: 60px 1fr 32px;
  align-items: center;
  gap: 8px;
}

.PageAdminOrders__stopover-num {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #64c8ff;
  background: rgba(100, 200, 255, 0.1);
  border: 1px solid rgba(100, 200, 255, 0.25);
  padding: 4px 8px;
  border-radius: 6px;
  text-align: center;
}

.PageAdminOrders__stopover-remove {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 80, 80, 0.25);
  background: rgba(255, 80, 80, 0.08);
  color: rgba(255, 100, 100, 0.85);
  border-radius: 8px;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: rgba(255, 80, 80, 0.18); }
}

.PageAdminOrders__stopover-add {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px dashed rgba(100, 200, 255, 0.3);
  background: rgba(100, 200, 255, 0.04);
  color: #64c8ff;
  cursor: pointer;
  margin-top: 6px;
  transition: background 0.15s;

  &:hover { background: rgba(100, 200, 255, 0.1); }
}

.PageAdminOrders__extras-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.PageAdminOrders__extra-pick-btn {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid $border;
  background: $surface;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: all 0.15s;

  &.is-active {
    border-color: rgba($amber, 0.5);
    background: rgba($amber, 0.12);
    color: $amber-light;
  }
}

// ── Modal Footer ──────────────────────────────────────────
.PageAdminOrders__modal-foot {
  padding: 14px 20px;
  border-top: 1px solid $border;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.2);
}

.PageAdminOrders__action {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: $amber;
    color: #fff;
    &:hover:not(:disabled) { background: darken(#d4860a, 6%); }
  }

  &.is-secondary {
    background: $surface;
    color: rgba(255, 255, 255, 0.7);
    border-color: $border;
    &:hover:not(:disabled) { background: $surface-2; }
  }
}

// ── 舊版指派 modal ────────────────────────────────────────
.PageAdminOrders__assign-modal {
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  padding: 22px;
  width: 100%;
  max-width: 360px;
}

.PageAdminOrders__assign-modal-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.06em;
  color: #fff;
  margin-bottom: 18px;
}

.PageAdminOrders__assign-modal-body {
  margin-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PageAdminOrders__assign-modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

// ── Transition ────────────────────────────────────────────
.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }

@keyframes spin { to { transform: rotate(360deg); } }
</style>
