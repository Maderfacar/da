<script setup lang="ts">
import type { AdminOrder, AdminOrderLuggageItem, AdminUser, AdminBidWithMatch, GooglePlaceLite, OrderRecalcPreviewRes, OrderRecalcWarning, DispatchLevel } from '@/protocol/fetch-api/api/admin';
import type { TagDto } from '@/protocol/fetch-api/api/tag';
import type { GooglePlace as MapsGooglePlace } from '@/protocol/fetch-api/api/maps';
import { ORDER_TYPES } from '~shared/pricing';
import { formatPlaceName, formatRegion } from '~shared/location-label';

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

// 列表上車地址：拆「縣市行政區」與「地點名稱」兩段（舊訂單無 city/district 時由 address 解析）
const RegionOf = (loc: GooglePlaceLite | undefined) => formatRegion(loc);
const PlaceOf = (loc: GooglePlaceLite | undefined) => formatPlaceName(loc);

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

// 縣市過濾（共用 UiCityFilter）— regionField 切換上/下車地，cities + districts 多選
interface CityFilterState {
  regionField: 'pickup' | 'dropoff';
  cities: string[];
  districts: string[];
}
const cityFilter = ref<CityFilterState>({ regionField: 'pickup', cities: [], districts: [] });

// 從當前已載入 orders 聚合的 distinct district list（依 cityFilter.regionField + cities 過濾）
// 「歷史訂單無 city」歸 '__unknown__' bucket（UI 顯示為「未知」）
const availableDistricts = computed<string[]>(() => {
  const field = cityFilter.value.regionField;
  const citySet = new Set(cityFilter.value.cities);
  if (citySet.size === 0) return [];
  const set = new Set<string>();
  for (const o of orders.value) {
    const loc = field === 'dropoff' ? o.dropoffLocation : o.pickupLocation;
    const city = ((loc?.city as string | undefined) ?? '').trim();
    const cityKey = city || '__unknown__';
    if (!citySet.has(city) && !citySet.has(cityKey)) continue;
    const d = ((loc?.district as string | undefined) ?? '').trim() || '__unknown__';
    set.add(d);
  }
  return Array.from(set).sort();
});

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
  /** Booking v2 批次 2：admin 編輯訂單時拆大人 / 兒童 */
  adultCount: number;
  childCount: number;
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
  adultCount: 1,
  childCount: 0,
  luggageItems: [],
  estimatedFare: 0,
  extraServices: [],
  passengerName: '',
  contactPhone: '',
  flightNumber: '',
  terminal: '',
  notes: '',
});

// Wave 1C：訂單偏好標籤後修狀態
const vehicleTags = ref<TagDto[]>([]);
const tagsLoading = ref(false);
const editTagIds = ref<string[]>([]);
const originalTagIds = ref<string[]>([]);
const recalcPreview = ref<OrderRecalcPreviewRes | null>(null);
const recalcLoading = ref(false);
const recalcError = ref<string | null>(null);
const savingTags = ref(false);
let recalcDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const hasTagChange = computed(() => {
  const a = [...editTagIds.value].sort().join('|');
  const b = [...originalTagIds.value].sort().join('|');
  return a !== b;
});

const canEditTags = computed(() => {
  if (!selectedOrder.value) return false;
  if (selectedOrder.value.assignedDriverId) return false;
  return selectedOrder.value.orderStatus === 'pending';
});

const ApiLoadVehicleTags = async () => {
  if (vehicleTags.value.length > 0) return;
  tagsLoading.value = true;
  try {
    const res = await $api.GetActiveTags('vehicle');
    if (res.status?.code === 200 && Array.isArray(res.data?.tags)) {
      vehicleTags.value = res.data.tags;
    }
  } finally {
    tagsLoading.value = false;
  }
};

const ResetTagRecalcState = () => {
  if (recalcDebounceTimer) {
    clearTimeout(recalcDebounceTimer);
    recalcDebounceTimer = null;
  }
  recalcPreview.value = null;
  recalcError.value = null;
  recalcLoading.value = false;
};

// 新增訂單彈窗
const showCreate = ref(false);

const filteredOrders = computed(() =>
  filterStatus.value ? orders.value.filter((o) => o.orderStatus === filterStatus.value) : orders.value,
);

const ApiLoadOrders = async () => {
  loading.value = true;
  try {
    const params: { status?: string; from?: string; to?: string; regionField?: 'pickup' | 'dropoff'; cities?: string; districts?: string } = {};
    if (dateRange.value.from) params.from = dateRange.value.from;
    if (dateRange.value.to) params.to = dateRange.value.to;
    // 縣市 filter：cities 空就完全不帶（regionField 也省）— server 端對齊：只有 cities/districts 非空才生效
    if (cityFilter.value.cities.length > 0) {
      params.regionField = cityFilter.value.regionField;
      params.cities = cityFilter.value.cities.join(',');
      if (cityFilter.value.districts.length > 0) {
        params.districts = cityFilter.value.districts.join(',');
      }
    }
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

/** 折扣碼歸屬司機名（由 server batch join 後 referralDriverId 直接給 lineUid，前端只負責 join displayName） */
const ReferralDriverNameOf = (referralDriverId: string | null | undefined) => {
  if (!referralDriverId) return null;
  return drivers.value.find((d) => d.uid === referralDriverId)?.displayName ?? `UID:${referralDriverId.slice(0, 6)}`;
};

// A2 醜點系統 Phase 1：載 passenger 集合（uglyCount / blacklisted）供列表紅旗 + modal 顯示
const passengers = ref<AdminUser[]>([]);
const ApiLoadPassengers = async () => {
  const res = await $api.GetAdminUsers({ role: 'passenger' });
  if (res.status?.code !== 200) {
    passengers.value = [];
    return;
  }
  passengers.value = Array.isArray(res.data) ? (res.data as AdminUser[]) : [];
};

interface PassengerFlag {
  uglyCount: number;
  blacklisted: boolean;
}
const PassengerFlagOf = (uid: string | null | undefined): PassengerFlag | null => {
  if (!uid) return null;
  const cleanUid = uid.startsWith('line:') ? uid.slice(5) : uid;
  const p = passengers.value.find((u) => u.uid === cleanUid);
  if (!p) return null;
  return { uglyCount: p.uglyCount ?? 0, blacklisted: p.blacklisted === true };
};

// no-show sub-modal 狀態
const noShowDialog = reactive({
  open: false,
  reason: '',
  marking: false,
});
const ClickOpenNoShow = () => {
  if (!selectedOrder.value) return;
  noShowDialog.reason = '';
  noShowDialog.open = true;
};
const ClickCloseNoShow = () => {
  if (noShowDialog.marking) return;
  noShowDialog.open = false;
};
const NO_SHOW_VALID_STATUSES = new Set(['confirmed', 'en_route', 'arrived_pickup', 'in_transit']);
const canMarkNoShow = computed(() => {
  if (!selectedOrder.value) return false;
  return NO_SHOW_VALID_STATUSES.has(selectedOrder.value.orderStatus);
});
const ApiMarkNoShow = async () => {
  if (!selectedOrder.value) return;
  noShowDialog.marking = true;
  try {
    const res = await $api.MarkOrderNoShow(selectedOrder.value.orderId, {
      reason: noShowDialog.reason.trim() || undefined,
    });
    if (res.status.code === 200) {
      const pushed = res.data?.pushed;
      const pushMsg = pushed === 'suspended'
        ? '；已推送服務暫停通知'
        : pushed === 'warning'
          ? '；已推送最後警告'
          : '';
      ElMessage({ message: `已標記為 no-show（醜點 +2）${pushMsg}`, type: 'success' });
      noShowDialog.open = false;
      await Promise.all([ApiLoadOrders(), ApiLoadPassengers()]);
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '標記失敗', type: 'error' });
    }
  } finally {
    noShowDialog.marking = false;
  }
};

// ── 列表點擊開 modal ──────────────────────────────────────
const ClickOpenDetail = (order: AdminOrder) => {
  selectedOrder.value = order;
  isEditing.value = false;
  // Wave 2B+2C 強制必選版：
  //  - 已派發（重發場景）→ 沿用既有 dispatchVisibility.startLevel
  //  - 未派發（首發場景）→ '' 強制 admin 必選才能發布
  const existing = order.dispatchVisibility?.startLevel;
  if (order.dispatchAt && (existing === '0' || existing === '1' || existing === '2')) {
    modalStartLevel.value = existing;
  } else {
    modalStartLevel.value = '';
  }
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
  // Booking v2 批次 2：fallback 舊單無 adult/child
  editForm.adultCount = o.adultCount ?? o.passengerCount ?? 1;
  editForm.childCount = o.childCount ?? 0;
  editForm.luggageItems = (o.luggageItems ?? []).map((i) => ({ ...i }));
  editForm.estimatedFare = o.estimatedFare ?? 0;
  editForm.extraServices = [...(o.extraServices ?? [])];
  editForm.flightNumber = o.flightNumber ?? '';
  editForm.terminal = o.terminal ?? '';
  editForm.notes = o.notes ?? '';
  // Wave 1C：tag 後修初始化（同步 selectedOrder.preferences.tagIds）
  const prefTagIds = o.preferences?.tagIds ?? [];
  originalTagIds.value = [...prefTagIds];
  editTagIds.value = [...prefTagIds];
  ResetTagRecalcState();
  ApiLoadVehicleTags();
  isEditing.value = true;
};

const ClickCancelEdit = () => {
  isEditing.value = false;
  ResetTagRecalcState();
  originalTagIds.value = [];
  editTagIds.value = [];
};

// ── 停靠站操作 ───────────────────────────────────────────────────────────
// 空白列以 lat === 0 表示「尚未選點」，UiGooglePlaceInput 要收到 null 才會顯示 placeholder
const EMPTY_STOPOVER = (): GooglePlace => ({ address: '', lat: 0, lng: 0 } as GooglePlace);

const ClickAddStopover = () => {
  editForm.stopovers.push(EMPTY_STOPOVER());
};
const ClickRemoveStopover = (idx: number) => {
  editForm.stopovers.splice(idx, 1);
};

/** 訂單 GooglePlace（displayName optional）→ UiGooglePlaceInput 的 GooglePlace（displayName 必填） */
const AsPlaceInput = (loc: GooglePlace | null | undefined): MapsGooglePlace | null => {
  if (!loc?.address || loc.lat === 0) return null;
  return { ...loc, displayName: loc.displayName || loc.address } as MapsGooglePlace;
};

const UpdateStopover = (idx: number, place: MapsGooglePlace | null) => {
  editForm.stopovers[idx] = place ? (place as GooglePlace) : EMPTY_STOPOVER();
};

