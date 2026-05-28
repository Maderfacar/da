<script setup lang="ts">
import { ORDER_TYPES } from '~shared/pricing';
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
      p 目前沒有指派任務
      small 請至「搶單」頁查看可接訂單

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
              span.PageDriverTrip__route-from {{ order.pickupLocation?.displayName?.split(',')[0] || order.pickupLocation?.address }}
              span.PageDriverTrip__route-arrow →
              span.PageDriverTrip__route-to {{ order.dropoffLocation?.displayName?.split(',')[0] || order.dropoffLocation?.address }}
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
            span.PageDriverTrip__route-from {{ o.pickupLocation?.displayName?.split(',')[0] || o.pickupLocation?.address }}
            span.PageDriverTrip__route-arrow →
            span.PageDriverTrip__route-to {{ o.dropoffLocation?.displayName?.split(',')[0] || o.dropoffLocation?.address }}
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
$amber: #d4860a;
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageDriverTrip {
  padding: 20px 16px 32px;
  min-height: 100vh;
  background: var(--da-dark);
  color: #fff;
}

// ── 頁首 ──────────────────────────────────────────────
.PageDriverTrip__header { margin-bottom: 24px; }

.PageDriverTrip__header-label {
  font-family: $font-condensed;
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

.PageDriverTrip__header-title {
  font-family: $font-display;
  font-size: 36px;
  letter-spacing: 0.04em;
  color: #fff;
  line-height: 1;
}

.PageDriverTrip__header-sub {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 4px;
}

// ── Wave 1 D1：Tab 切換 + 歷史 toolbar ──────────────────
.PageDriverTrip__tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  width: fit-content;
}

.PageDriverTrip__tab {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover { color: rgba(255, 255, 255, 0.75); }
  &.is-active { background: rgba($amber, 0.18); color: $amber; }
}

.PageDriverTrip__history-toolbar {
  margin-bottom: 14px;
}

.PageDriverTrip__history-badge {
  display: inline-block;
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 9px;
  border-radius: 6px;

  &.is-completed { background: rgba(80, 200, 120, 0.12); color: #50c878; border: 1px solid rgba(80, 200, 120, 0.3); }
  &.is-cancelled { background: rgba(248, 113, 113, 0.12); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.3); }
}

.PageDriverTrip__card.is-history {
  cursor: default;
  &:hover { border-color: rgba(255, 255, 255, 0.08); }
  &:active { transform: none; background: rgba(255, 255, 255, 0.04); }
}

// ── Loading ──────────────────────────────────────────
.PageDriverTrip__loading { display: flex; justify-content: center; padding: 60px 0; }

.PageDriverTrip__spinner {
  width: 28px; height: 28px;
  border: 2px solid rgba($amber, 0.2);
  border-top-color: $amber;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 空狀態 ────────────────────────────────────────────
.PageDriverTrip__empty { text-align: center; padding: 60px 0; }
.PageDriverTrip__empty-icon { font-size: 48px; margin-bottom: 12px; }
.PageDriverTrip__empty p {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.5);
}
.PageDriverTrip__empty small {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.25);
}

// ── 列表卡片（簡略）──────────────────────────────────────
.PageDriverTrip__list { display: flex; flex-direction: column; gap: 10px; }

.PageDriverTrip__card {
  display: flex;
  gap: 12px;
  padding: 14px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.15s;
  &:active { transform: scale(0.99); background: rgba(255, 255, 255, 0.06); }
  &:hover { border-color: rgba($amber, 0.3); }
}

.PageDriverTrip__card-time {
  flex-shrink: 0;
  width: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
  border-right: 1px dashed rgba(255, 255, 255, 0.1);
  padding-right: 12px;
}

.PageDriverTrip__card-date {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5);
}

.PageDriverTrip__card-clock {
  font-family: $font-display;
  font-size: 22px;
  letter-spacing: 0.04em;
  color: #fff;
  margin-top: 2px;
}

.PageDriverTrip__card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }

.PageDriverTrip__card-row { display: flex; align-items: center; gap: 8px; }

.PageDriverTrip__type-badge {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 100px;
  background: rgba($amber, 0.15);
  border: 1px solid rgba($amber, 0.3);
  color: $amber;
}

.PageDriverTrip__id {
  font-family: $font-condensed;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
  margin-left: auto;
  letter-spacing: 0.08em;
}

.PageDriverTrip__card-route {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.PageDriverTrip__route-from, .PageDriverTrip__route-to {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PageDriverTrip__route-arrow { color: rgba($amber, 0.7); flex-shrink: 0; }

.PageDriverTrip__card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}

.PageDriverTrip__status-badge {
  display: inline-block;
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 3px 9px;
  border-radius: 6px;

  &.is-confirmed       { background: rgba(74, 222, 128, 0.12); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); }
  &.is-en_route        { background: rgba(96, 165, 250, 0.12); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); }
  &.is-arrived_pickup  { background: rgba(251, 191, 36, 0.12); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); }
  &.is-in_transit      { background: rgba($amber, 0.12); color: $amber; border: 1px solid rgba($amber, 0.4); }
}

.PageDriverTrip__card-fare {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  color: $amber;
  letter-spacing: 0.04em;
}

