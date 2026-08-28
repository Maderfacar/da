<script setup lang="ts">
import { ORDER_TYPES } from '~shared/pricing';
import { formatPlaceName, formatRegion } from '~shared/location-label';
import { checkTimeGate, formatRemaining } from '~shared/trip-time-gate';

// P19：driver/trip 改為列表 + modal 詳情設計
// - 列表卡片只顯示日期 / 時間 / 訂單號 / 路線簡略 / 狀態徽章
// - 點卡片開 modal 顯示完整訂單資訊 + 四階段操作按鈕
// - 上下車 + 停靠站地址點擊可開 Google Maps 導航
// - 排序：pickupDateTime 升序（最早出發的在最上面）
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

const driverGeo = useDriverGeolocation();

interface ActionConfig {
  next: 'en_route' | 'arrived_pickup' | 'in_transit' | 'completed';
  label: string;
}

const ACTION_BY_STATUS: Record<string, ActionConfig> = {
  confirmed:       { next: 'en_route',       label: '前往上車點' },
  en_route:        { next: 'arrived_pickup', label: '已到達上車點' },
  arrived_pickup:  { next: 'in_transit',     label: '乘客已上車' },
  in_transit:      { next: 'completed',      label: '乘客已下車（完成）' },
};

const STATUS_LABEL: Record<string, string> = {
  confirmed:      '已接單',
  en_route:       '前往上車',
  arrived_pickup: '已到達上車點',
  in_transit:     '行程中',
};

const storeConfig = StoreConfig();
const ORDER_TYPE_LABEL = Object.fromEntries(ORDER_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;
// P23：fleet config 動態化 — 用 store getter 取代 hardcoded label map
const VEHICLE_LABEL = (id: string) => storeConfig.GetVehicle(id)?.label.zh ?? id;
const EXTRA_SERVICE_LABEL = (id: string) => storeConfig.GetExtra(id)?.label.zh ?? id;
const LuggageSummary = (items: Array<{ typeId: string; count: number }> | undefined) =>
  (items ?? []).map((i) => `${storeConfig.GetLuggageType(i.typeId)?.label.zh ?? i.typeId} × ${i.count}`).join('、') || '—';
const LuggageTotalSU = (items: Array<{ typeId: string; count: number }> | undefined) =>
  (items ?? []).reduce((sum, i) => sum + (storeConfig.GetLuggageType(i.typeId)?.su ?? 0) * i.count, 0);

// 列表卡片的地址：只顯示路名 / 地標名時看不出縣市 → 拆「縣市行政區」與「地點名稱」兩段顯示
const RegionOf = (loc: GooglePlace | undefined) => formatRegion(loc);
const PlaceOf = (loc: GooglePlace | undefined) => formatPlaceName(loc);

const orders = ref<AssignedOrder[]>([]);
const loading = ref(false);
const advancing = ref<string | null>(null);
const selectedOrder = ref<AssignedOrder | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Phase 3 時間 gate：modal 開啟時每 15 秒重算倒數
const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

// 當前 modal 內訂單若處於 arrived_pickup / in_transit，要看時間 gate
const advanceGate = computed(() => {
  const order = selectedOrder.value;
  if (!order) return { ok: true as const };
  const cfg = ACTION_BY_STATUS[order.orderStatus];
  if (!cfg) return { ok: true as const };
  // depend on nowTick to make this reactive
  const now = new Date(nowTick.value);
  return checkTimeGate({
    currentStatus: order.orderStatus,
    nextStatus: cfg.next,
    pickupDateTime: order.pickupDateTime,
    estimatedTimeMin: order.estimatedTime ?? null,
    now,
  });
});

const advanceCountdownLabel = computed(() => {
  const g = advanceGate.value;
  if (g.ok) return '';
  return `${formatRemaining(g.remainingMs)}後可執行`;
});

// Charter Fare V1 W5：包車訂單最後一段（in_transit → completed）按鈕文案改「結束包車任務」
// 非 charter 訂單沿用既有 ACTION_BY_STATUS label
const currentActionLabel = computed(() => {
  const order = selectedOrder.value;
  if (!order) return '';
  const cfg = ACTION_BY_STATUS[order.orderStatus];
  if (!cfg) return '無可用操作';
  if (order.orderType === 'charter' && cfg.next === 'completed') {
    return '結束包車任務';
  }
  return cfg.label;
});

// Wave 1 D1：Tab 切換 + 已完成歷史列表
type TripTab = 'active' | 'history';
const activeTab = ref<TripTab>('active');
const historyOrders = ref<DriverHistoryOrder[]>([]);
const historyLoading = ref(false);
const historyDateRange = ref<{ from: string | null; to: string | null }>({ from: null, to: null });

const HISTORY_STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  cancelled: '已取消',
};