const ClickMoveStopover = (idx: number, delta: number) => {
  const target = idx + delta;
  if (target < 0 || target >= editForm.stopovers.length) return;
  const arr = [...editForm.stopovers];
  const [moved] = arr.splice(idx, 1);
  arr.splice(target, 0, moved!);
  editForm.stopovers = arr;
};

// 拖曳排序（與乘客端 BookingStepRoute 同一套 HTML5 DnD 行為；行動裝置另有 ▲▼ 按鈕）
const stopoverDragIndex = ref<number | null>(null);
const stopoverDragOverIndex = ref<number | null>(null);

const HandleStopoverDragStart = (idx: number, e: DragEvent) => {
  // 只允許從 drag handle 拖；點 input / 刪除鈕不該觸發整列拖移
  const target = e.target as HTMLElement | null;
  if (!target?.closest?.('.PageAdminOrders__stopover-handle')) {
    e.preventDefault();
    return;
  }
  stopoverDragIndex.value = idx;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }
};

const HandleStopoverDragOver = (idx: number, e: DragEvent) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (stopoverDragOverIndex.value !== idx) stopoverDragOverIndex.value = idx;
};

const HandleStopoverDragLeave = (idx: number) => {
  if (stopoverDragOverIndex.value === idx) stopoverDragOverIndex.value = null;
};

const HandleStopoverDrop = (idx: number, e: DragEvent) => {
  e.preventDefault();
  const from = stopoverDragIndex.value;
  stopoverDragIndex.value = null;
  stopoverDragOverIndex.value = null;
  if (from === null || from === idx) return;
  ClickMoveStopover(from, idx - from);
};

const HandleStopoverDragEnd = () => {
  stopoverDragIndex.value = null;
  stopoverDragOverIndex.value = null;
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
  if (editForm.adultCount < 1) {
    ElMessage({ message: '大人至少 1 人', type: 'warning' }); return;
  }
  if (editForm.childCount < 0) {
    ElMessage({ message: '兒童不可為負', type: 'warning' }); return;
  }
  // Booking v2 批次 2：總人數 = adult + child（passengerCount 由 server 自動同步）
  editForm.passengerCount = editForm.adultCount + editForm.childCount;
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
      adultCount: editForm.adultCount,
      childCount: editForm.childCount,
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

// Charter Fare V1 W5：admin OT 對帳區計算
// 司機應向乘客現場收取的金額 = estimatedFare（已含 discount / tagSurcharge）+ overtimeCharge
const CharterDriverCollectAmount = (order: AdminOrder): number => {
  const base = order.estimatedFare ?? 0;
  const ot = order.charter?.overtimeCharge ?? 0;
  return base + ot;
};

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
  // Booking v2 批次 2：人數摘要拆大人 / 兒童（child=0 退回「N 人」）
  const paxText = (o.childCount ?? 0) > 0
    ? `大人 ${o.adultCount ?? 1} / 兒童 ${o.childCount}`
    : `${o.passengerCount} 人`;
  const lines = [
    '【DEST·ANYWHERE 新行程任務】',
    `訂單編號：#${o.orderId.slice(0, 8).toUpperCase()}`,
    `行程類型：${orderTypeLabel}`,
    `乘客：${o.passengerName || '（未提供）'}`,
    `人數：${paxText} / 行李：${LuggageSummary(o.luggageItems)}（${LuggageTotalSU(o.luggageItems)} SU）`,
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
const redispatching = ref(false);
const assigningFromBid = ref<string | null>(null);
const orderBids = ref<AdminBidWithMatch[]>([]);

const { t: tI18n } = useI18n();

// Wave 1A：列表派單按鈕用 — per-row loading state（modal 內既有 dispatching/redispatching 不動）
// Set 取代 boolean，避免多個列同時點擊互相 disable；immutable 替換以觸發 reactivity。
const rowDispatchingIds = ref<Set<string>>(new Set());
const IsRowDispatching = (orderId: string) => rowDispatchingIds.value.has(orderId);

// Wave 2B+2C：首發等級 select（列表 per-row、modal 各自一份；__draft__ 只允許 modal）
// 強制必選版：首發場景預設 '' 強制 admin 選擇；重發場景沿用既有 startLevel
type RowStartLevel = DispatchLevel | ''; // '' = 未選（強制必選 placeholder）
type ModalStartLevel = DispatchLevel | '__draft__' | ''; // '' = 未選
const rowStartLevels = ref<Record<string, RowStartLevel>>({});
const modalStartLevel = ref<ModalStartLevel>('');
/**
 * 列表 per-row select 顯示值：
 *  - 首發場景（!dispatchAt）→ 若 admin 未動 select 則回 ''（觸發 placeholder，按鈕 disabled）
 *  - 重發場景（dispatchAt && !assignedDriverId）→ 若 admin 未動則回既有 startLevel（不強制改）
 */
const RowStartLevelOf = (order: AdminOrder): RowStartLevel => {
  const override = rowStartLevels.value[order.orderId];
  if (override !== undefined) return override;
  // 重發場景：沿用既有 startLevel（已分級過，不強制再選）
  if (order.dispatchAt) {
    const existing = order.dispatchVisibility?.startLevel;
    if (existing === '0' || existing === '1' || existing === '2') return existing;
  }
  // 首發場景：未選 → '' 觸發強制必選
  return '';
};
const SetRowStartLevel = (orderId: string, level: RowStartLevel) => {
  rowStartLevels.value = { ...rowStartLevels.value, [orderId]: level };
};
/** 判斷是否為有效首發等級（'0' / '1' / '2'，排除 '' 與 '__draft__'） */
const IsValidStartLevel = (v: unknown): v is DispatchLevel =>
  v === '0' || v === '1' || v === '2';
const START_LEVEL_OPTIONS: ReadonlyArray<{ value: DispatchLevel; labelKey: string }> = [
  { value: '2', labelKey: 'admin.orders.startLevel.pro' },
  { value: '1', labelKey: 'admin.orders.startLevel.standard' },
  { value: '0', labelKey: 'admin.orders.startLevel.all' },
];

/**
 * Wave 1A：計算訂單「總派發次數」(含首發 + 所有重發)。
 *   - dispatchAt 未存在    → 0 (尚未派發)
 *   - dispatchAt 存在      → (dispatchCount ?? 0) + 1
 *     （server 在首發時不寫 dispatchCount；每次重發 increment(1)）
 */
const DispatchAttemptCount = (order: AdminOrder): number =>
  order.dispatchAt ? (order.dispatchCount ?? 0) + 1 : 0;

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
  // Wave 2B+2C：__draft__ 等於不發布；只能先儲存其他欄位
  if (modalStartLevel.value === '__draft__') {
    ElMessage({ message: tI18n('admin.orders.startLevel.draftHint'), type: 'info' });
    return;
  }
  // 強制必選 runtime guard：button disabled 已守過一道，這裡是 defense-in-depth
  const level = modalStartLevel.value;
  if (!IsValidStartLevel(level)) {
    ElMessage({ message: tI18n('admin.orders.startLevel.requiredHint'), type: 'warning' });
    return;
  }
  const startLevel: DispatchLevel = level;
  dispatching.value = true;
  try {
    const res = await $api.DispatchOrder(selectedOrder.value.orderId, { startLevel });
    if (res.status.code === 200) {
      ElMessage({ message: '需求單已發出，已通知符合條件司機', type: 'success' });
      await ApiLoadOrders();
      await ApiLoadOrderBids();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '發出需求單失敗', type: 'error' });
    }
  } finally {
    dispatching.value = false;
  }
};

/**
 * 重發目前 modal 內的訂單的需求單 — 重新 LINE multicast 給所有 active driver。
 *
 * 條件：訂單必須 pending && 已派發 && 未指派（首發後司機沒人喊單 / 都撤回時使用）。
 * 行為：dispatchAt 保留首發時間、bids 陣列不動；只更新 lastDispatchAt + dispatchCount。
 */
const ClickRedispatch = async () => {
  if (!selectedOrder.value || redispatching.value) return;
  if (selectedOrder.value.orderStatus !== 'pending') {
    ElMessage({ message: '訂單狀態非待確認，無法重發', type: 'warning' });
    return;
  }
  if (!selectedOrder.value.dispatchAt) {
    ElMessage({ message: '訂單尚未首次派發，請改點「📤 發出需求單」', type: 'warning' });
    return;
  }
  if (selectedOrder.value.assignedDriverId) {
    ElMessage({ message: '訂單已指派司機，無法重發', type: 'warning' });
    return;
  }

  const orderShort = selectedOrder.value.orderId.slice(0, 8).toUpperCase();
  const ok = await UseAsk().Any(
    `重新推播 #${orderShort} 給所有已認證司機（既有喊單不會清除）。`,
    '重發需求單',
    '取消',
    '確定重發',
  );
  if (!ok) return;

  redispatching.value = true;
  try {
    // Wave 2B+2C：重發沿用既有 startLevel；admin 想換等級用 modal select 再點，等同 override
    // 強制必選版：modalStartLevel 多了 '' 型別，IsValidStartLevel 過濾後才作為 override
    const modalLevel = modalStartLevel.value;
    const overrideLevel: DispatchLevel | undefined = IsValidStartLevel(modalLevel) ? modalLevel : undefined;
    const res = await $api.RedispatchOrder(
      selectedOrder.value.orderId,
      overrideLevel !== undefined ? { startLevel: overrideLevel } : undefined,
    );
    if (res.status.code === 200 && res.data?.redispatched === true) {
      ElMessage({ message: '已重新發送需求單', type: 'success' });
      await ApiLoadOrders();
      await ApiLoadOrderBids();
    } else {
      ElMessage({ message: res.status?.message?.zh_tw ?? '重發失敗', type: 'error' });
    }
  } finally {
    redispatching.value = false;
  }
};

/**
 * Wave 1A：列表「📤 發布需求單」按鈕點擊流程（不開 modal）。
 * 二次確認 → call DispatchOrder → toast + 重載列表。
 */