// Phase 1F：confirmation pending chip + banner
.PageDriverTrip__pending-chip {
  display: inline-block;
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 100px;
  background: rgba(255, 200, 100, 0.12);
  border: 1px solid rgba(255, 200, 100, 0.35);
  color: rgba(255, 220, 150, 0.95);
  margin-left: 6px;
}

.PageDriverTrip__pending-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 12px 16px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 200, 100, 0.08);
  border: 1px solid rgba(255, 200, 100, 0.3);
}

.PageDriverTrip__pending-banner-icon {
  font-size: 18px;
  line-height: 1;
}

.PageDriverTrip__pending-banner-body {
  flex: 1;
}

.PageDriverTrip__pending-banner-title {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 220, 150, 0.95);
  letter-spacing: 0.04em;
}

.PageDriverTrip__pending-banner-desc {
  font-family: $font-body;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.55;
  margin-top: 4px;
}

// ── Modal ────────────────────────────────────────────
.PageDriverTrip__modal-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
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
  background: #1a1a2e;
  border: 1px solid rgba($amber, 0.2);
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  @media (min-width: 640px) {
    border-radius: 20px;
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
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 4px 12px;
  border-radius: 100px;
  background: rgba($amber, 0.18);
  border: 1px solid rgba($amber, 0.4);
  color: $amber;
}

.PageDriverTrip__modal-vehicle {
  font-family: $font-condensed;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 100px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
}

.PageDriverTrip__modal-close {
  width: 36px; height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  font-size: 22px;
  cursor: pointer;
  &:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
}

.PageDriverTrip__modal-id {
  padding: 0 20px;
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.3);
}

.PageDriverTrip__modal-status {
  margin: 8px 20px 12px;
  display: inline-block;
  align-self: flex-start;
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 4px 12px;
  border-radius: 6px;
  width: fit-content;

  &.is-confirmed       { background: rgba(74, 222, 128, 0.12); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); }
  &.is-en_route        { background: rgba(96, 165, 250, 0.12); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); }
  &.is-arrived_pickup  { background: rgba(251, 191, 36, 0.12); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); }
  &.is-in_transit      { background: rgba($amber, 0.12); color: $amber; border: 1px solid rgba($amber, 0.4); }
}

.PageDriverTrip__modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px 20px;
}

// Section
.PageDriverTrip__section {
  padding: 14px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  &:first-child { border-top: none; padding-top: 4px; }
}

.PageDriverTrip__section-title {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.35);
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
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
}

.PageDriverTrip__section-val {
  font-family: $font-body;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
  text-align: right;

  &.is-muted { color: rgba(255, 255, 255, 0.35); font-size: 12px; font-style: italic; }
  &.is-fare { font-family: $font-condensed; font-weight: 700; color: $amber; font-size: 16px; }
}

// 地址卡片（可點擊開 Google Maps）
.PageDriverTrip__addr-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 12px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { border-color: rgba($amber, 0.4); background: rgba($amber, 0.05); }
  &:active { transform: scale(0.99); }

  &.is-pickup .PageDriverTrip__addr-tag { background: $amber; color: #fff; }
  &.is-stop .PageDriverTrip__addr-tag { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.6); }
  &.is-dropoff .PageDriverTrip__addr-tag { background: rgba(74, 222, 128, 0.2); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.3); }
}

.PageDriverTrip__addr-tag {
  flex-shrink: 0;
  font-family: $font-condensed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 4px 8px;
  border-radius: 5px;
  margin-top: 2px;
}

.PageDriverTrip__addr-text { flex: 1; min-width: 0; }

.PageDriverTrip__addr-name {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
  line-height: 1.4;
}

.PageDriverTrip__addr-full {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 2px;
  line-height: 1.4;
}

.PageDriverTrip__addr-icon {
  flex-shrink: 0;
  font-size: 18px;
  color: $amber;
  margin-top: 4px;
}

// 額外服務 tag list
.PageDriverTrip__extras {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.PageDriverTrip__extra-tag {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba($amber, 0.1);
  border: 1px solid rgba($amber, 0.25);
  color: rgba($amber, 0.9);
}

// 備註
.PageDriverTrip__notes {
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.6;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

// Modal footer
.PageDriverTrip__modal-foot {
  flex-shrink: 0;
  padding: 12px 20px 20px;
  background: linear-gradient(180deg, transparent 0, rgba(0, 0, 0, 0.4) 30%);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.PageDriverTrip__action {
  width: 100%;
  font-family: $font-condensed;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 14px 20px;
  border-radius: 12px;
  border: none;
  background: $amber;
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;

  &:disabled { opacity: 0.6; cursor: not-allowed; }
  &:active:not(:disabled) { transform: scale(0.98); }

  // 「僅紀錄」次按鈕：與主按鈕同寬，但低調配色（不發 LINE 給乘客）
  &.is-quiet {
    margin-top: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.18);
  }
}

// Phase 3：時間 gate 倒數提示（緊貼按鈕下方，置中）
.PageDriverTrip__action-hint {
  margin-top: 8px;
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.55);
  text-align: center;
}

// transition
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