const ApiLoadAssignedOrders = async () => {
  loading.value = true;
  try {
    const res = await $api.GetAssignedOrders();
    if (res.status.code === $enum.apiStatus.success && Array.isArray(res.data)) {
      orders.value = res.data as AssignedOrder[];
      // 若 modal 開著的訂單已不在列表（可能 completed / cancelled），同步關閉
      if (selectedOrder.value && !orders.value.find((o) => o.orderId === selectedOrder.value!.orderId)) {
        selectedOrder.value = null;
      } else if (selectedOrder.value) {
        // 若 status 已變更，更新 modal 內的 selectedOrder
        const fresh = orders.value.find((o) => o.orderId === selectedOrder.value!.orderId);
        if (fresh) selectedOrder.value = fresh;
      }
    } else {
      console.error('[driver/trip] load failed:', res.status.message);
      orders.value = [];
    }
  } finally {
    loading.value = false;
  }
};

// Wave 1 D1：載入歷史（completed / cancelled）— 由 historyDateRange 變更或切 tab 觸發
const ApiLoadHistory = async () => {
  historyLoading.value = true;
  try {
    const params: { from?: string; to?: string } = {};
    if (historyDateRange.value.from) params.from = historyDateRange.value.from;
    if (historyDateRange.value.to) params.to = historyDateRange.value.to;
    const res = await $api.GetDriverOrderHistory(params);
    if (res.status.code === $enum.apiStatus.success && Array.isArray(res.data)) {
      historyOrders.value = res.data as DriverHistoryOrder[];
    } else {
      historyOrders.value = [];
    }
  } finally {
    historyLoading.value = false;
  }
};

const ClickTab = (tab: TripTab) => {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  if (tab === 'history' && historyOrders.value.length === 0) ApiLoadHistory();
};

const ClickOpenDetail = (order: AssignedOrder) => {
  selectedOrder.value = order;
  // Phase 3：開 modal 時即時更新倒數（避免顯示舊的 tick）
  nowTick.value = Date.now();
};

const ClickCloseDetail = () => {
  selectedOrder.value = null;
};

// Wave 1 D2：4 個目標狀態按鈕按下時取得當下 GPS（不阻擋；fallback 到 watch 的最後一筆 currentPos）
// 寫入 schema：orders/{orderId}.statusHistoryLocations.{state} = { lat, lng, address, recordedAt }
const _GetFreshLocation = (): Promise<{ lat: number; lng: number } | null> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    let settled = false;
    const settle = (val: { lat: number; lng: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    // 8 秒上限：避免 GPS cold-start 卡住司機操作；timeout 時退到 watch 既有 currentPos
    const timer = setTimeout(() => {
      const fallback = driverGeo.currentPos.value;
      settle(fallback ? { lat: fallback.lat, lng: fallback.lng } : null);
    }, 8_000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        settle({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        const fallback = driverGeo.currentPos.value;
        settle(fallback ? { lat: fallback.lat, lng: fallback.lng } : null);
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 5_000 },
    );
  });
};

const ClickAdvance = async (order: AssignedOrder, skipPassengerNotify = false) => {
  if (advancing.value) return;
  const cfg = ACTION_BY_STATUS[order.orderStatus];
  if (!cfg) return;

  // Phase 3 前端 gate：太早不送出（避免 server 400 + 友善提示）
  const gate = checkTimeGate({
    currentStatus: order.orderStatus,
    nextStatus: cfg.next,
    pickupDateTime: order.pickupDateTime,
    estimatedTimeMin: order.estimatedTime ?? null,
    now: new Date(),
  });
  if (!gate.ok) {
    ElMessage({ message: `尚未到可執行時間（${formatRemaining(gate.remainingMs)}後可執行）`, type: 'warning' });
    return;
  }

  advancing.value = order.orderId;
  try {
    // P19：操作訂單時即時上傳當前座標（跳過 5m / 60s / accuracy 檢查）
    await driverGeo.UploadNow();

    // Wave 1 D2：取得當下 GPS（fresh）；拿不到就 null，server 端會跳過 statusHistoryLocations 寫入
    const driverLocation = await _GetFreshLocation();

    const patchBody: PatchOrderParams = { orderStatus: cfg.next };
    if (driverLocation) patchBody.driverLocation = driverLocation;
    // Charter Fare V1 W5：charter 訂單結束行程（in_transit → completed）帶上實際結束時間，
    // server 端會用 computeOvertimeBlocks 重算 overtimeMinutes/Blocks/Charge 寫回 charter block
    if (order.orderType === 'charter' && cfg.next === 'completed') {
      patchBody.actualEndTime = new Date().toISOString();
    }
    // 2026-05-29：司機按「已到達上車點（僅紀錄）」時帶 skipPassengerNotify=true，
    // server 端會跳過 order.en_route 推播但狀態切換 / GPS / war-room 狀態仍正常
    if (skipPassengerNotify) patchBody.skipPassengerNotify = true;

    const res = await $api.PatchOrder(order.orderId, patchBody);
    if (res.status.code === $enum.apiStatus.success) {
      const successMsg = skipPassengerNotify
        ? `已更新：${cfg.label}（未通知乘客）`
        : `已更新：${cfg.label}`;
      ElMessage({ message: successMsg, type: 'success' });
      // completed 後該訂單不再屬於 active 列表，關閉 modal
      if (cfg.next === 'completed') selectedOrder.value = null;
      await ApiLoadAssignedOrders();
    } else {
      ElMessage({ message: '狀態更新失敗，請重試', type: 'error' });
    }
  } catch (err) {
    console.error('[driver/trip] advance failed:', err);
    ElMessage({ message: '狀態更新失敗', type: 'error' });
  } finally {
    advancing.value = null;
  }
};

