<script setup lang="ts">
// P19：driver/trip 改為列表 + modal 詳情設計
// - 列表卡片只顯示日期 / 時間 / 訂單號 / 路線簡略 / 狀態徽章
// - 點卡片開 modal 顯示完整訂單資訊 + 四階段操作按鈕
// - 上下車 + 停靠站地址點擊可開 Google Maps 導航
// - 排序：pickupDateTime 升序（最早出發的在最上面）
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

import { EXTRA_SERVICES, ORDER_TYPES, VEHICLE_CONFIGS } from '~shared/pricing';

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

const ORDER_TYPE_LABEL = Object.fromEntries(ORDER_TYPES.map((t) => [t.value, t.label])) as Record<string, string>;
const VEHICLE_LABEL = Object.fromEntries(Object.entries(VEHICLE_CONFIGS).map(([k, v]) => [k, v.label])) as Record<string, string>;
const EXTRA_SERVICE_LABEL = Object.fromEntries(EXTRA_SERVICES.map((s) => [s.value, s.label])) as Record<string, string>;

const orders = ref<AssignedOrder[]>([]);
const loading = ref(false);
const advancing = ref<string | null>(null);
const selectedOrder = ref<AssignedOrder | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

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

const ClickOpenDetail = (order: AssignedOrder) => {
  selectedOrder.value = order;
};

const ClickCloseDetail = () => {
  selectedOrder.value = null;
};

const ClickAdvance = async (order: AssignedOrder) => {
  if (advancing.value) return;
  const cfg = ACTION_BY_STATUS[order.orderStatus];
  if (!cfg) return;

  advancing.value = order.orderId;
  try {
    // P19：操作訂單時即時上傳當前座標（跳過 5m / 60s / accuracy 檢查）
    await driverGeo.UploadNow();

    const res = await $api.PatchOrder(order.orderId, { orderStatus: cfg.next });
    if (res.status.code === $enum.apiStatus.success) {
      ElMessage({ message: `已更新：${cfg.label}`, type: 'success' });
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
  document.addEventListener('visibilitychange', _OnVisibilityChange);
});

onUnmounted(() => {
  if (pollTimer !== null) clearInterval(pollTimer);
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
            span.PageDriverTrip__card-fare NT$ {{ order.estimatedFare.toLocaleString() }}

  //- ── Modal 詳情 ──────────────────────────────────────
  Transition(name="fade")
    .PageDriverTrip__modal-mask(v-if="selectedOrder" @click.self="ClickCloseDetail")
      .PageDriverTrip__modal
        //- Modal Header
        .PageDriverTrip__modal-head
          .PageDriverTrip__modal-head-left
            span.PageDriverTrip__modal-type {{ ORDER_TYPE_LABEL[selectedOrder.orderType] ?? selectedOrder.orderType }}
            span.PageDriverTrip__modal-vehicle {{ VEHICLE_LABEL[selectedOrder.vehicleType] ?? selectedOrder.vehicleType }}
          button.PageDriverTrip__modal-close(@click="ClickCloseDetail") ×

        .PageDriverTrip__modal-id \#{{ selectedOrder.orderId.toUpperCase() }}
        .PageDriverTrip__modal-status(:class="`is-${selectedOrder.orderStatus}`")
          | {{ STATUS_LABEL[selectedOrder.orderStatus] }}

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
            .PageDriverTrip__section-row
              span.PageDriverTrip__section-key 人數 / 行李
              span.PageDriverTrip__section-val {{ selectedOrder.passengerCount }} 人 / {{ selectedOrder.luggageCount }} 件

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
                | {{ EXTRA_SERVICE_LABEL[s] || s }}

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
        .PageDriverTrip__modal-foot
          button.PageDriverTrip__action(
            :disabled="advancing === selectedOrder.orderId"
            @click="ClickAdvance(selectedOrder)"
          ) {{ advancing === selectedOrder.orderId ? '處理中...' : (ACTION_BY_STATUS[selectedOrder.orderStatus]?.label ?? '無可用操作') }}
</template>

<style lang="scss" scoped>
$amber: #d4860a;
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageDriverTrip {
  padding: 20px 16px 100px;
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
}

// transition
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
