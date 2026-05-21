<script setup lang="ts">
import type { AdminOrder, AdminOrderLuggageItem, AdminUser, AdminBidWithMatch } from '@/protocol/fetch-api/api/admin';
import { ORDER_TYPES } from '~shared/pricing';

definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const storeConfig = StoreConfig();

const ORDER_TYPE_LABEL = Object.fromEntries(ORDER_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;

// P23：car / extras label 從 store 動態查（admin 改完不用重啟）
const VEHICLE_LABEL = (id: string) =>
  storeConfig.GetVehicle(id)?.label.zh ?? id;
const EXTRA_SERVICE_LABEL = (id: string) =>
  storeConfig.GetExtra(id)?.label.zh ?? id;
const VEHICLE_OPTIONS = computed(() =>
  storeConfig.EnabledVehicles.map((c) => ({ value: c.id, label: c.label.zh })),
);

const LUGGAGE_TYPE_LABEL = (id: string) =>
  storeConfig.GetLuggageType(id)?.label.zh ?? id;
const LuggageSummary = (items: AdminOrderLuggageItem[] | undefined) =>
  (items ?? []).map((i) => `${LUGGAGE_TYPE_LABEL(i.typeId)} × ${i.count}`).join('、') || '—';
const LuggageTotalSU = (items: AdminOrderLuggageItem[] | undefined) =>
  (items ?? []).reduce((sum, i) => sum + (storeConfig.GetLuggageType(i.typeId)?.su ?? 0) * i.count, 0);

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

// Wave 1 A3：日期過濾（共用 UiDateRangeFilter）
const dateRange = ref<{ from: string | null; to: string | null }>({ from: null, to: null });

// 舊版「指派彈窗」狀態（Commit C 會整合進新 modal；先保留以維持指派功能）
const assigningOrderId = ref<string | null>(null);
const selectedDriverUid = ref('');

// 新版 modal
const selectedOrder = ref<AdminOrder | null>(null);
const isEditing = ref(false);
const saving = ref(false);

interface EditForm {
  orderType: string;
  pickupDateTime: string; // for datetime-local input (YYYY-MM-DDTHH:mm)
  pickupLocation: GooglePlace | null;
  dropoffLocation: GooglePlace | null;
  stopovers: GooglePlace[];
  vehicleType: string;
  passengerCount: number;
  luggageItems: AdminOrderLuggageItem[];
  estimatedFare: number;
  extraServices: string[];
  passengerName: string;
  contactPhone: string;
  flightNumber: string;
  terminal: string;
  notes: string;
}
const editForm = reactive<EditForm>({
  orderType: '',
  pickupDateTime: '',
  pickupLocation: null,
  dropoffLocation: null,
  stopovers: [],
  vehicleType: '',
  passengerCount: 1,
  luggageItems: [],
  estimatedFare: 0,
  extraServices: [],
  passengerName: '',
  contactPhone: '',
  flightNumber: '',
  terminal: '',
  notes: '',
});

// 新增訂單彈窗
const showCreate = ref(false);

const filteredOrders = computed(() =>
  filterStatus.value ? orders.value.filter((o) => o.orderStatus === filterStatus.value) : orders.value,
);

const ApiLoadOrders = async () => {
  loading.value = true;
  try {
    const params: { status?: string; from?: string; to?: string } = {};
    if (dateRange.value.from) params.from = dateRange.value.from;
    if (dateRange.value.to) params.to = dateRange.value.to;
    const res = await $api.GetAllOrders(params);
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
  editForm.orderType = o.orderType;
  editForm.passengerName = o.passengerName ?? '';
  editForm.contactPhone = o.passengerPhone ?? '';
  // 把 ISO 轉成 datetime-local 可吃的格式（YYYY-MM-DDTHH:mm）
  editForm.pickupDateTime = $dayjs(o.pickupDateTime).format('YYYY-MM-DDTHH:mm');
  editForm.pickupLocation = { ...o.pickupLocation } as GooglePlace;
  editForm.dropoffLocation = { ...o.dropoffLocation } as GooglePlace;
  editForm.stopovers = (o.stopovers ?? []).map((s) => ({ ...s } as GooglePlace));
  editForm.vehicleType = o.vehicleType;
  editForm.passengerCount = o.passengerCount ?? 1;
  editForm.luggageItems = (o.luggageItems ?? []).map((i) => ({ ...i }));
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

// P23：行李 SU stepper（編輯模式）
const EditLuggageCount = (typeId: string): number =>
  editForm.luggageItems.find((i) => i.typeId === typeId)?.count ?? 0;

const SetEditLuggage = (typeId: string, rawValue: number | string) => {
  const count = Math.max(0, Math.min(20, Number(rawValue) || 0));
  const idx = editForm.luggageItems.findIndex((i) => i.typeId === typeId);
  if (count === 0) {
    if (idx >= 0) editForm.luggageItems.splice(idx, 1);
  } else if (idx >= 0) {
    editForm.luggageItems[idx].count = count;
  } else {
    editForm.luggageItems.push({ typeId, count });
  }
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
  if (!editForm.passengerName.trim()) {
    ElMessage({ message: '請填寫乘客姓名', type: 'warning' }); return;
  }
  if (!/^09\d{8}$/.test(editForm.contactPhone)) {
    ElMessage({ message: '聯絡電話格式錯誤（09 開頭 10 碼）', type: 'warning' }); return;
  }

  saving.value = true;
  try {
    const res = await $api.PatchOrder(selectedOrder.value.orderId, {
      orderType: editForm.orderType,
      passengerName: editForm.passengerName.trim(),
      contactPhone: editForm.contactPhone,
      pickupDateTime: $dayjs(editForm.pickupDateTime).toISOString(),
      pickupLocation: editForm.pickupLocation,
      dropoffLocation: editForm.dropoffLocation,
      stopovers: editForm.stopovers,
      vehicleType: editForm.vehicleType,
      passengerCount: editForm.passengerCount,
      luggageItems: editForm.luggageItems,
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

// ── 指派司機（從 modal 內觸發）─────────────────────────
const ClickOpenAssign = () => {
  if (!selectedOrder.value) return;
  assigningOrderId.value = selectedOrder.value.orderId;
  const cur = selectedOrder.value.assignedDriverId ?? '';
  selectedDriverUid.value = cur.startsWith('line:') ? cur.slice(5) : cur;
};

const ClickConfirmAssign = async () => {
  if (!assigningOrderId.value || !selectedDriverUid.value) return;
  const order = orders.value.find((o) => o.orderId === assigningOrderId.value);
  // pending 狀態指派時切到 confirmed；其他狀態僅換司機，不動狀態
  const body: PatchOrderParams = { assignedDriverId: selectedDriverUid.value };
  if (order && order.orderStatus === 'pending') body.orderStatus = 'confirmed';

  const res = await $api.PatchOrder(assigningOrderId.value, body);
  if (res.status.code === 200) {
    ElMessage({ message: '指派成功', type: 'success' });
    await ApiLoadOrders();
  } else {
    ElMessage({ message: res.status?.message?.zh_tw ?? '指派失敗', type: 'error' });
  }
  assigningOrderId.value = null;
  selectedDriverUid.value = '';
};

// ── 通知 sub-modal ─────────────────────────────────────────
interface NotifyDialog {
  open: boolean;
  target: 'passenger' | 'driver';
  message: string;
  sending: boolean;
}
const notifyDialog = reactive<NotifyDialog>({
  open: false,
  target: 'passenger',
  message: '',
  sending: false,
});

const _formatDateTime = (iso: string) => $dayjs(iso).format('YYYY/MM/DD (ddd) HH:mm');

const _DriverDocOf = (assignedDriverId: string): AdminUser | undefined => {
  if (!assignedDriverId) return undefined;
  const cleanUid = assignedDriverId.startsWith('line:') ? assignedDriverId.slice(5) : assignedDriverId;
  return drivers.value.find((d) => d.uid === cleanUid);
};

const _BuildPassengerTemplate = (o: AdminOrder): string => {
  const driver = _DriverDocOf(o.assignedDriverId);
  const driverName = driver?.driverApplication?.driverName ?? driver?.displayName ?? '（未指派）';
  const driverPhone = driver?.driverApplication?.phone ?? '（未提供）';
  const driverPlate = driver?.driverApplication?.plateNumber ?? '（未提供）';
  const vehicleLabel = VEHICLE_LABEL(o.vehicleType);
  const lines = [
    '【DEST·ANYWHERE 訂單通知】',
    `您的訂單 #${o.orderId.slice(0, 8).toUpperCase()} 已指派司機：`,
    `司機：${driverName}`,
    `聯絡電話：${driverPhone}`,
    `車牌：${driverPlate}`,
    `車型：${vehicleLabel}`,
    '',
    `用車時間：${_formatDateTime(o.pickupDateTime)}`,
    `上車點：${o.pickupLocation.displayName ?? o.pickupLocation.address}`,
    `下車點：${o.dropoffLocation.displayName ?? o.dropoffLocation.address}`,
    '',
    '如有任何問題請透過 LINE 聯繫客服。',
  ];
  return lines.join('\n');
};

const _BuildDriverTemplate = (o: AdminOrder): string => {
  const vehicleLabel = VEHICLE_LABEL(o.vehicleType);
  const orderTypeLabel = ORDER_TYPE_LABEL[o.orderType] ?? o.orderType;
  const lines = [
    '【DEST·ANYWHERE 新行程任務】',
    `訂單編號：#${o.orderId.slice(0, 8).toUpperCase()}`,
    `行程類型：${orderTypeLabel}`,
    `乘客：${o.passengerName || '（未提供）'}`,
    `人數：${o.passengerCount} 人 / 行李：${LuggageSummary(o.luggageItems)}（${LuggageTotalSU(o.luggageItems)} SU）`,
    '',
    `用車時間：${_formatDateTime(o.pickupDateTime)}`,
    `上車點：${o.pickupLocation.displayName ?? o.pickupLocation.address}`,
  ];
  if (o.stopovers?.length) {
    o.stopovers.forEach((s, i) => {
      lines.push(`停靠 ${i + 1}：${s.displayName ?? s.address}`);
    });
  }
  lines.push(`下車點：${o.dropoffLocation.displayName ?? o.dropoffLocation.address}`);
  if (o.flightNumber) lines.push(`航班：${o.flightNumber}`);
  if (o.terminal) lines.push(`航廈：${o.terminal}`);
  lines.push(`車型：${vehicleLabel}`);
  lines.push(`預估車資：NT$ ${o.estimatedFare.toLocaleString()}`);
  if (o.extraServices?.length) {
    const extras = o.extraServices.map((s) => EXTRA_SERVICE_LABEL(s)).join('、');
    lines.push(`額外服務：${extras}`);
  }
  if (o.notes) lines.push(`備註：${o.notes}`);
  return lines.join('\n');
};

const ClickOpenNotify = (target: 'passenger' | 'driver') => {
  if (!selectedOrder.value) return;
  if (target === 'driver' && !selectedOrder.value.assignedDriverId) {
    ElMessage({ message: '訂單尚未指派司機', type: 'warning' });
    return;
  }
  notifyDialog.target = target;
  notifyDialog.message = target === 'passenger'
    ? _BuildPassengerTemplate(selectedOrder.value)
    : _BuildDriverTemplate(selectedOrder.value);
  notifyDialog.open = true;
};

const ClickCloseNotify = () => {
  if (notifyDialog.sending) return;
  notifyDialog.open = false;
};

const ApiSendNotify = async () => {
  if (!selectedOrder.value || !notifyDialog.message.trim()) {
    ElMessage({ message: '訊息內容不可為空', type: 'warning' });
    return;
  }
  notifyDialog.sending = true;
  try {
    const res = await $api.NotifyOrder(selectedOrder.value.orderId, {
      target: notifyDialog.target,
      message: notifyDialog.message,
    });
    if (res.status.code === 200) {
      ElMessage({ message: '通知已發送', type: 'success' });
      notifyDialog.open = false;
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '通知發送失敗', type: 'error' });
    }
  } finally {
    notifyDialog.sending = false;
  }
};

// ── 取消訂單 sub-modal ─────────────────────────────────────
type CancelReasonKey = 'passenger' | 'driver' | 'system' | 'other';
const CANCEL_REASON_OPTIONS: Array<{ value: CancelReasonKey; label: string }> = [
  { value: 'passenger', label: '乘客取消' },
  { value: 'driver',    label: '司機取消' },
  { value: 'system',    label: '系統錯誤' },
  { value: 'other',     label: '其他（自填）' },
];

interface CancelDialog {
  open: boolean;
  reasonKey: CancelReasonKey;
  customText: string;
  cancelling: boolean;
}
const cancelDialog = reactive<CancelDialog>({
  open: false,
  reasonKey: 'passenger',
  customText: '',
  cancelling: false,
});

const ClickOpenCancel = () => {
  if (!selectedOrder.value) return;
  cancelDialog.reasonKey = 'passenger';
  cancelDialog.customText = '';
  cancelDialog.open = true;
};

const ClickCloseCancel = () => {
  if (cancelDialog.cancelling) return;
  cancelDialog.open = false;
};

const ApiCancelOrder = async () => {
  if (!selectedOrder.value) return;
  let reason = CANCEL_REASON_OPTIONS.find((o) => o.value === cancelDialog.reasonKey)?.label ?? '';
  if (cancelDialog.reasonKey === 'other') {
    if (!cancelDialog.customText.trim()) {
      ElMessage({ message: '請填寫取消原因', type: 'warning' });
      return;
    }
    reason = cancelDialog.customText.trim();
  }
  cancelDialog.cancelling = true;
  try {
    const res = await $api.PatchOrder(selectedOrder.value.orderId, {
      orderStatus: 'cancelled',
      cancelReason: reason,
    });
    if (res.status.code === 200) {
      ElMessage({ message: '訂單已取消', type: 'success' });
      cancelDialog.open = false;
      await ApiLoadOrders();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '取消失敗', type: 'error' });
    }
  } finally {
    cancelDialog.cancelling = false;
  }
};

// 是否可取消（已完成 / 已取消無法取消）
const canCancel = computed(() => {
  if (!selectedOrder.value) return false;
  return selectedOrder.value.orderStatus !== 'cancelled' && selectedOrder.value.orderStatus !== 'completed';
});

// ── Phase 1E：訂單需求單 / 司機喊單 / 配對 ──────────────────────────
// dispatch 狀態的 UI 規則（拍版 #1 不引入 bidding status）：
//   - status='pending' && !dispatchAt           → 未派發 → 顯示「發出需求單」
//   - status='pending' && dispatchAt && bids 全部 withdrawn → 已派發、等待喊單
//   - status='pending' && dispatchAt && active bids > 0     → 已派發、N 喊單中
//   - status!='pending'                          → 不顯示 dispatch section（confirmed 後走既有指派流程）

const bidsLoading = ref(false);
const dispatching = ref(false);
const assigningFromBid = ref<string | null>(null);
const orderBids = ref<AdminBidWithMatch[]>([]);

const ActiveBidCount = (order: AdminOrder): number =>
  (order.bids ?? []).filter((b) => !b.withdrawnAt).length;

const DispatchStateLabel = (order: AdminOrder): { text: string; cls: string } | null => {
  if (order.orderStatus !== 'pending') return null;
  if (!order.dispatchAt) return { text: '待派發', cls: 'is-pending' };
  const active = ActiveBidCount(order);
  if (active === 0) return { text: '待喊單', cls: 'is-progress' };
  return { text: `${active} 喊單`, cls: 'is-progress' };
};

const ApiLoadOrderBids = async () => {
  if (!selectedOrder.value) return;
  if (!selectedOrder.value.dispatchAt) {
    orderBids.value = [];
    return;
  }
  bidsLoading.value = true;
  try {
    const res = await $api.GetAdminOrderBids(selectedOrder.value.orderId);
    if (res.status?.code === 200 && res.data) {
      orderBids.value = (res.data as { bids?: AdminBidWithMatch[] }).bids ?? [];
    } else {
      orderBids.value = [];
    }
  } finally {
    bidsLoading.value = false;
  }
};

const ClickDispatch = async () => {
  if (!selectedOrder.value || dispatching.value) return;
  if (selectedOrder.value.orderStatus !== 'pending') {
    ElMessage({ message: '訂單狀態非待確認，無法發出需求單', type: 'warning' });
    return;
  }
  if (selectedOrder.value.dispatchAt) {
    ElMessage({ message: '訂單已派發', type: 'warning' });
    return;
  }
  dispatching.value = true;
  try {
    const res = await $api.DispatchOrder(selectedOrder.value.orderId);
    if (res.status.code === 200) {
      ElMessage({ message: '需求單已發出，已通知全部司機', type: 'success' });
      await ApiLoadOrders();
      await ApiLoadOrderBids();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '發出需求單失敗', type: 'error' });
    }
  } finally {
    dispatching.value = false;
  }
};

const ClickAssignFromBid = async (driverId: string) => {
  if (!selectedOrder.value || assigningFromBid.value) return;
  assigningFromBid.value = driverId;
  try {
    const res = await $api.AssignDriverFromBids(selectedOrder.value.orderId, { driverId });
    if (res.status.code === 200) {
      ElMessage({ message: '已指派該司機，雙向通知已發送', type: 'success' });
      await ApiLoadOrders();
      await ApiLoadOrderBids();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '指派失敗', type: 'error' });
    }
  } finally {
    assigningFromBid.value = null;
  }
};