// Google Maps 導航 URL（指向 destination=lat,lng + label）
const _GmapsUrl = (loc: GooglePlace): string => {
  const label = encodeURIComponent(loc.displayName ?? loc.address ?? '');
  // 用 lat,lng 較精準；若有 placeId 也可用 query_place_id
  const dest = `${loc.lat},${loc.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&destination_place_id=${loc.placeId ?? ''}&travelmode=driving&q=${label}`;
};

const ClickOpenMaps = (loc: GooglePlace) => {
  const url = _GmapsUrl(loc);
  // _blank 並設 noopener；LIFF WebView 內會由系統開外部 Maps app（若安裝）
  window.open(url, '_blank', 'noopener,noreferrer');
};

const _OnVisibilityChange = () => {
  if (!document.hidden) ApiLoadAssignedOrders();
};

onMounted(() => {
  ApiLoadAssignedOrders();
  pollTimer = setInterval(ApiLoadAssignedOrders, 30_000);
  // Phase 3：每 15 秒 tick 一次讓倒數 label 重算（modal 開著時才視覺更新）
  tickTimer = setInterval(() => { nowTick.value = Date.now(); }, 15_000);
  document.addEventListener('visibilitychange', _OnVisibilityChange);
});

onUnmounted(() => {
  if (pollTimer !== null) clearInterval(pollTimer);
  if (tickTimer !== null) clearInterval(tickTimer);
  document.removeEventListener('visibilitychange', _OnVisibilityChange);
});
</script>