const ClickDispatchFromRow = async (order: AdminOrder) => {
  if (IsRowDispatching(order.orderId)) return;
  if (order.orderStatus !== 'pending') {
    ElMessage({ message: '訂單狀態非待確認，無法發出需求單', type: 'warning' });
    return;
  }
  if (order.dispatchAt) {
    ElMessage({ message: '訂單已派發', type: 'warning' });
    return;
  }
  // 強制必選 runtime guard：button disabled 已守過一道，這裡是 defense-in-depth
  const level = RowStartLevelOf(order);
  if (!IsValidStartLevel(level)) {
    ElMessage({ message: tI18n('admin.orders.startLevel.requiredHint'), type: 'warning' });
    return;
  }
  const startLevel: DispatchLevel = level;
  const orderShort = order.orderId.slice(0, 8).toUpperCase();
  const ok = await UseAsk().Any(
    tI18n('admin.orders.dispatchConfirmMessage', { orderShort }),
    tI18n('admin.orders.dispatchConfirmTitle'),
    tI18n('admin.orders.cancelBtn'),
    tI18n('admin.orders.dispatchConfirmOk'),
  );
  if (!ok) return;

  // immutable 替換 Set 以觸發 reactivity
  rowDispatchingIds.value = new Set([...rowDispatchingIds.value, order.orderId]);
  try {
    // Wave 2B+2C 強制必選版：已 guard，startLevel 必為 DispatchLevel
    const res = await $api.DispatchOrder(order.orderId, { startLevel });
    if (res.status.code === 200) {
      ElMessage({ message: tI18n('admin.orders.dispatchSuccess'), type: 'success' });
      await ApiLoadOrders();
    } else {
      ElMessage({
        message: res.status?.message?.zh_tw ?? tI18n('admin.orders.dispatchFailed'),
        type: 'error',
      });
    }
  } finally {
    const next = new Set(rowDispatchingIds.value);
    next.delete(order.orderId);
    rowDispatchingIds.value = next;
  }
};

/**
 * Wave 1A：列表「🔁 重新發佈」按鈕點擊流程（不開 modal）。
 * 二次確認（顯示已發送 N 次）→ call RedispatchOrder → toast + 重載列表。
 */
const ClickRedispatchFromRow = async (order: AdminOrder) => {
  if (IsRowDispatching(order.orderId)) return;
  if (order.orderStatus !== 'pending') {
    ElMessage({ message: '訂單狀態非待確認，無法重發', type: 'warning' });
    return;
  }
  if (!order.dispatchAt) {
    ElMessage({ message: '訂單尚未首次派發，請改點「發布需求單」', type: 'warning' });
    return;
  }
  if (order.assignedDriverId) {
    ElMessage({ message: '訂單已指派司機，無法重發', type: 'warning' });
    return;
  }
  const orderShort = order.orderId.slice(0, 8).toUpperCase();
  const sentCount = DispatchAttemptCount(order);
  const ok = await UseAsk().Any(
    tI18n('admin.orders.redispatchConfirmMessage', { orderShort, count: sentCount }),
    tI18n('admin.orders.redispatchConfirmTitle'),
    tI18n('admin.orders.cancelBtn'),
    tI18n('admin.orders.redispatchConfirmOk'),
  );
  if (!ok) return;

  rowDispatchingIds.value = new Set([...rowDispatchingIds.value, order.orderId]);
  try {
    // Wave 2B+2C：列表重發若 admin 有改 row select 等級則 override，否則沿用既有 startLevel
    // 強制必選版：RowStartLevel 多了 '' 型別，IsValidStartLevel 過濾後才作為 override
    const rowLevel = rowStartLevels.value[order.orderId];
    const overrideLevel: DispatchLevel | undefined = IsValidStartLevel(rowLevel) ? rowLevel : undefined;
    const res = await $api.RedispatchOrder(
      order.orderId,
      overrideLevel !== undefined ? { startLevel: overrideLevel } : undefined,
    );
    if (res.status.code === 200 && res.data?.redispatched === true) {
      ElMessage({ message: tI18n('admin.orders.redispatchSuccess'), type: 'success' });
      await ApiLoadOrders();
    } else {
      ElMessage({
        message: res.status?.message?.zh_tw ?? tI18n('admin.orders.redispatchFailed'),
        type: 'error',
      });
    }
  } finally {
    const next = new Set(rowDispatchingIds.value);
    next.delete(order.orderId);
    rowDispatchingIds.value = next;
  }
};

// ── Wave 2D：admin 立即降級 / 全開放 ──────────────────────────────
/**
 * 列表 + Edit modal 兩處共用：per-row loading state（避免兩個列同時點按互相 disable）。
 * Set<orderId>；immutable 替換以觸發 reactivity。
 */
const rowDowngradingIds = ref<Set<string>>(new Set());
const IsRowDowngrading = (orderId: string) => rowDowngradingIds.value.has(orderId);

const CurrentDispatchLevel = (order: AdminOrder): DispatchLevel => {
  const v = order.dispatchVisibility?.currentLevel;
  if (v === '0' || v === '1' || v === '2') return v;
  return '0';
};

const CanDowngradeLevel = (order: AdminOrder): boolean => {
  if (order.orderStatus !== 'pending') return false;
  if (!order.dispatchAt) return false;
  if (order.assignedDriverId) return false;
  return CurrentDispatchLevel(order) !== '0';
};

const _AddDowngradingId = (orderId: string) => {
  rowDowngradingIds.value = new Set([...rowDowngradingIds.value, orderId]);
};
const _RemoveDowngradingId = (orderId: string) => {
  const next = new Set(rowDowngradingIds.value);
  next.delete(orderId);
  rowDowngradingIds.value = next;
};

const _NextDowngradeLevel = (current: DispatchLevel): DispatchLevel => {
  if (current === '2') return '1';
  if (current === '1') return '0';
  return '0';
};

/**
 * Wave 2D：立即降一級流程（currentLevel 2→1 或 1→0）。
 * 二次確認 → DowngradeDispatchLevel → toast + reload。
 */
const ClickDowngradeFlow = async (order: AdminOrder) => {
  if (!CanDowngradeLevel(order) || IsRowDowngrading(order.orderId)) return;
  const orderShort = order.orderId.slice(0, 8).toUpperCase();
  const cur = CurrentDispatchLevel(order);
  const next = _NextDowngradeLevel(cur);
  const ok = await UseAsk().Any(
    tI18n('admin.orders.downgradeConfirmMessage', { orderShort, currentLevel: cur, nextLevel: next }),
    tI18n('admin.orders.downgradeConfirmTitle'),
    tI18n('admin.orders.cancelBtn'),
    tI18n('admin.orders.downgradeConfirmOk'),
  );
  if (!ok) return;
  _AddDowngradingId(order.orderId);
  try {
    const res = await $api.DowngradeDispatchLevel(order.orderId);
    if (res.status.code === 200 && res.data) {
      ElMessage({
        message: tI18n('admin.orders.downgradeSuccess', { newLevel: res.data.newLevel }),
        type: 'success',
      });
      await ApiLoadOrders();
    } else {
      ElMessage({
        message: res.status?.message?.zh_tw ?? tI18n('admin.orders.downgradeFailed'),
        type: 'error',
      });
    }
  } finally {
    _RemoveDowngradingId(order.orderId);
  }
};

/**
 * Wave 2D：全開放流程（currentLevel='0'，全 approved driver 都看得到）。
 * 二次確認 → ForceOpenDispatchLevel → toast + reload。
 */