// ── Phase 1F：Soft Match 確認 / 強制重新配對 ─────────────────────────
const CONFIRMATION_LABEL: Record<string, string> = {
  auto:     '自動接受',
  pending:  '等待乘客確認',
  accepted: '已接受',
  declined: '已拒絕',
};
const CONFIRMATION_TAG_CLASS: Record<string, string> = {
  auto:     'is-confirmed',
  pending:  'is-pending',
  accepted: 'is-confirmed',
  declined: 'is-cancel',
};
const ConfirmationLabel = (s: string | null | undefined): string => {
  if (!s) return '';
  return CONFIRMATION_LABEL[s] ?? s;
};
const ConfirmationCls = (s: string | null | undefined): string => {
  if (!s) return '';
  return CONFIRMATION_TAG_CLASS[s] ?? '';
};

const showRematchDialog = ref(false);
const rematchReason = ref('');
const rematching = ref(false);

const CanForceRematch = (order: AdminOrder | null): boolean => {
  if (!order) return false;
  if (order.orderStatus !== 'confirmed') return false;
  if (!order.assignedDriverId) return false;
  return true;
};

const ClickOpenRematch = () => {
  if (!selectedOrder.value || !CanForceRematch(selectedOrder.value)) return;
  rematchReason.value = '';
  showRematchDialog.value = true;
};