<template lang="pug">
.PageDriverTrip
  //- 頁首
  .PageDriverTrip__header
    .PageDriverTrip__header-label MISSION CONTROL
    h1.PageDriverTrip__header-title 我的任務
    p.PageDriverTrip__header-sub DRIVER OPERATIONS

  //- Wave 1 D1：Tab 切換（進行中 / 已完成）
  .PageDriverTrip__tabs
    button.PageDriverTrip__tab(
      type="button"
      :class="{ 'is-active': activeTab === 'active' }"
      @click="ClickTab('active')"
    ) 進行中
    button.PageDriverTrip__tab(
      type="button"
      :class="{ 'is-active': activeTab === 'history' }"
      @click="ClickTab('history')"
    ) 已完成

  //- 已完成 tab：日期過濾
  .PageDriverTrip__history-toolbar(v-if="activeTab === 'history'")
    UiDateRangeFilter(
      v-model="historyDateRange"
      mode="single"
      granularity="day"
      @change="ApiLoadHistory"
    )

  //- 進行中 tab
  template(v-if="activeTab === 'active'")
    //- Loading
    .PageDriverTrip__loading(v-if="loading && !orders.length")
      .PageDriverTrip__spinner

    //- 空狀態
    .PageDriverTrip__empty(v-else-if="!orders.length")
      .PageDriverTrip__empty-icon 📭
      p 目前沒有已指派的任務
      small 在「接單看板」喊單後，需管理員指派才會進入此列表

    //- 任務列表（簡略卡片）
    template(v-else)
      .PageDriverTrip__list
        .PageDriverTrip__card(
          v-for="order in orders"
          :key="order.orderId"
          @click="ClickOpenDetail(order)"
        )
          //- 日期時間
          .PageDriverTrip__card-time
            .PageDriverTrip__card-date {{ $dayjs(order.pickupDateTime).format('MM/DD') }}
            .PageDriverTrip__card-clock {{ $dayjs(order.pickupDateTime).format('HH:mm') }}
          //- 主資訊
          .PageDriverTrip__card-main
            .PageDriverTrip__card-row
              span.PageDriverTrip__type-badge {{ ORDER_TYPE_LABEL[order.orderType] ?? order.orderType }}
              span.PageDriverTrip__id \#{{ order.orderId.slice(-6).toUpperCase() }}
            .PageDriverTrip__card-route
              .PageDriverTrip__route-line
                span.PageDriverTrip__route-dot.is-from
                .PageDriverTrip__route-text
                  span.PageDriverTrip__route-region(v-if="RegionOf(order.pickupLocation)") {{ RegionOf(order.pickupLocation) }}
                  span.PageDriverTrip__route-place {{ PlaceOf(order.pickupLocation) }}
              .PageDriverTrip__route-line
                span.PageDriverTrip__route-dot.is-to
                .PageDriverTrip__route-text
                  span.PageDriverTrip__route-region(v-if="RegionOf(order.dropoffLocation)") {{ RegionOf(order.dropoffLocation) }}
                  span.PageDriverTrip__route-place {{ PlaceOf(order.dropoffLocation) }}
            .PageDriverTrip__card-foot
              span.PageDriverTrip__status-badge(:class="`is-${order.orderStatus}`") {{ STATUS_LABEL[order.orderStatus] }}
              //- Phase 1F：confirmation pending → 顯示等待乘客確認 chip
              span.PageDriverTrip__pending-chip(
                v-if="order.passengerConfirmationStatus === 'pending'"
              ) ⏳ 等待乘客確認
              span.PageDriverTrip__card-fare NT$ {{ order.estimatedFare.toLocaleString() }}

  //- 已完成 tab
  template(v-else)
    .PageDriverTrip__loading(v-if="historyLoading && !historyOrders.length")
      .PageDriverTrip__spinner
    .PageDriverTrip__empty(v-else-if="!historyOrders.length")
      .PageDriverTrip__empty-icon 📜
      p 沒有符合條件的歷史訂單
      small 試試清除日期或選擇其他日期
    .PageDriverTrip__list(v-else)
      .PageDriverTrip__card.is-history(
        v-for="o in historyOrders"
        :key="o.orderId"
      )
        .PageDriverTrip__card-time
          .PageDriverTrip__card-date {{ $dayjs(o.pickupDateTime).format('MM/DD') }}
          .PageDriverTrip__card-clock {{ $dayjs(o.pickupDateTime).format('HH:mm') }}
        .PageDriverTrip__card-main
          .PageDriverTrip__card-row
            span.PageDriverTrip__type-badge {{ ORDER_TYPE_LABEL[o.orderType] ?? o.orderType }}
            span.PageDriverTrip__id \#{{ o.orderId.slice(-6).toUpperCase() }}
          .PageDriverTrip__card-route
            .PageDriverTrip__route-line
              span.PageDriverTrip__route-dot.is-from
              .PageDriverTrip__route-text
                span.PageDriverTrip__route-region(v-if="RegionOf(o.pickupLocation)") {{ RegionOf(o.pickupLocation) }}
                span.PageDriverTrip__route-place {{ PlaceOf(o.pickupLocation) }}
            .PageDriverTrip__route-line
              span.PageDriverTrip__route-dot.is-to
              .PageDriverTrip__route-text
                span.PageDriverTrip__route-region(v-if="RegionOf(o.dropoffLocation)") {{ RegionOf(o.dropoffLocation) }}
                span.PageDriverTrip__route-place {{ PlaceOf(o.dropoffLocation) }}
          .PageDriverTrip__card-foot
            span.PageDriverTrip__history-badge(:class="`is-${o.orderStatus}`") {{ HISTORY_STATUS_LABEL[o.orderStatus] ?? o.orderStatus }}
            span.PageDriverTrip__card-fare NT$ {{ o.estimatedFare.toLocaleString() }}

  //- ── Modal 詳情 ──────────────────────────────────────
  Transition(name="fade")
    .PageDriverTrip__modal-mask(v-if="selectedOrder" @click.self="ClickCloseDetail")
      .PageDriverTrip__modal
        //- Modal Header
        .PageDriverTrip__modal-head
          .PageDriverTrip__modal-head-left
            span.PageDriverTrip__modal-type {{ ORDER_TYPE_LABEL[selectedOrder.orderType] ?? selectedOrder.orderType }}
            span.PageDriverTrip__modal-vehicle {{ VEHICLE_LABEL(selectedOrder.vehicleType) }}
          button.PageDriverTrip__modal-close(@click="ClickCloseDetail") ×

        .PageDriverTrip__modal-id \#{{ selectedOrder.orderId.toUpperCase() }}
        .PageDriverTrip__modal-status(:class="`is-${selectedOrder.orderStatus}`")
          | {{ STATUS_LABEL[selectedOrder.orderStatus] }}

        //- Phase 1F：confirmation pending banner（乘客尚未確認 Soft Match）
        .PageDriverTrip__pending-banner(
          v-if="selectedOrder.passengerConfirmationStatus === 'pending'"
        )
          .PageDriverTrip__pending-banner-icon ⏳
          .PageDriverTrip__pending-banner-body
            .PageDriverTrip__pending-banner-title 等待乘客確認
            .PageDriverTrip__pending-banner-desc 您與此訂單的偏好部分相符，乘客正在確認是否接受。如選擇「等下一輪」或「取消」，將另外通知您。

        //- Body：完整資訊
        .PageDriverTrip__modal-body
          //- Section 1：時間
          .PageDriverTrip__section
            .PageDriverTrip__section-title 用車時間
            .PageDriverTrip__section-val {{ $dayjs(selectedOrder.pickupDateTime).format('YYYY/MM/DD (ddd) HH:mm') }}

          //- Section 2：乘客
          .PageDriverTrip__section
            .PageDriverTrip__section-title 乘客資訊
            .PageDriverTrip__section-row
              span.PageDriverTrip__section-key 姓名
              span.PageDriverTrip__section-val {{ selectedOrder.passengerName || '—' }}
            .PageDriverTrip__section-row
              span.PageDriverTrip__section-key 聯絡電話
              span.PageDriverTrip__section-val(v-if="selectedOrder.passengerPhone") {{ selectedOrder.passengerPhone }}
              span.PageDriverTrip__section-val.is-muted(v-else) 請透過 LINE 聯絡
            //- Booking v2 批次 2：人數顯示「大人 X / 兒童 Y」（child=0 退回「N 人」）
            .PageDriverTrip__section-row
              span.PageDriverTrip__section-key 人數 / 行李
              span.PageDriverTrip__section-val(v-if="(selectedOrder.childCount ?? 0) > 0")
                | 大人 {{ selectedOrder.adultCount ?? 1 }} / 兒童 {{ selectedOrder.childCount }}
                |  / {{ LuggageSummary(selectedOrder.luggageItems) }}（{{ LuggageTotalSU(selectedOrder.luggageItems) }} SU）
              span.PageDriverTrip__section-val(v-else) {{ selectedOrder.passengerCount }} 人 / {{ LuggageSummary(selectedOrder.luggageItems) }}（{{ LuggageTotalSU(selectedOrder.luggageItems) }} SU）

          //- Section 3：路線（含 Google Maps 連結）
          .PageDriverTrip__section
            .PageDriverTrip__section-title 行程路線
            .PageDriverTrip__addr-card.is-pickup(@click="ClickOpenMaps(selectedOrder.pickupLocation)")
              .PageDriverTrip__addr-tag 上車
              .PageDriverTrip__addr-text
                .PageDriverTrip__addr-name {{ selectedOrder.pickupLocation.displayName || selectedOrder.pickupLocation.address }}
                .PageDriverTrip__addr-full(v-if="selectedOrder.pickupLocation.displayName") {{ selectedOrder.pickupLocation.address }}
              NuxtIcon.PageDriverTrip__addr-icon(name="mdi:google-maps")
            template(v-if="selectedOrder.stopovers && selectedOrder.stopovers.length")
              .PageDriverTrip__addr-card.is-stop(
                v-for="(stop, i) in selectedOrder.stopovers"
                :key="i"
                @click="ClickOpenMaps(stop)"
              )
                .PageDriverTrip__addr-tag 停靠 {{ i + 1 }}
                .PageDriverTrip__addr-text
                  .PageDriverTrip__addr-name {{ stop.displayName || stop.address }}
                  .PageDriverTrip__addr-full(v-if="stop.displayName") {{ stop.address }}
                NuxtIcon.PageDriverTrip__addr-icon(name="mdi:google-maps")
            .PageDriverTrip__addr-card.is-dropoff(@click="ClickOpenMaps(selectedOrder.dropoffLocation)")
              .PageDriverTrip__addr-tag 下車
              .PageDriverTrip__addr-text
                .PageDriverTrip__addr-name {{ selectedOrder.dropoffLocation.displayName || selectedOrder.dropoffLocation.address }}
                .PageDriverTrip__addr-full(v-if="selectedOrder.dropoffLocation.displayName") {{ selectedOrder.dropoffLocation.address }}
              NuxtIcon.PageDriverTrip__addr-icon(name="mdi:google-maps")

          //- Section 4：航班資訊（接送機才有）
          .PageDriverTrip__section(v-if="selectedOrder.flightNumber || selectedOrder.terminal")
            .PageDriverTrip__section-title 航班資訊
            .PageDriverTrip__section-row(v-if="selectedOrder.flightNumber")
              span.PageDriverTrip__section-key 航班編號
              span.PageDriverTrip__section-val {{ selectedOrder.flightNumber }}
            .PageDriverTrip__section-row(v-if="selectedOrder.terminal")
              span.PageDriverTrip__section-key 航廈
              span.PageDriverTrip__section-val {{ selectedOrder.terminal }}

          //- Section 5：額外服務
          .PageDriverTrip__section(v-if="selectedOrder.extraServices && selectedOrder.extraServices.length")
            .PageDriverTrip__section-title 額外服務
            .PageDriverTrip__extras
              span.PageDriverTrip__extra-tag(v-for="s in selectedOrder.extraServices" :key="s")
                | {{ EXTRA_SERVICE_LABEL(s) }}

          //- Section 6：備註
          .PageDriverTrip__section(v-if="selectedOrder.notes")
            .PageDriverTrip__section-title 備註
            .PageDriverTrip__notes {{ selectedOrder.notes }}

          //- Section 7：費用
          .PageDriverTrip__section
            .PageDriverTrip__section-title 費用 / 距離
            .PageDriverTrip__section-row
              span.PageDriverTrip__section-key 預估車資
              span.PageDriverTrip__section-val.is-fare NT$ {{ selectedOrder.estimatedFare.toLocaleString() }}
            .PageDriverTrip__section-row
              span.PageDriverTrip__section-key 距離
              span.PageDriverTrip__section-val {{ selectedOrder.distanceKm }} km
            .PageDriverTrip__section-row(v-if="selectedOrder.estimatedTime")
              span.PageDriverTrip__section-key 預估車程
              span.PageDriverTrip__section-val {{ selectedOrder.estimatedTime }} 分鐘

        //- Footer：四階段主操作按鈕
        //- 2026-05-29：en_route → arrived_pickup 拆兩個按鈕（通知乘客 / 僅紀錄），
        //- 對應「司機到點通知」可選擇是否推 LINE；其他狀態維持單一按鈕。
        //- Phase 3：客上 / 客下 兩階段加時間 gate；未到時 button disable + 顯示倒數
        .PageDriverTrip__modal-foot
          template(v-if="selectedOrder.orderStatus === 'en_route'")
            button.PageDriverTrip__action(
              :disabled="advancing === selectedOrder.orderId || !advanceGate.ok"
              @click="ClickAdvance(selectedOrder, false)"
            ) {{ advancing === selectedOrder.orderId ? '處理中...' : '已到達上車點（通知乘客）' }}
            button.PageDriverTrip__action.is-quiet(
              :disabled="advancing === selectedOrder.orderId || !advanceGate.ok"
              @click="ClickAdvance(selectedOrder, true)"
            ) {{ advancing === selectedOrder.orderId ? '處理中...' : '已到達上車點（僅紀錄）' }}
          template(v-else)
            button.PageDriverTrip__action(
              :disabled="advancing === selectedOrder.orderId || !advanceGate.ok"
              @click="ClickAdvance(selectedOrder)"
            ) {{ advancing === selectedOrder.orderId ? '處理中...' : currentActionLabel }}
          .PageDriverTrip__action-hint(v-if="!advanceGate.ok") {{ advanceCountdownLabel }}