const ClickForceOpenFlow = async (order: AdminOrder) => {
  if (!CanDowngradeLevel(order) || IsRowDowngrading(order.orderId)) return;
  const orderShort = order.orderId.slice(0, 8).toUpperCase();
  const cur = CurrentDispatchLevel(order);
  const ok = await UseAsk().Any(
    tI18n('admin.orders.forceOpenConfirmMessage', { orderShort, currentLevel: cur }),
    tI18n('admin.orders.forceOpenConfirmTitle'),
    tI18n('admin.orders.cancelBtn'),
    tI18n('admin.orders.forceOpenConfirmOk'),
  );
  if (!ok) return;
  _AddDowngradingId(order.orderId);
  try {
    const res = await $api.ForceOpenDispatchLevel(order.orderId);
    if (res.status.code === 200) {
      ElMessage({ message: tI18n('admin.orders.forceOpenSuccess'), type: 'success' });
      await ApiLoadOrders();
    } else {
      ElMessage({
        message: res.status?.message?.zh_tw ?? tI18n('admin.orders.downgradeFailed'),
        type: 'error',
      });
    }
  } finally {
    _RemoveDowngradingId(order.orderId);
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

// ── Wave 1C：訂單偏好標籤後修 — 預覽 / 儲存 ───────────────────────────────
/** debounce 300ms 後 call ApiRecalcOrderPreview */
const ApiRecalcPreviewFlow = async () => {
  if (!selectedOrder.value) return;
  if (!hasTagChange.value) {
    recalcPreview.value = null;
    recalcError.value = null;
    return;
  }
  if (!canEditTags.value) {
    recalcError.value = tI18n('admin.orders.tagEdit.assignedLocked');
    recalcPreview.value = null;
    return;
  }
  recalcLoading.value = true;
  recalcError.value = null;
  try {
    const res = await $api.RecalcOrderPreview(selectedOrder.value.orderId, {
      tagIds: editTagIds.value,
    });
    if (res.status.code === 200 && res.data) {
      recalcPreview.value = res.data;
    } else {
      recalcPreview.value = null;
      recalcError.value = res.status?.message?.zh_tw ?? tI18n('admin.orders.tagEdit.previewFailed');
    }
  } catch (_err) {
    recalcPreview.value = null;
    recalcError.value = tI18n('admin.orders.tagEdit.previewFailed');
  } finally {
    recalcLoading.value = false;
  }
};

watch(editTagIds, () => {
  if (!isEditing.value) return;
  if (recalcDebounceTimer) clearTimeout(recalcDebounceTimer);
  recalcDebounceTimer = setTimeout(() => {
    void ApiRecalcPreviewFlow();
  }, 300);
}, { deep: true });

const RecalcWarningLabel = (w: OrderRecalcWarning): string => {
  if (w === 'discount_expired_fallback') return tI18n('admin.orders.tagEdit.discountExpiredWarning');
  return w;
};

const ClickSaveTagsFlow = async () => {
  if (!selectedOrder.value) return;
  if (savingTags.value) return;
  if (!hasTagChange.value) {
    ElMessage({ message: tI18n('admin.orders.tagEdit.noChange'), type: 'info' });
    return;
  }
  if (!canEditTags.value) {
    ElMessage({ message: tI18n('admin.orders.tagEdit.assignedLocked'), type: 'warning' });
    return;
  }
  // 二次確認（顯示差額）
  const diffStr = recalcPreview.value
    ? `${recalcPreview.value.diff.finalTotal > 0 ? '+' : ''}NT$ ${recalcPreview.value.diff.finalTotal.toLocaleString()}`
    : '—';
  const msg = tI18n('admin.orders.tagEdit.confirmMessage', { diff: diffStr });
  const ok = await UseAsk().Any(
    msg,
    tI18n('admin.orders.tagEdit.confirmTitle'),
    tI18n('admin.orders.cancelBtn'),
    tI18n('admin.orders.tagEdit.confirmOk'),
  );
  if (!ok) return;
  savingTags.value = true;
  try {
    const res = await $api.PatchOrder(selectedOrder.value.orderId, {
      preferences: { tagIds: editTagIds.value },
    } as unknown as PatchOrderParams);
    if (res.status.code === 200) {
      ElMessage({ message: tI18n('admin.orders.tagEdit.saveSuccess'), type: 'success' });
      ResetTagRecalcState();
      originalTagIds.value = [...editTagIds.value];
      await ApiLoadOrders();
    } else {
      ElMessage({
        message: res.status?.message?.zh_tw ?? tI18n('admin.orders.tagEdit.saveFailed'),
        type: 'error',
      });
    }
  } finally {
    savingTags.value = false;
  }
};

onMounted(() => {
  ApiLoadOrders();
  ApiLoadDrivers();
  ApiLoadPassengers();
});
</script>

<template lang="pug">
.PageAdminOrders(data-surface='dark')
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
    //- 縣市 / 行政區過濾（pickup OR dropoff toggle + 多選）
    UiCityFilter(
      v-model="cityFilter"
      :available-districts="availableDistricts"
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
        span 客人
        span 上車地址
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
          //- 折扣碼司機歸屬：乘客輸入了 driver-referral 折扣碼時顯示「來源：張司機」
          span.PageAdminOrders__referral-chip(
            v-if="ReferralDriverNameOf(o.referralDriverId)"
            :title="`折扣碼 ${o.discountCode} 歸屬此司機`"
          ) 來源：{{ ReferralDriverNameOf(o.referralDriverId) }}
        .PageAdminOrders__cell.is-type(data-label="行程")
          span.PageAdminOrders__type-badge {{ ORDER_TYPE_LABEL[o.orderType] ?? o.orderType }}
          //- 航班編號：接送機訂單才有，直接掛在行程類型下方（含航廈）
          span.PageAdminOrders__flight-chip(v-if="o.flightNumber")
            | ✈ {{ o.flightNumber }}{{ o.terminal ? ` · ${o.terminal}` : '' }}
        .PageAdminOrders__cell.is-time(data-label="用車時間") {{ $dayjs(o.pickupDateTime).format('MM/DD HH:mm') }}
        .PageAdminOrders__cell.is-passenger(data-label="客人")
          span.PageAdminOrders__passenger-name(v-if="o.passengerName") {{ o.passengerName }}
          span.PageAdminOrders__unassigned(v-else) —
        .PageAdminOrders__cell.is-pickup(data-label="上車地址")
          span.PageAdminOrders__pickup-region(v-if="RegionOf(o.pickupLocation)") {{ RegionOf(o.pickupLocation) }}
          span.PageAdminOrders__pickup-place {{ PlaceOf(o.pickupLocation) }}
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
        .PageAdminOrders__cell.is-action(data-label="操作")
          //- Wave 1A：列表派單入口（不刪 modal 內既有「📤 發出需求單」）
          //- Wave 2B+2C 強制必選版：select 含 placeholder option；未派發訂單未選等級時按鈕 disabled
          template(v-if="o.orderStatus === 'pending' && !o.assignedDriverId")
            .PageAdminOrders__row-dispatch-group
              select.PageAdminOrders__row-dispatch-level(
                :value="RowStartLevelOf(o)"
                :disabled="IsRowDispatching(o.orderId)"
                :title="$t('admin.orders.startLevel.label')"
                @change="(e) => SetRowStartLevel(o.orderId, ((e.target as HTMLSelectElement).value as RowStartLevel))"
                @click.stop
              )
                option(value="" disabled) {{ $t('admin.orders.startLevel.placeholder') }}
                option(v-for="opt in START_LEVEL_OPTIONS" :key="opt.value" :value="opt.value") {{ $t(opt.labelKey) }}
              //- 未派發 → 「📤 發布需求單」（強制必選：startLevel='' 時 disabled）
              button.PageAdminOrders__row-dispatch-btn(
                v-if="!o.dispatchAt"
                type="button"
                :disabled="IsRowDispatching(o.orderId) || !IsValidStartLevel(RowStartLevelOf(o))"
                :title="!IsValidStartLevel(RowStartLevelOf(o)) ? $t('admin.orders.startLevel.requiredHint') : $t('admin.orders.dispatch')"
                @click.stop="ClickDispatchFromRow(o)"
              ) {{ IsRowDispatching(o.orderId) ? '⏳' : '📤' }} {{ IsRowDispatching(o.orderId) ? $t('admin.orders.dispatching') : $t('admin.orders.dispatch') }}
              //- 已派發未指派 → 「🔁 重新發佈」+ dispatchCount > 0 時加 ×N chip（×N = 總派發次數）
              button.PageAdminOrders__row-dispatch-btn.is-redispatch(
                v-else
                type="button"
                :disabled="IsRowDispatching(o.orderId)"
                :title="$t('admin.orders.redispatch')"
                @click.stop="ClickRedispatchFromRow(o)"
              )
                span.PageAdminOrders__row-dispatch-label
                  | {{ IsRowDispatching(o.orderId) ? '⏳' : '🔁' }} {{ IsRowDispatching(o.orderId) ? $t('admin.orders.redispatching') : $t('admin.orders.redispatch') }}
                span.PageAdminOrders__row-dispatch-chip(v-if="(o.dispatchCount ?? 0) > 0") ×{{ DispatchAttemptCount(o) }}
              //- Wave 2D：立即降級 / 全開放（只在已派發未指派時顯示；currentLevel='0' 時 disabled）
              template(v-if="o.dispatchAt && !o.assignedDriverId")
                button.PageAdminOrders__row-dispatch-btn.is-downgrade(
                  type="button"
                  :disabled="!CanDowngradeLevel(o) || IsRowDowngrading(o.orderId)"
                  :title="$t('admin.orders.downgradeNow')"
                  @click.stop="ClickDowngradeFlow(o)"
                ) ⬇️ {{ $t('admin.orders.downgradeNow') }}
                button.PageAdminOrders__row-dispatch-btn.is-force-open(
                  type="button"
                  :disabled="!CanDowngradeLevel(o) || IsRowDowngrading(o.orderId)"
                  :title="$t('admin.orders.forceOpenAll')"
                  @click.stop="ClickForceOpenFlow(o)"
                ) 🔓 {{ $t('admin.orders.forceOpenAll') }}
          //- 已指派司機 → 不顯示按鈕，顯示「✓ 已指派」徽章
          span.PageAdminOrders__row-action-tag.is-assigned(
            v-else-if="o.assignedDriverId"
          ) ✓ {{ $t('admin.orders.assigned') }}
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

        //- 快速動作列（重發需求單）— 僅當 pending && 已派發 && 未指派時顯示
        //- Wave 2B+2C：在按鈕旁加首發等級 select（含「暫不發布」__draft__ 選項）
        //- Wave 2D：加「⬇️ 立即降級」/「🔓 全開放」按鈕（currentLevel='0' 時 disabled）
        .PageAdminOrders__quick-actions(
          v-if="!isEditing && selectedOrder.orderStatus === 'pending' && !!selectedOrder.dispatchAt && !selectedOrder.assignedDriverId"
        )
          select.PageAdminOrders__quick-level(
            v-model="modalStartLevel"
            :disabled="redispatching"
          )
            option(v-for="opt in START_LEVEL_OPTIONS" :key="opt.value" :value="opt.value") {{ $t(opt.labelKey) }}
            option(value="__draft__") {{ $t('admin.orders.startLevel.draft') }}
          //- 強制必選：重發場景 modalStartLevel 開啟時已預載既有等級，但保險起見 guard
          button.PageAdminOrders__quick-btn(
            :disabled="redispatching || !IsValidStartLevel(modalStartLevel)"
            :title="!IsValidStartLevel(modalStartLevel) ? $t('admin.orders.startLevel.requiredHint') : ''"
            type="button"
            @click="ClickRedispatch"
          ) {{ redispatching ? '重發中...' : '📤 重發需求單' }}
          button.PageAdminOrders__quick-btn.is-downgrade(
            :disabled="!CanDowngradeLevel(selectedOrder) || IsRowDowngrading(selectedOrder.orderId)"
            type="button"
            :title="!CanDowngradeLevel(selectedOrder) ? $t('admin.orders.downgradeAtLowest') : ''"
            @click="ClickDowngradeFlow(selectedOrder)"
          ) ⬇️ {{ $t('admin.orders.downgradeNow') }}
          button.PageAdminOrders__quick-btn.is-force-open(
            :disabled="!CanDowngradeLevel(selectedOrder) || IsRowDowngrading(selectedOrder.orderId)"
            type="button"
            :title="!CanDowngradeLevel(selectedOrder) ? $t('admin.orders.downgradeAtLowest') : ''"
            @click="ClickForceOpenFlow(selectedOrder)"
          ) 🔓 {{ $t('admin.orders.forceOpenAll') }}

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
              //- A2 醜點系統 Phase 1：醜點紅旗 / 拉黑徽章
              .PageAdminOrders__penalty-row(v-if="PassengerFlagOf(selectedOrder.userId)")
                template(v-if="PassengerFlagOf(selectedOrder.userId)!.blacklisted")
                  span.PageAdminOrders__penalty-badge.is-blacklist 🚫 已拉黑
                template(v-else-if="PassengerFlagOf(selectedOrder.userId)!.uglyCount > 0")
                  span.PageAdminOrders__penalty-badge.is-ugly ⚠ {{ PassengerFlagOf(selectedOrder.userId)!.uglyCount }} 醜
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 姓名
                span.PageAdminOrders__section-val {{ selectedOrder.passengerName || '—' }}
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 聯絡電話
                span.PageAdminOrders__section-val {{ selectedOrder.passengerPhone || '—' }}
              //- Booking v2 批次 2：顯示「大人 X / 兒童 Y」（child=0 退回「N 人」）
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 人數
                span.PageAdminOrders__section-val(v-if="(selectedOrder.childCount ?? 0) > 0")
                  | 大人 {{ selectedOrder.adultCount ?? 1 }} / 兒童 {{ selectedOrder.childCount }}
                span.PageAdminOrders__section-val(v-else) {{ selectedOrder.passengerCount }} 人
              .PageAdminOrders__section-row(v-if="selectedOrder.luggageItems?.length")
                span.PageAdminOrders__section-key 行李
                span.PageAdminOrders__section-val {{ LuggageSummary(selectedOrder.luggageItems) }}（{{ LuggageTotalSU(selectedOrder.luggageItems) }} SU）

            //- Phase 1E：訂單需求單 / 司機喊單 / 配對
            //- 三狀態：未派發 / 已派發等待 / 已派發喊單中（confirmed 後不顯示）
            .PageAdminOrders__section(v-if="selectedOrder.orderStatus === 'pending'")
              .PageAdminOrders__section-title 訂單需求單
              //- 未派發
              template(v-if="!selectedOrder.dispatchAt")
                .PageAdminOrders__dispatch-empty 尚未發出需求單。發出後系統會以 LINE 推播通知符合首發等級的司機；司機可於接單看板喊單，您再從喊單清單挑選。
                //- Wave 2B+2C 強制必選版：首發場景 select 預設 '' placeholder，admin 必選才能發布
                .PageAdminOrders__dispatch-level-row
                  label.PageAdminOrders__dispatch-level-label {{ $t('admin.orders.startLevel.label') }}
                  select.PageAdminOrders__dispatch-level-select(
                    v-model="modalStartLevel"
                    :disabled="dispatching"
                  )
                    option(value="" disabled) {{ $t('admin.orders.startLevel.placeholder') }}
                    option(v-for="opt in START_LEVEL_OPTIONS" :key="opt.value" :value="opt.value") {{ $t(opt.labelKey) }}
                    option(value="__draft__") {{ $t('admin.orders.startLevel.draft') }}
                button.PageAdminOrders__action.is-primary.is-block(
                  :disabled="dispatching || !IsValidStartLevel(modalStartLevel)"
                  :title="!IsValidStartLevel(modalStartLevel) ? $t('admin.orders.startLevel.requiredHint') : ''"
                  @click="ClickDispatch"
                ) {{ dispatching ? '發送中...' : '📤 發出需求單' }}
                .PageAdminOrders__dispatch-draft-hint(v-if="modalStartLevel === '__draft__'")
                  | {{ $t('admin.orders.startLevel.draftHint') }}
                .PageAdminOrders__dispatch-required-hint(v-else-if="modalStartLevel === ''")
                  | {{ $t('admin.orders.startLevel.requiredHint') }}
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
              //- 視窗 2：路段分析（fare-v2 訂單才會有 highwayKm/surfaceKm；舊單顯示 「—」）
              .PageAdminOrders__section-row(v-if="selectedOrder.highwayKm != null || selectedOrder.surfaceKm != null")
                span.PageAdminOrders__section-key 高速里程
                span.PageAdminOrders__section-val {{ selectedOrder.highwayKm != null ? `${selectedOrder.highwayKm.toFixed(1)} km` : '—' }}
              .PageAdminOrders__section-row(v-if="selectedOrder.highwayKm != null || selectedOrder.surfaceKm != null")
                span.PageAdminOrders__section-key 平面里程
                span.PageAdminOrders__section-val {{ selectedOrder.surfaceKm != null ? `${selectedOrder.surfaceKm.toFixed(1)} km` : '—' }}
              .PageAdminOrders__section-row(v-if="selectedOrder.surfaceSurcharge != null && selectedOrder.surfaceSurcharge > 0")
                span.PageAdminOrders__section-key 平面道路加成
                span.PageAdminOrders__section-val.is-fare +NT$ {{ selectedOrder.surfaceSurcharge.toLocaleString() }}

            //- Charter Fare V1 W5：包車 OT 對帳區（charter 訂單才顯示）
            //- 預估 / 實際 / 超時分鐘 / OT 段數 / OT 加收 / 司機應現場收取金額
            .PageAdminOrders__section(v-if="selectedOrder.charter")
              .PageAdminOrders__section-title 包車 OT 對帳
              .PageAdminOrders__section-row
                span.PageAdminOrders__section-key 預估結束
                span.PageAdminOrders__section-val {{ $dayjs(selectedOrder.charter.estimatedEndTime).format('YYYY/MM/DD HH:mm') }}
              //- 司機尚未結束
              .PageAdminOrders__section-row(v-if="!selectedOrder.charter.actualEndTime")
                span.PageAdminOrders__section-key 實際結束
                span.PageAdminOrders__section-val.is-muted 司機尚未結束行程
              //- 已結束 — 全套 OT 對帳
              template(v-else)
                .PageAdminOrders__section-row
                  span.PageAdminOrders__section-key 實際結束
                  span.PageAdminOrders__section-val {{ $dayjs(selectedOrder.charter.actualEndTime).format('YYYY/MM/DD HH:mm') }}
                .PageAdminOrders__section-row
                  span.PageAdminOrders__section-key 超時分鐘
                  span.PageAdminOrders__section-val {{ selectedOrder.charter.overtimeMinutes ?? 0 }} 分鐘
                .PageAdminOrders__section-row
                  span.PageAdminOrders__section-key OT 段數
                  span.PageAdminOrders__section-val {{ selectedOrder.charter.overtimeBlocks ?? 0 }} 段（每段 30 分）
                .PageAdminOrders__section-row
                  span.PageAdminOrders__section-key OT 加收
                  span.PageAdminOrders__section-val.is-fare +NT$ {{ (selectedOrder.charter.overtimeCharge ?? 0).toLocaleString() }}
                .PageAdminOrders__section-row.is-charter-collect
                  span.PageAdminOrders__section-key 司機應現場收取
                  span.PageAdminOrders__section-val.is-fare NT$ {{ CharterDriverCollectAmount(selectedOrder).toLocaleString() }}

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
              input.PageAdminOrders__edit-input(type="datetime-local" lang="en-GB" v-model="editForm.pickupDateTime")

            //- 上車點（與乘客端同一顆 UiGooglePlaceInput：輸入即出 Google 建議選項）
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 上車點
              UiGooglePlaceInput(
                theme="dark"
                :model-value="AsPlaceInput(editForm.pickupLocation)"
                placeholder="搜尋上車地點"
                @update:model-value="editForm.pickupLocation = $event"
              )

            //- 停靠站（可拖曳 / ▲▼ 調整順序）
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 停靠站
              .PageAdminOrders__stopover-list
                .PageAdminOrders__stopover-item(
                  v-for="(_stop, i) in editForm.stopovers"
                  :key="i"
                  :class="{ 'is-dragging': stopoverDragIndex === i, 'is-drop-target': stopoverDragOverIndex === i && stopoverDragIndex !== i }"
                  draggable="true"
                  @dragstart="HandleStopoverDragStart(i, $event)"
                  @dragover="HandleStopoverDragOver(i, $event)"
                  @dragleave="HandleStopoverDragLeave(i)"
                  @drop="HandleStopoverDrop(i, $event)"
                  @dragend="HandleStopoverDragEnd"
                )
                  button.PageAdminOrders__stopover-handle(
                    type="button"
                    title="拖曳調整順序"
                    aria-label="拖曳調整順序"
                  )
                    NuxtIcon(name="mdi:drag-vertical")
                  .PageAdminOrders__stopover-num 停靠 {{ i + 1 }}
                  UiGooglePlaceInput(
                    theme="dark"
                    :model-value="AsPlaceInput(editForm.stopovers[i])"
                    placeholder="搜尋停靠地點"
                    @update:model-value="UpdateStopover(i, $event)"
                  )
                  .PageAdminOrders__stopover-move
                    button.PageAdminOrders__stopover-move-btn(
                      type="button"
                      title="上移"
                      :disabled="i === 0"
                      @click="ClickMoveStopover(i, -1)"
                    ) ▲
                    button.PageAdminOrders__stopover-move-btn(
                      type="button"
                      title="下移"
                      :disabled="i === editForm.stopovers.length - 1"
                      @click="ClickMoveStopover(i, 1)"
                    ) ▼
                  button.PageAdminOrders__stopover-remove(@click="ClickRemoveStopover(i)" type="button") ×
              button.PageAdminOrders__stopover-add(@click="ClickAddStopover" type="button") + 新增停靠站

            //- 下車點
            .PageAdminOrders__edit-field
              label.PageAdminOrders__edit-label 下車點
              UiGooglePlaceInput(
                theme="dark"
                :model-value="AsPlaceInput(editForm.dropoffLocation)"
                placeholder="搜尋下車地點"
                @update:model-value="editForm.dropoffLocation = $event"
              )

            //- 車型 / 人數 / 行李（同列 grid）
            .PageAdminOrders__edit-grid
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 車型
                select.PageAdminOrders__edit-input(v-model="editForm.vehicleType")
                  option(v-for="opt in VEHICLE_OPTIONS" :key="opt.value" :value="opt.value") {{ opt.label }}
                  option(v-if="editForm.vehicleType && !VEHICLE_OPTIONS.find(o => o.value === editForm.vehicleType)" :value="editForm.vehicleType") {{ editForm.vehicleType }}（已停用或刪除）
              //- Booking v2 批次 2：拆大人 / 兒童
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 大人
                input.PageAdminOrders__edit-input(
                  type="number" v-model.number="editForm.adultCount"
                  inputmode="numeric" min="1" max="20"
                )
              .PageAdminOrders__edit-field
                label.PageAdminOrders__edit-label 兒童
                input.PageAdminOrders__edit-input(
                  type="number" v-model.number="editForm.childCount"
                  inputmode="numeric" min="0" max="20"
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

            //- Wave 1C：訂單偏好標籤後修（會觸發車資重算）
            .PageAdminOrders__edit-field.PageAdminOrders__tag-edit
              label.PageAdminOrders__edit-label
                | {{ $t('admin.orders.tagEdit.title') }}
                span.PageAdminOrders__tag-edit-hint(v-if="!canEditTags")
                  |   ({{ $t('admin.orders.tagEdit.assignedLocked') }})
              .PageAdminOrders__tag-edit-empty(v-if="tagsLoading") {{ $t('admin.orders.tagEdit.loadingTags') }}
              .PageAdminOrders__tag-edit-empty(v-else-if="vehicleTags.length === 0") {{ $t('admin.orders.tagEdit.noTags') }}
              BookingPassengerTagPreferencePicker(
                v-else
                :tags="vehicleTags"
                v-model="editTagIds"
                :disabled="!canEditTags || savingTags"
              )
              //- 差價預覽卡
              .PageAdminOrders__tag-edit-preview(v-if="hasTagChange")
                .PageAdminOrders__tag-edit-row(v-if="recalcLoading") {{ $t('admin.orders.tagEdit.previewing') }}
                .PageAdminOrders__tag-edit-row.is-error(v-else-if="recalcError") {{ recalcError }}
                template(v-else-if="recalcPreview")
                  .PageAdminOrders__tag-edit-row
                    span.PageAdminOrders__tag-edit-key {{ $t('admin.orders.tagEdit.priceBefore') }}
                    span.PageAdminOrders__tag-edit-val NT$ {{ recalcPreview.before.finalTotal.toLocaleString() }}
                  .PageAdminOrders__tag-edit-row
                    span.PageAdminOrders__tag-edit-key {{ $t('admin.orders.tagEdit.priceAfter') }}
                    span.PageAdminOrders__tag-edit-val NT$ {{ recalcPreview.after.finalTotal.toLocaleString() }}
                  .PageAdminOrders__tag-edit-row.is-diff(
                    :class="{ 'is-up': recalcPreview.diff.finalTotal > 0, 'is-down': recalcPreview.diff.finalTotal < 0 }"
                  )
                    span.PageAdminOrders__tag-edit-key {{ $t('admin.orders.tagEdit.priceDiff') }}
                    span.PageAdminOrders__tag-edit-val
                      | {{ recalcPreview.diff.finalTotal > 0 ? '+' : '' }}NT$ {{ recalcPreview.diff.finalTotal.toLocaleString() }}
                  .PageAdminOrders__tag-edit-row.is-warning(
                    v-for="w in recalcPreview.warnings"
                    :key="w"
                  ) ⚠️ {{ RecalcWarningLabel(w) }}
              //- 套用按鈕
              .PageAdminOrders__tag-edit-actions(v-if="hasTagChange")
                button.PageAdminOrders__action.is-primary(
                  type="button"
                  :disabled="savingTags || !canEditTags || recalcLoading"
                  @click="ClickSaveTagsFlow"
                ) {{ savingTags ? $t('admin.orders.tagEdit.saving') : $t('admin.orders.tagEdit.confirmOk') }}

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
            //- A2 醜點系統 Phase 1：admin 手動標記乘客未到（+2 醜）
            button.PageAdminOrders__action.is-warn(
              v-if="canMarkNoShow"
              @click="ClickOpenNoShow"
            ) 標記 no-show
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

  //- A2 醜點系統 Phase 1：標記 no-show sub-modal
  .PageAdminOrders__sub-mask(v-if="noShowDialog.open" @click.self="ClickCloseNoShow")
    .PageAdminOrders__sub-modal
      .PageAdminOrders__sub-title 標記 no-show
      .PageAdminOrders__sub-body
        label.PageAdminOrders__edit-label 備註原因（選填）
        textarea.PageAdminOrders__edit-textarea(
          v-model="noShowDialog.reason"
          rows="3"
          maxlength="200"
          placeholder="例：司機到場等候 15 分鐘乘客未出現..."
        )
        p.PageAdminOrders__sub-hint.is-warn ⚠️ 標記後：訂單會被取消、乘客自動 +2 醜（達 2 醜推警告、達 3 醜推暫停）；admin 仍需手動拉黑暫停服務。
      .PageAdminOrders__sub-actions
        button.PageAdminOrders__action.is-secondary(
          @click="ClickCloseNoShow"
          :disabled="noShowDialog.marking"
        ) 返回
        button.PageAdminOrders__action.is-warn(
          :disabled="noShowDialog.marking"
          @click="ApiMarkNoShow"
        ) {{ noShowDialog.marking ? '處理中...' : '確認標記 no-show' }}

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

.PageAdminOrders {
  padding: 80px 20px 100px;
  min-height: 100svh;
  background: var(--ink);
  color: var(--surface-raised);
}

.PageAdminOrders__header {
  margin-bottom: 24px;

  &-label {
    font-family: var(--ff-label);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: var(--accent);
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    &::before { content: ''; width: 20px; height: 1.5px; background: var(--accent); }
  }

  &-title {
    font-family: var(--ff-display);
    font-size: 36px;
    letter-spacing: 0.04em;
    color: var(--surface-raised);
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
  font-family: var(--ff-label);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--surface-a06);
  background: var(--surface-a06);
  color: var(--surface-a30);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &.is-active {
    border-color: var(--accent-a50);
    background: var(--accent-a12);
    color: var(--accent);
  }
}

.PageAdminOrders__count {
  font-family: var(--ff-label);
  font-size: 11px;
  color: var(--surface-a30);
}

.PageAdminOrders__create-btn {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 16px;
  border-radius: var(--r-pill);
  border: 1px solid var(--accent-a50);
  background: var(--accent-a12);
  color: var(--accent);
  cursor: pointer;
  margin-left: auto;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover { background: var(--accent-a20); }
}

.PageAdminOrders__loading {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.PageAdminOrders__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--accent-a20);
  border-top-color: var(--accent);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

.PageAdminOrders__empty {
  text-align: center;
  padding: 60px 0;
  font-family: var(--ff-ui);
  font-size: 14px;
  color: var(--surface-a30);
}

.PageAdminOrders__table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-x: auto;
}

.PageAdminOrders__row {
  display: grid;
  // Wave 1A：擴大 action column 容納「📤 發布需求單」/ 「🔁 重新發佈 ×N」按鈕
  // Wave 2D FU：action column 改 minmax + flex-wrap，容納等級 select + 主按鈕 + 立即降級/全開放
  // 客人 / 上車地址欄位加入後 column 數 8 → 10，整列加寬並靠 table overflow-x 橫向捲動
  grid-template-columns:
    110px 104px 108px 96px minmax(190px, 1.3fr)
    88px 72px 92px 92px minmax(250px, 1fr);
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--r-md);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  min-width: 1280px;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);

  &.is-clickable {
    cursor: pointer;

    &:hover {
      background: var(--surface-a06);
      border-color: var(--accent-a20);
    }
  }

  &.is-head {
    background: transparent;
    border-color: transparent;
    padding-bottom: 4px;
    cursor: default;

    span {
      font-family: var(--ff-label);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: var(--surface-a30);
      text-transform: uppercase;
    }
  }
}

.PageAdminOrders__cell {
  font-family: var(--ff-label);
  font-size: 15px;
  color: var(--surface-a82);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.is-time { color: var(--surface-a82); font-weight: 700; }
  &.is-fare { font-weight: 700; color: var(--accent); }
  // 行程類型 / 客人 / 上車地址：可能兩段資訊疊行顯示
  &.is-type,
  &.is-passenger,
  &.is-pickup {
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: flex-start;
  }
}

.PageAdminOrders__passenger-name {
  font-family: var(--ff-ui);
  font-size: 15px;
  font-weight: 500;
  color: var(--surface-raised);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PageAdminOrders__pickup-region {
  font-family: var(--ff-ui);
  font-size: 12px;
  color: var(--surface-a30);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PageAdminOrders__pickup-place {
  font-family: var(--ff-ui);
  font-size: 15px;
  color: var(--surface-a96);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PageAdminOrders__flight-chip {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--note-a15);
  border: 1px solid var(--note-a30);
  color: var(--note);
  white-space: nowrap;
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
      'id        status'
      'time      time'
      'pickup    pickup'
      'passenger fare'
      'driver    vehicle'
      'type      type'
      'action    action';
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
    font-size: 15px;
  }

  .PageAdminOrders__cell::before {
    content: attr(data-label);
    font-family: var(--ff-label);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--surface-a30);
  }

  .PageAdminOrders__cell.is-id { grid-area: id; }
  .PageAdminOrders__order-id { font-size: 14px; color: var(--surface-raised); font-weight: 700; }

  .PageAdminOrders__cell.is-status { grid-area: status; align-items: flex-end; }

  .PageAdminOrders__cell.is-time {
    grid-area: time;
    font-size: 16px;
    color: var(--surface-raised);
    font-weight: 700;
    padding: 8px 0;
    border-top: 1px solid var(--surface-a06);
    border-bottom: 1px solid var(--surface-a06);
  }
  .PageAdminOrders__cell.is-time::before { color: var(--surface-a30); }

  .PageAdminOrders__cell.is-driver { grid-area: driver; }
  .PageAdminOrders__cell.is-fare { grid-area: fare; align-items: flex-end; font-size: 17px; }
  .PageAdminOrders__cell.is-type { grid-area: type; flex-direction: row; align-items: center; flex-wrap: wrap; gap: 6px; }
  .PageAdminOrders__cell.is-type::before { flex-basis: 100%; }
  .PageAdminOrders__cell.is-vehicle { grid-area: vehicle; align-items: flex-end; }
  .PageAdminOrders__cell.is-passenger { grid-area: passenger; }
  .PageAdminOrders__cell.is-pickup {
    grid-area: pickup;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--surface-a06);
  }
  .PageAdminOrders__pickup-place { white-space: normal; }

  // Wave 1A：手機版讓 action 跨兩欄獨佔一行（含發布 / 重發按鈕），chevron 仍隱藏
  .PageAdminOrders__cell.is-action {
    display: flex;
    flex-direction: row;
    align-items: center;
    grid-area: action;
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--surface-a06);
  }

  .PageAdminOrders__cell.is-action::before { display: none; }
}