const ClickCloseRematch = () => {
  if (rematching.value) return;
  showRematchDialog.value = false;
  rematchReason.value = '';
};

const SubmitForceRematch = async () => {
  if (!selectedOrder.value) return;
  rematching.value = true;
  try {
    const res = await $api.ForceRematchOrder(selectedOrder.value.orderId, { reason: rematchReason.value });
    if (res.status.code === 200) {
      ElMessage({ message: '訂單已重新進入配對佇列，已通知司機與乘客', type: 'success' });
      showRematchDialog.value = false;
      rematchReason.value = '';
      await ApiLoadOrders();
      // 重新打開 modal — 若 status 改成 pending 需要重新載入 bids
      const refresh = orders.value.find((o) => o.orderId === selectedOrder.value?.orderId);
      if (refresh) selectedOrder.value = refresh;
      await ApiLoadOrderBids();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '重新配對失敗', type: 'error' });
    }
  } finally {
    rematching.value = false;
  }
};

// modal 開啟時自動載 bids（若已派發）；切換 selectedOrder 時重 fetch
watch(() => selectedOrder.value?.orderId, async (id) => {
  if (id) {
    await ApiLoadOrderBids();
  } else {
    orderBids.value = [];
  }
});

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
    //- Wave 1 A3：日期過濾（pickupDateTime 範圍）
    UiDateRangeFilter(
      v-model="dateRange"
      mode="single"
      granularity="day"
      @change="ApiLoadOrders"
    )
    .PageAdminOrders__count {{ filteredOrders.length }} 筆
    button.PageAdminOrders__create-btn(@click="showCreate = true") + 新增訂單

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
        .PageAdminOrders__cell.is-vehicle(data-label="車型") {{ VEHICLE_LABEL(o.vehicleType) }}
        .PageAdminOrders__cell.is-fare(data-label="費用") NT$ {{ o.estimatedFare.toLocaleString() }}
        .PageAdminOrders__cell.is-status(data-label="狀態")
          span.PageAdminOrders__status(:class="STATUS_CLASS[o.orderStatus]") {{ STATUS_LABEL[o.orderStatus] ?? o.orderStatus }}
          //- Phase 1E：dispatch 狀態徽章（pending 訂單疊加在主狀態下方）
          span.PageAdminOrders__dispatch-badge(
            v-if="DispatchStateLabel(o)"
            :class="DispatchStateLabel(o)?.cls"
          ) {{ DispatchStateLabel(o)?.text }}
          //- Phase 1F：重派次數徽章（>=1 才顯示）
          span.PageAdminOrders__dispatch-badge.is-rematch(
            v-if="(o.reMatchRound ?? 0) > 0"
          ) 重派 {{ o.reMatchRound }} 次
        .PageAdminOrders__cell.is-action
          span.PageAdminOrders__row-chevron ›

  //- ── Modal 詳情 ──────────────────────────────────────
  Transition(name="fade")
    .PageAdminOrders__modal-mask(v-if="selectedOrder" @click.self="ClickCloseDetail")
      .PageAdminOrders__modal
        //- Modal Header
        .PageAdminOrders__modal-head
          .PageAdminOrders__modal-head-left
            span.PageAdminOrders__modal-type {{ ORDER_TYPE_LABEL[selectedOrder.orderType] ?? selectedOrder.orderType }}
            span.PageAdminOrders__modal-vehicle {{ VEHICLE_LABEL(selectedOrder.vehicleType) }}
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
                span.PageAdminOrders__section-key 聯絡電話
                span.PageAdminOrders__section-val {{ selectedOrder.passengerPhone || '—' }}
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 人數
                span.PageAdminOrders__section-val {{ selectedOrder.passengerCount }} 人
              .PageAdminOrders__section-row(v-if="selectedOrder.luggageItems?.length")
                span.PageAdminOrders__section-key 行李
                span.PageAdminOrders__section-val {{ LuggageSummary(selectedOrder.luggageItems) }}（{{ LuggageTotalSU(selectedOrder.luggageItems) }} SU）

            //- Phase 1E：訂單需求單 / 司機喊單 / 配對
            //- 三狀態：未派發 / 已派發等待 / 已派發喊單中（confirmed 後不顯示）
            .PageAdminOrders__section(v-if="selectedOrder.orderStatus === 'pending'")
              .PageAdminOrders__section-title 訂單需求單
              //- 未派發
              template(v-if="!selectedOrder.dispatchAt")
                .PageAdminOrders__dispatch-empty 尚未發出需求單。發出後系統會以 LINE 推播通知全部已認證司機；司機可於接單看板喊單，您再從喊單清單挑選。
                button.PageAdminOrders__action.is-primary.is-block(
                  :disabled="dispatching"
                  @click="ClickDispatch"
                ) {{ dispatching ? '發送中...' : '📤 發出需求單' }}
              //- 已派發
              template(v-else)
                .PageAdminOrders__dispatch-meta
                  span 已派發於 {{ $dayjs(selectedOrder.dispatchAt).format('MM/DD HH:mm') }}
                  span.PageAdminOrders__dispatch-active {{ ActiveBidCount(selectedOrder) }} 司機喊單中（含撤回 {{ (selectedOrder.bids ?? []).length }} 筆）
                .PageAdminOrders__bid-loading(v-if="bidsLoading") 載入喊單清單中...
                AdminOrderBidList(
                  v-else
                  :bids="orderBids"
                  :assign-disabled="!!assigningFromBid || selectedOrder.orderStatus !== 'pending'"
                  @assign="ClickAssignFromBid"
                )

            //- 司機資訊
            .PageAdminOrders__section
              .PageAdminOrders__section-title 司機
              .PageAdminOrders__driver-row
                .PageAdminOrders__driver-info
                  span.PageAdminOrders__driver-name(v-if="DriverNameOf(selectedOrder.assignedDriverId)") {{ DriverNameOf(selectedOrder.assignedDriverId) }}
                  span.PageAdminOrders__driver-name.is-muted(v-else) 未指派
                button.PageAdminOrders__driver-assign-btn(
                  v-if="canCancel"
                  @click="ClickOpenAssign"
                ) {{ selectedOrder.assignedDriverId ? '更換司機' : '指派司機' }}

            //- Phase 1F：乘客確認狀態 + 強制重新配對（confirmed 訂單才顯示）
            .PageAdminOrders__section(v-if="selectedOrder.orderStatus === 'confirmed' && selectedOrder.assignedDriverId")
              .PageAdminOrders__section-title 配對確認狀態
              .PageAdminOrders__section-row(v-if="selectedOrder.passengerConfirmationStatus")
                span.PageAdminOrders__section-key 乘客確認
                span.PageAdminOrders__status(:class="ConfirmationCls(selectedOrder.passengerConfirmationStatus)") {{ ConfirmationLabel(selectedOrder.passengerConfirmationStatus) }}
              .PageAdminOrders__section-row(v-else)
                span.PageAdminOrders__section-key 乘客確認
                span.PageAdminOrders__section-val.is-muted 無紀錄（pre-1F 訂單）
              .PageAdminOrders__rematch-actions
                button.PageAdminOrders__action.is-warn(
                  :disabled="!CanForceRematch(selectedOrder)"
                  @click="ClickOpenRematch"
                ) 🔄 強制重新配對
                .PageAdminOrders__rematch-hint
                  | 移除目前中選司機，重新派發給全部司機並通知乘客。

            //- Phase 1F：歷次配對輪 snapshot
            .PageAdminOrders__section(v-if="(selectedOrder.bidHistory?.length ?? 0) > 0")
              .PageAdminOrders__section-title 配對歷史（重派 {{ selectedOrder.reMatchRound ?? 0 }} 次）
              .PageAdminOrders__bid-history
                .PageAdminOrders__history-row(v-for="h in selectedOrder.bidHistory" :key="h.round")
                  .PageAdminOrders__history-head
                    span.PageAdminOrders__history-round Round {{ h.round }}
                    span.PageAdminOrders__history-reason {{ h.endReason }}
                    span.PageAdminOrders__history-time(v-if="h.endedAt") {{ $dayjs(h.endedAt).format('MM/DD HH:mm') }}
                  .PageAdminOrders__history-bids(v-if="h.bids.length")
                    span.PageAdminOrders__history-bid(
                      v-for="b in h.bids"
                      :key="b.driverId"
                      :class="{ 'is-withdrawn': !!b.withdrawnAt }"
                    ) {{ b.driverDisplayName || b.driverId }}
                  .PageAdminOrders__history-empty(v-else) 該輪無喊單

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
                span.PageAdminOrders__extra-tag(v-for="s in selectedOrder.extraServices" :key="s") {{ EXTRA_SERVICE_LABEL(s) }}

            //- Phase 1D：乘客偏好標籤（snapshot；給 1E 配對用）
            .PageAdminOrders__section(v-if="selectedOrder.preferences && selectedOrder.preferences.tagSnapshot.length")
              .PageAdminOrders__section-title 乘客偏好（已鎖價）
              .PageAdminOrders__extras
                span.PageAdminOrders__extra-tag(
                  v-for="t in selectedOrder.preferences.tagSnapshot"
                  :key="t.id"
                ) {{ t.name.zh_tw }}{{ t.surchargeAmount > 0 ? ` (+${t.surchargeAmount})` : '' }}
              .PageAdminOrders__section-row(v-if="selectedOrder.preferences.tagSurcharge > 0")
                span.PageAdminOrders__section-key 偏好加價（max）
                span.PageAdminOrders__section-val.is-fare +NT$ {{ selectedOrder.preferences.tagSurcharge.toLocaleString() }}

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
            //- 行程類型
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 行程類型
              select.PageAdminOrders__edit-input(v-model="editForm.orderType")
                option(v-for="t in ORDER_TYPES" :key="t.value" :value="t.value") {{ t.label }}

            //- 乘客姓名 / 聯絡電話
            .PageAdminOrders__edit-grid
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 乘客姓名
                input.PageAdminOrders__edit-input(
                  v-model="editForm.passengerName" maxlength="40" placeholder="乘客姓名"
                )
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 聯絡電話
                input.PageAdminOrders__edit-input(
                  v-model="editForm.contactPhone" maxlength="10" inputmode="numeric" placeholder="09xxxxxxxx"
                )

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
                  option(v-if="editForm.vehicleType && !VEHICLE_OPTIONS.find(o => o.value === editForm.vehicleType)" :value="editForm.vehicleType") {{ editForm.vehicleType }}（已停用或刪除）
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 人數
                input.PageAdminOrders__edit-input(
                  type="number" v-model.number="editForm.passengerCount"
                  inputmode="numeric" min="1" max="20"
                )
            //- P23：行李改 SU 多類型陣列（依 store.luggageTypes 動態渲染 stepper）
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 行李（SU 計算）
              .PageAdminOrders__luggage-edit
                .PageAdminOrders__luggage-edit-row(
                  v-for="lt in storeConfig.luggageTypes"
                  :key="lt.id"
                )
                  span.PageAdminOrders__luggage-edit-name {{ lt.label.zh }}（{{ lt.su }} SU）
                  input.PageAdminOrders__edit-input(
                    type="number" min="0" max="20" inputmode="numeric"
                    :value="EditLuggageCount(lt.id)"
                    @input="(e) => SetEditLuggage(lt.id, ($event.target as HTMLInputElement).value)"
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
                  v-for="s in storeConfig.EnabledExtras"
                  :key="s.id"
                  type="button"
                  :class="{ 'is-active': editForm.extraServices.includes(s.id) }"
                  @click="ClickToggleExtra(s.id)"
                ) {{ s.label.zh }}

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
            button.PageAdminOrders__action.is-danger(
              v-if="canCancel"
              @click="ClickOpenCancel"
            ) 取消訂單
            .PageAdminOrders__foot-spacer
            button.PageAdminOrders__action.is-secondary(
              :disabled="!selectedOrder.assignedDriverId"
              @click="ClickOpenNotify('driver')"
            ) 通知司機
            button.PageAdminOrders__action.is-secondary(@click="ClickOpenNotify('passenger')") 通知乘客
            button.PageAdminOrders__action.is-primary(@click="ClickEditMode") 編輯訂單
          template(v-else)
            button.PageAdminOrders__action.is-secondary(@click="ClickCancelEdit" :disabled="saving") 取消編輯
            button.PageAdminOrders__action.is-primary(@click="ApiSaveEdit" :disabled="saving") {{ saving ? '儲存中...' : '儲存修改' }}

  //- 指派司機 sub-modal（從訂單 modal 觸發）
  .PageAdminOrders__sub-mask(v-if="assigningOrderId" @click.self="assigningOrderId = null")
    .PageAdminOrders__sub-modal
      .PageAdminOrders__sub-title 指派司機
      .PageAdminOrders__sub-body
        label.PageAdminOrders__edit-label 選擇司機（已核准）
        select.PageAdminOrders__edit-input(v-model="selectedDriverUid")
          option(value="" disabled) 請選擇司機
          option(v-for="d in drivers" :key="d.uid" :value="d.uid") {{ d.displayName }}
        p.PageAdminOrders__sub-hint 指派後不會自動通知司機；如需通知請使用「通知司機」按鈕。
      .PageAdminOrders__sub-actions
        button.PageAdminOrders__action.is-secondary(@click="assigningOrderId = null") 取消
        button.PageAdminOrders__action.is-primary(
          :disabled="!selectedDriverUid"
          @click="ClickConfirmAssign"
        ) 確認指派

  //- 通知 sub-modal（乘客 / 司機共用）
  .PageAdminOrders__sub-mask(v-if="notifyDialog.open" @click.self="ClickCloseNotify")
    .PageAdminOrders__sub-modal.is-wide
      .PageAdminOrders__sub-title
        | {{ notifyDialog.target === 'passenger' ? '通知乘客' : '通知司機' }}
        span.PageAdminOrders__sub-subtitle  · 透過 LINE 推送
      .PageAdminOrders__sub-body
        label.PageAdminOrders__edit-label 訊息內容（可整段編輯）
        textarea.PageAdminOrders__edit-textarea(
          v-model="notifyDialog.message"
          rows="12"
          maxlength="2000"
          placeholder="編輯訊息內容..."
        )
        .PageAdminOrders__char-count {{ notifyDialog.message.length }} / 2000
      .PageAdminOrders__sub-actions
        button.PageAdminOrders__action.is-secondary(
          @click="ClickCloseNotify"
          :disabled="notifyDialog.sending"
        ) 取消
        button.PageAdminOrders__action.is-primary(
          :disabled="notifyDialog.sending || !notifyDialog.message.trim()"
          @click="ApiSendNotify"
        ) {{ notifyDialog.sending ? '發送中...' : '發送通知' }}

  //- 取消訂單 sub-modal
  .PageAdminOrders__sub-mask(v-if="cancelDialog.open" @click.self="ClickCloseCancel")
    .PageAdminOrders__sub-modal
      .PageAdminOrders__sub-title 取消訂單
      .PageAdminOrders__sub-body
        label.PageAdminOrders__edit-label 取消原因
        select.PageAdminOrders__edit-input(v-model="cancelDialog.reasonKey")
          option(v-for="opt in CANCEL_REASON_OPTIONS" :key="opt.value" :value="opt.value") {{ opt.label }}
        textarea.PageAdminOrders__edit-textarea(
          v-if="cancelDialog.reasonKey === 'other'"
          v-model="cancelDialog.customText"
          rows="3"
          maxlength="200"
          placeholder="請填寫取消原因..."
          style="margin-top: 8px;"
        )
        p.PageAdminOrders__sub-hint.is-warn ⚠️ 取消後訂單狀態會改為「已取消」，且不會自動通知乘客 / 司機。如需通知請於取消後使用通知按鈕。
      .PageAdminOrders__sub-actions
        button.PageAdminOrders__action.is-secondary(
          @click="ClickCloseCancel"
          :disabled="cancelDialog.cancelling"
        ) 返回
        button.PageAdminOrders__action.is-danger(
          :disabled="cancelDialog.cancelling"
          @click="ApiCancelOrder"
        ) {{ cancelDialog.cancelling ? '處理中...' : '確認取消訂單' }}

  //- Phase 1F：強制重新配對 sub-modal
  .PageAdminOrders__sub-mask(v-if="showRematchDialog" @click.self="ClickCloseRematch")
    .PageAdminOrders__sub-modal
      .PageAdminOrders__sub-title 強制重新配對
      .PageAdminOrders__sub-body
        label.PageAdminOrders__edit-label 原因（選填）
        textarea.PageAdminOrders__edit-textarea(
          v-model="rematchReason"
          rows="3"
          maxlength="200"
          placeholder="例：車輛故障 / 司機反悔..."
        )
        p.PageAdminOrders__sub-hint.is-warn ⚠️ 觸發後將移除目前中選司機、清空當前喊單清單、重新派發給全部已認證司機，並通知乘客「正在重新配對中」。訂單狀態會回到「待派發」。
      .PageAdminOrders__sub-actions
        button.PageAdminOrders__action.is-secondary(
          @click="ClickCloseRematch"
          :disabled="rematching"
        ) 返回
        button.PageAdminOrders__action.is-warn(
          :disabled="rematching"
          @click="SubmitForceRematch"
        ) {{ rematching ? '處理中...' : '確認重新配對' }}

  //- 新增訂單彈窗
  AdminOrdersCreateModal(v-model="showCreate" @created="ApiLoadOrders")
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