</template>

<style lang="scss" scoped>

.PageDriverTrip {
  padding: 20px 16px 32px;
  min-height: 100vh;
  background: var(--da-dark);
  color: var(--surface-raised);
}

// ── 頁首 ──────────────────────────────────────────────
.PageDriverTrip__header { margin-bottom: 24px; }

.PageDriverTrip__header-label {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--accent);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  &::before { content: ''; width: 20px; height: 1.5px; background: var(--accent); }
}

.PageDriverTrip__header-title {
  font-family: var(--ff-display);
  font-size: var(--fs-h1);
  letter-spacing: var(--ls-label);
  color: var(--surface-raised);
  line-height: var(--lh-flat);
}

.PageDriverTrip__header-sub {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-kicker);
  color: var(--surface-a30);
  margin-top: 4px;
}

// ── Wave 1 D1：Tab 切換 + 歷史 toolbar ──────────────────
.PageDriverTrip__tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  padding: 4px;
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-md);
  width: fit-content;
}

.PageDriverTrip__tab {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 6px 16px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--surface-a40);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover { color: var(--surface-a72); }
  &.is-active { background: var(--accent-a20); color: var(--accent); }
}

.PageDriverTrip__history-toolbar {
  margin-bottom: 14px;
}

.PageDriverTrip__history-badge {
  display: inline-block;
  flex: none;
  white-space: nowrap;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 3px 9px;
  border-radius: var(--r-sm);

  &.is-completed { background: var(--good-a15); color: var(--good); border: 1px solid var(--good-a30); }
  &.is-cancelled { background: var(--stop-a15); color: var(--stop); border: 1px solid var(--stop-a30); }
}