@media (max-width: 479.98px) {
  .PageAdminOrders__row { padding: 12px; }
  .PageAdminOrders__cell.is-time { font-size: 15px; }
}

.PageAdminOrders__order-id {
  font-size: 14px;
  font-weight: 700;
  color: var(--surface-a72);
  letter-spacing: 0.05em;
}

.PageAdminOrders__referral-chip {
  display: inline-block;
  margin-top: 4px;
  font-family: var(--ff-ui);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--wait);
  background: var(--wait-a15);
  border: 1px solid var(--wait-a30);
  border-radius: var(--r-pill);
  padding: 2px 8px;
  cursor: help;
}

.PageAdminOrders__type-badge {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent);
}

.PageAdminOrders__unassigned {
  color: var(--surface-a30);
  font-size: 13px;
}

.PageAdminOrders__status {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 9px;
  border-radius: var(--r-pill);

  &.is-pending   { background: var(--wait-a15); border: 1px solid var(--wait-a30); color: var(--wait); }
  &.is-confirmed { background: var(--note-a08); border: 1px solid var(--note-a30); color: var(--note); }
  &.is-progress  { background: var(--accent-a12); border: 1px solid var(--accent-a30); color: var(--accent); }
  &.is-done      { background: var(--good-a08); border: 1px solid var(--good-a30); color: var(--good); }
  &.is-cancel    { background: var(--stop-a08); border: 1px solid var(--stop-a15); color: var(--stop); }
}