.PageAdminOrders__create-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 16px;
  border-radius: 100px;
  border: 1px solid rgba($amber, 0.5);
  background: rgba($amber, 0.12);
  color: $amber;
  cursor: pointer;
  margin-left: auto;
  transition: all 0.15s;

  &:hover { background: rgba($amber, 0.2); }
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
      'type    vehicle';
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

  .PageAdminOrders__cell.is-action { display: none; }
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

// Phase 1E：dispatch 狀態徽章（疊加在主狀態下方）
.PageAdminOrders__dispatch-badge {
  display: inline-block;
  margin-top: 4px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 100px;

  &.is-pending  { background: rgba(255, 80, 80, 0.1);  border: 1px solid rgba(255, 80, 80, 0.25);  color: rgba(255, 120, 120, 0.85); }
  &.is-progress { background: rgba($amber, 0.12);       border: 1px solid rgba($amber, 0.3);         color: $amber; }
  // Phase 1F：重派次數徽章
  &.is-rematch  { background: rgba(140, 110, 220, 0.12); border: 1px solid rgba(140, 110, 220, 0.3); color: rgba(180, 150, 240, 0.95); margin-left: 4px; }
}

// Phase 1F：強制重新配對 + bidHistory
.PageAdminOrders__rematch-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.PageAdminOrders__rematch-hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
  line-height: 1.5;
}