.PageDriverTrip__card.is-history {
  cursor: default;
  &:hover { border-color: var(--surface-a06); }
  &:active { transform: none; background: var(--surface-a06); }
}

// ── Loading ──────────────────────────────────────────
.PageDriverTrip__loading { display: flex; justify-content: center; padding: 60px 0; }

.PageDriverTrip__spinner {
  width: 28px; height: 28px;
  border: 2px solid var(--accent-a20);
  border-top-color: var(--accent);
  border-radius: var(--r-round);
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 空狀態 ────────────────────────────────────────────
.PageDriverTrip__empty { text-align: center; padding: 60px 0; }
.PageDriverTrip__empty-icon { font-size: var(--fs-display); margin-bottom: 12px; }
.PageDriverTrip__empty p {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  color: var(--surface-a50);
}
.PageDriverTrip__empty small {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
  color: var(--surface-a20);
}

// ── 列表卡片（簡略）──────────────────────────────────────
.PageDriverTrip__list { display: flex; flex-direction: column; gap: 10px; }

.PageDriverTrip__card {
  display: flex;
  gap: 12px;
  padding: 14px 14px;
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-lg);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
  &:active { transform: scale(0.99); background: var(--surface-a06); }
  &:hover { border-color: var(--accent-a30); }
}

.PageDriverTrip__card-time {
  flex-shrink: 0;
  width: 74px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
  border-right: 1px dashed var(--surface-a12);
  padding-right: 12px;
}

// 日期與時間同字級（司機在車上快速掃視，日期不能比時間小）
.PageDriverTrip__card-date {
  font-family: var(--ff-data);
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-label);
  color: var(--surface-a60);
}

.PageDriverTrip__card-clock {
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h2);
  letter-spacing: var(--ls-label);
  color: var(--surface-raised);
  margin-top: 2px;
}