// Phase 1E：dispatch 狀態徽章（疊加在主狀態下方）
.PageAdminOrders__dispatch-badge {
  display: inline-block;
  margin-top: 4px;
  font-family: var(--ff-label);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: var(--r-pill);

  &.is-pending  { background: var(--stop-a08);  border: 1px solid var(--stop-a30);  color: var(--stop); }
  &.is-progress { background: var(--accent-a12);       border: 1px solid var(--accent-a30);         color: var(--accent); }
  // Phase 1F：重派次數徽章
  &.is-rematch  { background: var(--note-a15); border: 1px solid var(--note-a30); color: var(--note); margin-left: 4px; }
}

// Phase 1F：強制重新配對 + bidHistory
.PageAdminOrders__rematch-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.PageAdminOrders__rematch-hint {
  font-family: var(--ff-ui);
  font-size: 11px;
  color: var(--surface-a30);
  line-height: 1.5;
}

.PageAdminOrders__bid-history {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.PageAdminOrders__history-row {
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-sm);
  padding: 8px 12px;
  background: var(--surface-a06);
}

.PageAdminOrders__history-head {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--ff-label);
  font-size: 11px;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.PageAdminOrders__history-round {
  color: var(--accent);
  font-weight: 700;
}

.PageAdminOrders__history-reason {
  color: var(--surface-a30);
}