.PageAdminOrders__bid-history {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageAdminOrders__history-row {
  border: 1px solid $border;
  border-radius: 8px;
  padding: 8px 12px;
  background: $surface;
}

.PageAdminOrders__history-head {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.PageAdminOrders__history-round {
  color: $amber;
  font-weight: 700;
}

.PageAdminOrders__history-reason {
  color: $muted;
}

.PageAdminOrders__history-time {
  color: $muted;
  margin-left: auto;
}

.PageAdminOrders__history-bids {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.PageAdminOrders__history-bid {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid $border;
  color: $text;

  &.is-withdrawn {
    text-decoration: line-through;
    opacity: 0.5;
  }
}

.PageAdminOrders__history-empty {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
}

.PageAdminOrders__dispatch-empty {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: $muted;
  line-height: 1.6;
  margin-bottom: 8px;
}

.PageAdminOrders__dispatch-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
}

.PageAdminOrders__dispatch-active {
  color: $amber;
  font-weight: 700;
}

.PageAdminOrders__bid-loading {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  color: $muted;
  padding: 12px 0;
  text-align: center;
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

// select 原生 popup 在 Windows/部分瀏覽器下會吃 OS theme（白底白字）。
// 直接在 option 上設定 dark 配色強制覆寫
.PageAdminOrders__edit-input option {
  background: #161b22;
  color: #fff;
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
  white-space: nowrap;

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

  &.is-danger {
    background: rgba(255, 80, 80, 0.1);
    color: rgba(255, 100, 100, 0.95);
    border-color: rgba(255, 80, 80, 0.35);
    &:hover:not(:disabled) { background: rgba(255, 80, 80, 0.18); }
  }

  // Phase 1F：warn 變體（強制重新配對等需謹慎但非破壞性的動作）
  &.is-warn {
    background: rgba(255, 165, 0, 0.1);
    color: rgba(255, 200, 100, 0.95);
    border-color: rgba(255, 165, 0, 0.35);
    &:hover:not(:disabled) { background: rgba(255, 165, 0, 0.2); }
  }

  &.is-block { display: block; width: 100%; }
}

.PageAdminOrders__foot-spacer { flex: 1; }

@media (max-width: 599.98px) {
  .PageAdminOrders__modal-foot {
    flex-wrap: wrap;
    gap: 8px;
  }
  .PageAdminOrders__foot-spacer { display: none; }
  .PageAdminOrders__action { flex: 1 1 calc(50% - 4px); padding: 9px 12px; font-size: 12px; }
}

// ── 列表 chevron ───────────────────────────────────────────
.PageAdminOrders__row-chevron {
  font-size: 22px;
  color: rgba(255, 255, 255, 0.25);
  text-align: center;
  display: block;
  line-height: 1;
}

@media (max-width: 767.98px) {
  .PageAdminOrders__row-chevron { display: none; }
}

// ── modal 內司機列 ─────────────────────────────────────────
.PageAdminOrders__driver-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid $border;
  border-radius: 10px;
}

.PageAdminOrders__driver-info { flex: 1; min-width: 0; }

.PageAdminOrders__driver-name {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 14px;
  color: #fff;
  font-weight: 700;

  &.is-muted { color: $muted; font-weight: 400; }
}

.PageAdminOrders__driver-assign-btn {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba($amber, 0.4);
  background: rgba($amber, 0.1);
  color: $amber;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;

  &:hover { background: rgba($amber, 0.18); }
}

// ── 字數提示 ──────────────────────────────────────────────
.PageAdminOrders__char-count {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  color: $muted;
  text-align: right;
  margin-top: 4px;
}

// ── sub-modal（指派 / 通知 / 取消 共用）────────────────────
.PageAdminOrders__sub-mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.PageAdminOrders__sub-modal {
  background: #161b22;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  padding: 22px;
  width: 100%;
  max-width: 380px;

  &.is-wide { max-width: 560px; }
}

.PageAdminOrders__sub-title {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.06em;
  color: #fff;
  margin-bottom: 16px;
}

.PageAdminOrders__sub-subtitle {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: $muted;
  margin-left: 4px;
}

.PageAdminOrders__sub-body {
  margin-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PageAdminOrders__sub-hint {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: $muted;
  margin-top: 8px;
  line-height: 1.5;

  &.is-warn { color: rgba(255, 200, 0, 0.7); }
}

.PageAdminOrders__sub-actions {
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