.PageDriverTrip__card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }

.PageDriverTrip__card-row { display: flex; align-items: center; gap: 8px; }

.PageDriverTrip__type-badge {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a30);
  color: var(--accent);
}

.PageDriverTrip__id {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  color: var(--surface-a20);
  margin-left: auto;
  letter-spacing: var(--ls-wide);
}

// 上 / 下車各佔一行：縣市行政區在前、地點名稱在後，避免橫排被截斷看不出地區
.PageDriverTrip__card-route {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--ff-ui);
  color: var(--surface-a72);
}

.PageDriverTrip__route-line {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.PageDriverTrip__route-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: var(--r-round);
  align-self: center;

  &.is-from { background: var(--accent); }
  &.is-to { background: var(--good); }
}

.PageDriverTrip__route-text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PageDriverTrip__route-region {
  flex-shrink: 0;
  font-size: var(--fs-label);
  font-weight: 500;
  color: var(--surface-a50);
}

.PageDriverTrip__route-place {
  min-width: 0;
  font-size: var(--fs-body-sm);
  color: var(--surface-a88);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PageDriverTrip__card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  // 車資換襯線放大後，窄螢幕上「狀態章 + 待確認 chip + 車資」三件會互相擠斷行。
  // 允許整列換行，並讓每個元件自己不斷字。
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.PageDriverTrip__status-badge {
  display: inline-block;
  flex: none;
  white-space: nowrap;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 3px 9px;
  border-radius: var(--r-sm);

  &.is-confirmed       { background: var(--good-a15); color: var(--good); border: 1px solid var(--good-a30); }
  &.is-en_route        { background: var(--note-a15); color: var(--note); border: 1px solid var(--note-a30); }
  &.is-arrived_pickup  { background: var(--wait-a15); color: var(--wait); border: 1px solid var(--wait-a30); }
  &.is-in_transit      { background: var(--accent-a12); color: var(--accent); border: 1px solid var(--accent-a40); }
}

// 提案規則一：金額放大，卡片上以車資為視覺落點（字族不換，見規則三）。
.PageDriverTrip__card-fare {
  flex: none;
  margin-left: auto;
  white-space: nowrap;
  font-family: var(--ff-data);
  font-variant-numeric: lining-nums tabular-nums;
  font-size: var(--fs-h4);
  font-weight: 500;
  line-height: var(--lh-flat);
  color: var(--accent);
  letter-spacing: var(--ls-tight);
}

// Phase 1F：confirmation pending chip + banner
.PageDriverTrip__pending-chip {
  display: inline-block;
  flex: none;
  white-space: nowrap;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--wait-a15);
  border: 1px solid var(--wait-a30);
  color: var(--wait);
}

.PageDriverTrip__pending-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 12px 16px 0;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--wait-a08);
  border: 1px solid var(--wait-a30);
}

.PageDriverTrip__pending-banner-icon {
  font-size: var(--fs-h4);
  line-height: var(--lh-flat);
}

.PageDriverTrip__pending-banner-body {
  flex: 1;
}

.PageDriverTrip__pending-banner-title {
  font-family: var(--ff-label);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  color: var(--wait);
  letter-spacing: var(--ls-label);
}

.PageDriverTrip__pending-banner-desc {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--surface-a60);
  line-height: var(--lh-normal);
  margin-top: 4px;
}

// ── Modal ────────────────────────────────────────────
.PageDriverTrip__modal-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--ink-a70);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;

  @media (min-width: 640px) {
    align-items: center;
    padding: 40px 20px;
  }
}

.PageDriverTrip__modal {
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  background: var(--surface-deep-2);
  border: 1px solid var(--accent-a20);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  @media (min-width: 640px) {
    border-radius: var(--r-xl);
    max-height: 80vh;
  }
}

.PageDriverTrip__modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 8px;
  flex-shrink: 0;
}

.PageDriverTrip__modal-head-left { display: flex; gap: 8px; }

.PageDriverTrip__modal-type {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 4px 12px;
  border-radius: var(--r-pill);
  background: var(--accent-a20);
  border: 1px solid var(--accent-a40);
  color: var(--accent);
}

.PageDriverTrip__modal-vehicle {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  background: var(--surface-a06);
  color: var(--surface-a60);
}

.PageDriverTrip__modal-close {
  width: 36px; height: 36px;
  border-radius: var(--r-round);
  border: none;
  background: var(--surface-a06);
  color: var(--surface-a60);
  font-size: var(--fs-h2);
  cursor: pointer;
  &:hover { background: var(--surface-a12); color: var(--surface-raised); }
}

.PageDriverTrip__modal-id {
  padding: 0 20px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
  color: var(--surface-a30);
}