.PageAdminOrders__history-time {
  color: var(--surface-a30);
  margin-left: auto;
}

.PageAdminOrders__history-bids {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.PageAdminOrders__history-bid {
  font-family: var(--ff-ui);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  color: var(--surface-a82);

  &.is-withdrawn {
    text-decoration: line-through;
    opacity: 0.5;
  }
}

.PageAdminOrders__history-empty {
  font-family: var(--ff-ui);
  font-size: 11px;
  color: var(--surface-a30);
}

.PageAdminOrders__dispatch-empty {
  font-family: var(--ff-ui);
  font-size: 12px;
  color: var(--surface-a30);
  line-height: 1.6;
  margin-bottom: 8px;
}

.PageAdminOrders__dispatch-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
  font-family: var(--ff-label);
  font-size: 12px;
  color: var(--surface-a30);
}

.PageAdminOrders__dispatch-active {
  color: var(--accent);
  font-weight: 700;
}

.PageAdminOrders__bid-loading {
  font-family: var(--ff-label);
  font-size: 12px;
  color: var(--surface-a30);
  padding: 12px 0;
  text-align: center;
}

// ── Modal ──────────────────────────────────────────────────
.PageAdminOrders__modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--ink-a70);
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
  background: var(--surface-deep-2);
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.PageAdminOrders__modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--surface-a06);

  &-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
}

.PageAdminOrders__modal-type {
  font-family: var(--ff-label);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a30);
  color: var(--accent-lit);
}

.PageAdminOrders__modal-vehicle {
  font-family: var(--ff-label);
  font-size: 11px;
  font-weight: 700;
  color: var(--surface-a60);
  letter-spacing: 0.08em;
}

.PageAdminOrders__modal-status {
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: var(--r-pill);

  &.is-pending   { background: var(--wait-a15); border: 1px solid var(--wait-a30); color: var(--wait); }
  &.is-confirmed { background: var(--note-a08); border: 1px solid var(--note-a30); color: var(--note); }
  &.is-progress  { background: var(--accent-a12); border: 1px solid var(--accent-a30); color: var(--accent); }
  &.is-done      { background: var(--good-a08); border: 1px solid var(--good-a30); color: var(--good); }
  &.is-cancel    { background: var(--stop-a08); border: 1px solid var(--stop-a15); color: var(--stop); }
}

.PageAdminOrders__modal-close {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--surface-a06);
  color: var(--surface-a60);
  border-radius: var(--r-round);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);

  &:hover { background: var(--surface-a12); color: var(--surface-raised); }
}

.PageAdminOrders__modal-id {
  padding: 8px 20px 0;
  font-family: var(--ff-label);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--surface-a30);
}

.PageAdminOrders__quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 20px 0;
}

.PageAdminOrders__quick-btn {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 7px 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--accent-a30);
  background: var(--accent-a12);
  color: var(--accent-lit);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) { background: var(--accent-a20); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }

  // Wave 2D：立即降級（橘紅 — 警示性低於 force-open）
  &.is-downgrade {
    border-color: var(--wait-a45);
    background: var(--wait-a15);
    color: var(--wait);
    &:hover:not(:disabled) { background: var(--wait-a15); }
  }
  // Wave 2D：全開放（紅色警示，最強動作）
  &.is-force-open {
    border-color: var(--stop-a45);
    background: var(--stop-a15);
    color: var(--stop);
    &:hover:not(:disabled) { background: var(--stop-a15); }
  }
}

.PageAdminOrders__quick-level {
  font-family: var(--ff-label);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--surface-a12);
  background: var(--surface-a06);
  color: var(--surface-raised);

  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.PageAdminOrders__dispatch-level-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0 10px;
}

.PageAdminOrders__dispatch-level-label {
  font-family: var(--ff-label);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--surface-a30);
  text-transform: uppercase;
}

.PageAdminOrders__dispatch-level-select {
  flex: 1;
  font-family: var(--ff-label);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--surface-a12);
  background: var(--surface-a06);
  color: var(--surface-raised);

  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.PageAdminOrders__dispatch-draft-hint {
  font-family: var(--ff-ui);
  font-size: 12px;
  margin-top: 6px;
  color: var(--accent-lit);
}

// 強制必選版：未選首發等級時提示（紅色警示，比 draft-hint 更顯眼）
.PageAdminOrders__dispatch-required-hint {
  font-family: var(--ff-ui);
  font-size: 12px;
  margin-top: 6px;
  color: var(--stop);
}

.PageAdminOrders__row-dispatch-group {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
  align-items: center;
  gap: 4px;
}

.PageAdminOrders__row-dispatch-level {
  font-family: var(--ff-label);
  font-size: 11px;
  padding: 4px 6px;
  border-radius: var(--r-sm);
  border: 1px solid var(--surface-a12);
  background: var(--surface-a06);
  color: var(--surface-raised);

  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

// Native <select> dropdown 在 dark theme 下白底白字 fix
// Windows Chrome / Edge：<option> 的背景不繼承 <select>（瀏覽器強制白底），文字繼承 var(--surface-raised) → 看不見
// 修：option 自帶深色背景 + 對應文字色；disabled placeholder option 淡化
// 套用範圍：本頁所有 native <select>（首發等級 / 重發 / 編輯訂單 / 指派司機 / 取消原因）
select option {
  background: var(--ink);
  color: var(--surface-raised);
}
select option:disabled {
  color: var(--surface-a40);
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
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--surface-a30);
  margin-bottom: 8px;
}

.PageAdminOrders__section-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  font-family: var(--ff-ui);
  font-size: 13px;

  // Charter Fare V1 W5：司機應現場收取金額 — 整段高亮提示
  &.is-charter-collect {
    margin-top: 6px;
    padding: 10px 12px;
    border-radius: var(--r-sm);
    border: 1px solid var(--accent-a30);
    background: var(--accent-a06);
    font-size: 14px;

    .PageAdminOrders__section-key {
      color: var(--accent-lit);
      font-weight: 700;
      letter-spacing: 0.02em;
    }
  }
}

.PageAdminOrders__section-key { color: var(--surface-a40); }

.PageAdminOrders__section-val {
  color: var(--surface-raised);
  text-align: right;

  &.is-fare { color: var(--accent); font-weight: 700; }
  &.is-muted { color: var(--surface-a30); }
}

// A2 醜點系統 Phase 1：乘客紅旗 / 拉黑徽章
.PageAdminOrders__penalty-row {
  display: flex;
  gap: 8px;
  margin: 4px 0 8px;
}

.PageAdminOrders__penalty-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  font-family: var(--ff-ui);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;

  &.is-ugly {
    color: var(--accent-lit);
    background: var(--accent-a12);
    border: 1px solid var(--accent-a30);
  }

  &.is-blacklist {
    color: var(--stop);
    background: var(--stop-a15);
    border: 1px solid var(--stop-a45);
  }
}

.PageAdminOrders__notes {
  font-family: var(--ff-ui);
  font-size: 13px;
  line-height: 1.6;
  color: var(--surface-a72);
  white-space: pre-wrap;
  background: var(--surface-a06);
  border-radius: var(--r-md);
  padding: 10px 12px;
}

.PageAdminOrders__addr-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  margin-bottom: 6px;

  &.is-pickup .PageAdminOrders__addr-tag { background: var(--accent-a20); color: var(--accent); border-color: var(--accent-a30); }
  &.is-stop   .PageAdminOrders__addr-tag { background: var(--note-a15); color: var(--note); border-color: var(--note-a30); }
  &.is-dropoff .PageAdminOrders__addr-tag { background: var(--good-a08); color: var(--good); border-color: var(--good-a30); }
}

.PageAdminOrders__addr-tag {
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border-radius: var(--r-sm);
  border: 1px solid;
  flex-shrink: 0;
  white-space: nowrap;
}

.PageAdminOrders__addr-text { flex: 1; min-width: 0; }

.PageAdminOrders__addr-name {
  font-family: var(--ff-ui);
  font-size: 13px;
  color: var(--surface-raised);
  line-height: 1.4;
  word-break: break-word;
}

.PageAdminOrders__addr-full {
  font-family: var(--ff-ui);
  font-size: 11px;
  color: var(--surface-a30);
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
  font-family: var(--ff-ui);
  font-size: 11px;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  color: var(--accent-lit);
  border: 1px solid var(--accent-a20);
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
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--surface-a30);
}

.PageAdminOrders__edit-input,
.PageAdminOrders__edit-textarea {
  width: 100%;
  padding: 9px 11px;
  border-radius: var(--r-md);
  border: 1px solid var(--surface-a06);
  background: var(--surface-a06);
  color: var(--surface-raised);
  font-family: var(--ff-ui);
  font-size: 13px;
  outline: none;
  resize: none;
  box-sizing: border-box;
  transition: border-color var(--dur-fast) var(--ease-out);

  &::placeholder { color: var(--surface-a20); }
  &:focus { border-color: var(--accent-a40); }
}

.PageAdminOrders__edit-input[type="datetime-local"] {
  color-scheme: dark;
}

// select 原生 popup 在 Windows/部分瀏覽器下會吃 OS theme（白底白字）。
// 直接在 option 上設定 dark 配色強制覆寫
.PageAdminOrders__edit-input option {
  background: var(--surface-deep-2);
  color: var(--surface-raised);
}

.PageAdminOrders__stopover-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageAdminOrders__stopover-item {
  display: grid;
  grid-template-columns: 22px 60px 1fr 26px 32px;
  align-items: center;
  gap: 8px;
  border-radius: var(--r-md);
  transition: opacity var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);

  &.is-dragging { opacity: 0.45; }
  &.is-drop-target { box-shadow: 0 -2px 0 0 var(--note); }
}

.PageAdminOrders__stopover-handle {
  width: 22px;
  height: 32px;
  padding: 0;
  border: none;
  background: none;
  color: var(--surface-a30);
  font-size: 15px;
  line-height: 1;
  cursor: grab;
  transition: color var(--dur-fast) var(--ease-out);

  &:hover { color: var(--note); }
  &:active { cursor: grabbing; }
}