.PageDriverTrip__modal-status {
  margin: 8px 20px 12px;
  display: inline-block;
  align-self: flex-start;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-caps);
  padding: 4px 12px;
  border-radius: var(--r-sm);
  width: fit-content;

  &.is-confirmed       { background: var(--good-a15); color: var(--good); border: 1px solid var(--good-a30); }
  &.is-en_route        { background: var(--note-a15); color: var(--note); border: 1px solid var(--note-a30); }
  &.is-arrived_pickup  { background: var(--wait-a15); color: var(--wait); border: 1px solid var(--wait-a30); }
  &.is-in_transit      { background: var(--accent-a12); color: var(--accent); border: 1px solid var(--accent-a40); }
}

.PageDriverTrip__modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px 20px;
}

// Section
.PageDriverTrip__section {
  padding: 14px 0;
  border-top: 1px solid var(--surface-a06);
  &:first-child { border-top: none; padding-top: 4px; }
}

.PageDriverTrip__section-title {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-kicker);
  color: var(--surface-a30);
  text-transform: uppercase;
  margin-bottom: 8px;
}

.PageDriverTrip__section-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  gap: 16px;
}

.PageDriverTrip__section-key {
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
  color: var(--surface-a40);
  flex-shrink: 0;
}

.PageDriverTrip__section-val {
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  color: var(--surface-a82);
  text-align: right;

  &.is-muted { color: var(--surface-a30); font-size: var(--fs-label); font-style: italic; }
  // 提案規則一：金額放大（字族不換，見規則三）
  &.is-fare {
    font-family: var(--ff-data);
    font-variant-numeric: lining-nums tabular-nums;
    font-weight: 500;
    color: var(--accent);
    font-size: var(--fs-h3);
    letter-spacing: var(--ls-tight);
  }
}

// 地址卡片（可點擊開 Google Maps）
.PageDriverTrip__addr-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 12px;
  margin-bottom: 8px;
  background: var(--surface-a06);
  border: 1px solid var(--surface-a06);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:hover { border-color: var(--accent-a40); background: var(--accent-a06); }
  &:active { transform: scale(0.99); }

  &.is-pickup .PageDriverTrip__addr-tag { background: var(--accent); color: var(--surface-raised); }
  &.is-stop .PageDriverTrip__addr-tag { background: var(--surface-a12); color: var(--surface-a60); }
  &.is-dropoff .PageDriverTrip__addr-tag { background: var(--good-a15); color: var(--good); border: 1px solid var(--good-a30); }
}

.PageDriverTrip__addr-tag {
  flex-shrink: 0;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 4px 8px;
  border-radius: var(--r-xs);
  margin-top: 2px;
}

.PageDriverTrip__addr-text { flex: 1; min-width: 0; }

.PageDriverTrip__addr-name {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--surface-a88);
  font-weight: 500;
  line-height: var(--lh-normal);
}

.PageDriverTrip__addr-full {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  color: var(--surface-a40);
  margin-top: 2px;
  line-height: var(--lh-normal);
}

.PageDriverTrip__addr-icon {
  flex-shrink: 0;
  font-size: var(--fs-h4);
  color: var(--accent);
  margin-top: 4px;
}

// 額外服務 tag list
.PageDriverTrip__extras {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.PageDriverTrip__extra-tag {
  font-family: var(--ff-ui);
  font-size: var(--fs-label);
  padding: 4px 10px;
  border-radius: var(--r-sm);
  background: var(--accent-a12);
  border: 1px solid var(--accent-a20);
  color: var(--accent-a90);
}

// 備註
.PageDriverTrip__notes {
  font-family: var(--ff-ui);
  font-size: var(--fs-body-sm);
  color: var(--surface-a72);
  line-height: var(--lh-relaxed);
  padding: 10px 12px;
  background: var(--surface-a06);
  border-radius: var(--r-sm);
  border: 1px solid var(--surface-a06);
}

// Modal footer
.PageDriverTrip__modal-foot {
  flex-shrink: 0;
  padding: 12px 20px 20px;
  background: linear-gradient(180deg, transparent 0, var(--ink-a40) 30%);
  border-top: 1px solid var(--surface-a06);
}

.PageDriverTrip__action {
  width: 100%;
  font-family: var(--ff-label);
  font-size: var(--fs-body);
  font-weight: 700;
  letter-spacing: var(--ls-wide);
  padding: 14px 20px;
  border-radius: var(--r-md);
  border: none;
  background: var(--accent);
  color: var(--surface-raised);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);

  &:disabled { opacity: 0.6; cursor: not-allowed; }
  &:active:not(:disabled) { transform: scale(0.98); }

  // 「僅紀錄」次按鈕：與主按鈕同寬，但低調配色（不發 LINE 給乘客）
  &.is-quiet {
    margin-top: 8px;
    background: var(--surface-a06);
    color: var(--surface-a82);
    border: 1px solid var(--surface-a20);
  }
}

// Phase 3：時間 gate 倒數提示（緊貼按鈕下方，置中）
.PageDriverTrip__action-hint {
  margin-top: 8px;
  font-family: var(--ff-label);
  font-size: var(--fs-label);
  letter-spacing: var(--ls-wide);
  color: var(--surface-a60);
  text-align: center;
}

// transition
.fade-enter-active, .fade-leave-active { transition: opacity var(--dur-base) var(--ease-out); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