.PageAdminOrders__stopover-move {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.PageAdminOrders__stopover-move-btn {
  width: 26px;
  height: 15px;
  padding: 0;
  border: 1px solid var(--note-a30);
  background: var(--note-a08);
  color: var(--note);
  border-radius: var(--r-xs);
  font-size: 8px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) { background: var(--note-a15); }
  &:disabled { opacity: 0.25; cursor: not-allowed; }
}

.PageAdminOrders__stopover-num {
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--note);
  background: var(--note-a08);
  border: 1px solid var(--note-a30);
  padding: 4px 8px;
  border-radius: var(--r-sm);
  text-align: center;
}

.PageAdminOrders__stopover-remove {
  width: 32px;
  height: 32px;
  border: 1px solid var(--stop-a30);
  background: var(--stop-a08);
  color: var(--stop);
  border-radius: var(--r-sm);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);

  &:hover { background: var(--stop-a15); }
}

.PageAdminOrders__stopover-add {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 8px 12px;
  border-radius: var(--r-md);
  border: 1px dashed var(--note-a30);
  background: var(--note-a08);
  color: var(--note);
  cursor: pointer;
  margin-top: 6px;
  transition: background var(--dur-fast) var(--ease-out);

  &:hover { background: var(--note-a08); }
}

// 窄螢幕：地址輸入框獨佔第二行，避免與序號 / 排序鈕互相擠壓
@media (max-width: 479.98px) {
  .PageAdminOrders__stopover-item {
    grid-template-columns: 22px 1fr 26px 32px;
    grid-template-areas:
      'handle num   move remove'
      'input  input input input';
    gap: 6px 8px;
  }

  .PageAdminOrders__stopover-handle { grid-area: handle; }
  .PageAdminOrders__stopover-num { grid-area: num; justify-self: start; }
  .PageAdminOrders__stopover-item > .UiGooglePlaceInput { grid-area: input; }
  .PageAdminOrders__stopover-move { grid-area: move; }
  .PageAdminOrders__stopover-remove { grid-area: remove; }
}

.PageAdminOrders__extras-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.PageAdminOrders__extra-pick-btn {
  font-family: var(--ff-ui);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--surface-a06);
  background: var(--surface-a06);
  color: var(--surface-a60);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &.is-active {
    border-color: var(--accent-a50);
    background: var(--accent-a12);
    color: var(--accent-lit);
  }
}

// Wave 1C：訂單後修偏好標籤 + 差價預覽卡
.PageAdminOrders__tag-edit { gap: 10px; }

.PageAdminOrders__tag-edit-hint {
  font-size: 11px;
  color: var(--wait);
  font-weight: 400;
  margin-left: 6px;
}

.PageAdminOrders__tag-edit-empty {
  font-size: 12px;
  color: var(--surface-a40);
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--surface-a06);
}

.PageAdminOrders__tag-edit-preview {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--note-a08);
  border: 1px solid var(--note-a15);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PageAdminOrders__tag-edit-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--surface-a82);

  &.is-error { color: var(--stop); justify-content: flex-start; }

  &.is-warning {
    color: var(--wait);
    font-size: 12px;
    justify-content: flex-start;
  }

  &.is-diff {
    font-weight: 700;
    padding-top: 4px;
    border-top: 1px dashed var(--surface-a12);
    margin-top: 2px;
  }

  &.is-up .PageAdminOrders__tag-edit-val { color: var(--stop); }
  &.is-down .PageAdminOrders__tag-edit-val { color: var(--good); }
}

.PageAdminOrders__tag-edit-key {
  font-family: var(--ff-label);
  letter-spacing: 0.06em;
  color: var(--surface-a60);
}

.PageAdminOrders__tag-edit-val {
  font-variant-numeric: tabular-nums;
}

.PageAdminOrders__tag-edit-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

// ── Modal Footer ──────────────────────────────────────────
.PageAdminOrders__modal-foot {
  padding: 14px 20px;
  border-top: 1px solid var(--surface-a06);
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  background: var(--ink-a20);
}

.PageAdminOrders__action {
  font-family: var(--ff-label);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 10px 18px;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
  white-space: nowrap;

  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.is-primary {
    background: var(--accent);
    color: var(--surface-raised);
    &:hover:not(:disabled) { background: var(--accent-deep); }
  }

  &.is-secondary {
    background: var(--surface-a06);
    color: var(--surface-a72);
    border-color: var(--surface-a06);
    &:hover:not(:disabled) { background: var(--surface-a06); }
  }

  &.is-danger {
    background: var(--stop-a08);
    color: var(--stop);
    border-color: var(--stop-a30);
    &:hover:not(:disabled) { background: var(--stop-a15); }
  }

  // Phase 1F：warn 變體（強制重新配對等需謹慎但非破壞性的動作）
  &.is-warn {
    background: var(--wait-a08);
    color: var(--wait);
    border-color: var(--wait-a30);
    &:hover:not(:disabled) { background: var(--wait-a15); }
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
  color: var(--surface-a20);
  text-align: center;
  display: block;
  line-height: 1;
  margin-left: auto;
}

@media (max-width: 767.98px) {
  .PageAdminOrders__row-chevron { display: none; }
}

// ── Wave 1A：列表派單按鈕（發布 / 重發） ──────────────────────
.PageAdminOrders__cell.is-action {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  overflow: visible;
  white-space: normal;
  min-width: 0;
}

.PageAdminOrders__row-dispatch-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--ff-label);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 5px 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--accent-a40);
  background: var(--accent-a12);
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) {
    background: var(--accent-a20);
    border-color: var(--accent-a60);
  }
  &:active:not(:disabled) { transform: scale(0.97); }
  &:disabled { opacity: 0.55; cursor: not-allowed; }

  // 重發按鈕用藍紫系區分（避免 admin 看混首發/重發）
  &.is-redispatch {
    border-color: var(--note-a45);
    background: var(--note-a15);
    color: var(--note);

    &:hover:not(:disabled) {
      background: var(--note-a15);
      border-color: var(--note-a70);
    }
  }

  // Wave 2D：立即降級（橘紅色，警示性低於 force-open）
  &.is-downgrade {
    border-color: var(--wait-a45);
    background: var(--wait-a15);
    color: var(--wait);

    &:hover:not(:disabled) {
      background: var(--wait-a15);
      border-color: var(--wait-a70);
    }
  }

  // Wave 2D：全開放（紅色警示，最強動作）
  &.is-force-open {
    border-color: var(--stop-a45);
    background: var(--stop-a15);
    color: var(--stop);

    &:hover:not(:disabled) {
      background: var(--stop-a15);
      border-color: var(--stop-a70);
    }
  }
}

.PageAdminOrders__row-dispatch-label { display: inline-flex; align-items: center; gap: 4px; }

.PageAdminOrders__row-dispatch-chip {
  display: inline-flex;
  align-items: center;
  font-family: var(--ff-label);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 1px 6px;
  border-radius: var(--r-pill);
  background: var(--surface-a06);
  border: 1px solid var(--surface-a12);
  color: var(--surface-a82);
}

.PageAdminOrders__row-action-tag {
  display: inline-flex;
  align-items: center;
  font-family: var(--ff-label);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 5px 10px;
  border-radius: var(--r-pill);
  white-space: nowrap;

  &.is-assigned {
    background: var(--good-a08);
    border: 1px solid var(--good-a30);
    color: var(--good);
  }
}

// ── modal 內司機列 ─────────────────────────────────────────
.PageAdminOrders__driver-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-md);
}

.PageAdminOrders__driver-info { flex: 1; min-width: 0; }

.PageAdminOrders__driver-name {
  font-family: var(--ff-ui);
  font-size: 14px;
  color: var(--surface-raised);
  font-weight: 700;

  &.is-muted { color: var(--surface-a30); font-weight: 400; }
}

.PageAdminOrders__driver-assign-btn {
  font-family: var(--ff-label);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 6px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--accent-a40);
  background: var(--accent-a12);
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover { background: var(--accent-a20); }
}

// ── 字數提示 ──────────────────────────────────────────────
.PageAdminOrders__char-count {
  font-family: var(--ff-label);
  font-size: 10px;
  color: var(--surface-a30);
  text-align: right;
  margin-top: 4px;
}

// ── sub-modal（指派 / 通知 / 取消 共用）────────────────────
.PageAdminOrders__sub-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal-2);
  background: var(--ink-a70);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.PageAdminOrders__sub-modal {
  background: var(--surface-deep-2);
  border: 1px solid var(--surface-a12);
  border-radius: var(--r-lg);
  padding: 22px;
  width: 100%;
  max-width: 380px;

  &.is-wide { max-width: 560px; }
}

.PageAdminOrders__sub-title {
  font-family: var(--ff-display);
  font-size: 22px;
  letter-spacing: 0.06em;
  color: var(--surface-raised);
  margin-bottom: 16px;
}

.PageAdminOrders__sub-subtitle {
  font-family: var(--ff-label);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--surface-a30);
  margin-left: 4px;
}

.PageAdminOrders__sub-body {
  margin-bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.PageAdminOrders__sub-hint {
  font-family: var(--ff-ui);
  font-size: 11px;
  color: var(--surface-a30);
  margin-top: 8px;
  line-height: 1.5;

  &.is-warn { color: var(--wait-a70); }
}

.PageAdminOrders__sub-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

// ── Transition ────────────────────────────────────────────
.fade-enter-active,
.fade-leave-active { transition: opacity var(--dur-base) var(--ease-out); }
.fade-enter-from,
.fade-leave-to { opacity: 0; }

@keyframes spin { to { transform: rotate(360deg); } }
</style>

<!--
  Unscoped style 專門處理 native <select> dropdown popup 白底白字。
  原因：Windows Chrome/Edge 把 <option> popup 當成 OS-level UI，scoped CSS 對部分
  v-for option 的 hash attribute 不一定生效；改用 unscoped + !important + 限制 root
  selector `.PageAdminOrders`，確保本頁 6 個 native select 內所有 option（含 placeholder
  / __draft__「暫不發布」/ START_LEVEL_OPTIONS / 駕駛清單 / orderType / cancelReason）
  都吃到深色背景 + 白字。
-->
<style lang="scss">
/* important-audit.md 的 A-1 清單原本就是這三行 —— 全站唯一「換色票也不會變」的深色面。
   !important 保留（要壓過瀏覽器對 <option> 的強制樣式），但值改走 token：
   深藍黑 #1a1a2e → 縞黑 var(--ink)。兩色極接近，肉眼幾乎分不出，
   但它從此會跟著色票走，A-1 清單也就清空了。
   custom property 由 <select> 繼承給 <option>，unscoped 也拿得到。 */
.PageAdminOrders select option {
  background: var(--ink) !important;
  color: var(--surface-raised) !important;
}
.PageAdminOrders select option:disabled {
  color: var(--surface-a40) !important;
}
</style>
