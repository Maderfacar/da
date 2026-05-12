<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const TW_CENTER = { lat: 23.7, lng: 121.0 };
const TW_BOUNDS = {
  sw: { lat: 21.8, lng: 120.0 },
  ne: { lat: 25.3, lng: 122.0 },
};
const POLL_INTERVAL = 15_000;
const OFFLINE_THRESHOLD_MS = 600_000; // P19：10 分鐘沒位置更新 → derivedStatus='offline'

type FilterMode = 'all' | 'online' | 'busy' | 'offline';
type DerivedStatus = 'online' | 'busy' | 'offline';

interface DriverWithDerived extends DriverInfo {
  derivedStatus: DerivedStatus;
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  confirmed: '待出發',
  en_route: '前往上車',
  arrived_pickup: '已到點',
  in_transit: '載客中',
};

const mapEl = ref<HTMLDivElement | null>(null);
const drivers = ref<DriverInfo[]>([]);
const lastRefresh = ref('');
const filter = ref<FilterMode>('all');
// P21：手機 bottom sheet 開合狀態（桌機側面板恆顯）
const sheetOpen = ref(false);

let gmMap: google.maps.Map | null = null;
const markerMap = new Map<string, google.maps.Marker>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ── derivedStatus 推導（P19）────────────────────────────────
const _DeriveStatus = (d: DriverInfo): DerivedStatus => {
  const lastActive = d.lastActiveAt || d.updatedAt || 0;
  if (Date.now() - lastActive > OFFLINE_THRESHOLD_MS) return 'offline';
  return d.status;
};

const driversWithStatus = computed<DriverWithDerived[]>(() =>
  drivers.value.map((d) => ({ ...d, derivedStatus: _DeriveStatus(d) }))
);

const filteredDrivers = computed<DriverWithDerived[]>(() =>
  filter.value === 'all'
    ? driversWithStatus.value
    : driversWithStatus.value.filter((d) => d.derivedStatus === filter.value)
);

const driverCounts = computed(() => {
  const c = { all: 0, online: 0, busy: 0, offline: 0 };
  for (const d of driversWithStatus.value) {
    c.all++;
    c[d.derivedStatus]++;
  }
  return c;
});

// ── Google Maps 載入（同 MapRoutePreview 模式）─────────────
function _loadGoogleMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.maps) { resolve(); return; }
    const existing = document.getElementById('gm-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Maps 載入失敗')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'gm-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&language=zh-TW&region=TW`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps 載入失敗'));
    document.head.appendChild(script);
  });
}

const _InitMapFlow = async () => {
  if (!mapEl.value) return;
  const { googleMapsBrowserKey } = useRuntimeConfig().public;
  if (!googleMapsBrowserKey) return;

  try {
    await _loadGoogleMapsScript(googleMapsBrowserKey);
  } catch (err) {
    console.error('[admin/war-room] Google Maps load failed:', err);
    return;
  }

  const taBounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(TW_BOUNDS.sw.lat, TW_BOUNDS.sw.lng),
    new google.maps.LatLng(TW_BOUNDS.ne.lat, TW_BOUNDS.ne.lng),
  );

  gmMap = new google.maps.Map(mapEl.value, {
    center: TW_CENTER,
    zoom: 8,
    restriction: { latLngBounds: taBounds, strictBounds: true },
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'cooperative',
    styles: _mapStyles(),
  });
};

// ── 地圖樣式（暗色主題）────────────────────────────────────
function _mapStyles(): google.maps.MapTypeStyle[] {
  return [
    { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a9a' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d2d4e' }] },
    { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#373760' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1623' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3a3a5c' }] },
  ];
}

// ── Markers 更新（P19 polish）─────────────────────────────
const _IconForDriver = (d: DriverWithDerived): google.maps.Symbol => {
  // P19：heading=null 時改畫圓點（避免靜止司機箭頭固定指北）
  // offline 司機半透明
  const colorMap: Record<DerivedStatus, string> = {
    online:  '#22c55e',
    busy:    '#d4860a',
    offline: '#6b7280',
  };
  const fillColor = colorMap[d.derivedStatus];
  const opacity = d.derivedStatus === 'offline' ? 0.4 : 1;

  if (d.heading == null) {
    // 靜止：圓點
    return {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor,
      fillOpacity: opacity,
      strokeColor: '#fff',
      strokeWeight: 1.5,
      strokeOpacity: opacity,
    };
  }
  // 移動中：箭頭（指向 heading 方向）
  return {
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
    scale: 5,
    fillColor,
    fillOpacity: opacity,
    strokeColor: '#fff',
    strokeWeight: 1.5,
    strokeOpacity: opacity,
    rotation: d.heading,
  };
};

const _UpdateMarkers = (list: DriverWithDerived[]) => {
  if (!gmMap) return;

  const activeIds = new Set(list.map((d) => d.driverId));

  // 移除不在列表中的 marker
  for (const [id, marker] of markerMap.entries()) {
    if (!activeIds.has(id)) {
      marker.setMap(null);
      markerMap.delete(id);
    }
  }

  for (const d of list) {
    const pos = new google.maps.LatLng(d.lat, d.lng);
    const icon = _IconForDriver(d);
    const title = `${d.displayName || d.driverId} (${d.derivedStatus})`;

    if (markerMap.has(d.driverId)) {
      const m = markerMap.get(d.driverId)!;
      m.setPosition(pos);
      m.setIcon(icon);
      m.setTitle(title);
    } else {
      const m = new google.maps.Marker({ position: pos, map: gmMap, icon, title });
      markerMap.set(d.driverId, m);
    }
  }
};

// ── 輪詢資料 ─────────────────────────────────────────────
const ApiRefreshDrivers = async () => {
  const res = await $api.GetAvailableDrivers();
  if (res.status.code !== $enum.apiStatus.success && res.status.code !== 0) return;
  drivers.value = (res.data as DriverInfo[]) ?? [];
  lastRefresh.value = $dayjs().format('HH:mm:ss');
  _UpdateMarkers(filteredDrivers.value);
};

// 改變 filter 時即時更新地圖
watch(filteredDrivers, (list) => _UpdateMarkers(list));

const _StartPoll = () => {
  ApiRefreshDrivers();
  pollTimer = setInterval(ApiRefreshDrivers, POLL_INTERVAL);
};

const _StopPoll = () => {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
};

// P19：unmount 清理 markers 防 leak
const _ClearAllMarkers = () => {
  for (const [, m] of markerMap) m.setMap(null);
  markerMap.clear();
};

onMounted(async () => {
  await _InitMapFlow();
  _StartPoll();
});

onUnmounted(() => {
  _StopPoll();
  _ClearAllMarkers();
});
</script>

<template lang="pug">
.PageWarRoom
  //- 地圖
  .PageWarRoom__map(ref="mapEl")

  //- 手機浮動按鈕（< 768px 顯示）
  button.PageWarRoom__fab(
    @click="sheetOpen = true"
    aria-label="開啟司機列表"
  )
    span.PageWarRoom__fab-icon 🚗
    span.PageWarRoom__fab-count {{ driverCounts.all }}

  //- 手機 bottom sheet 遮罩
  .PageWarRoom__sheet-mask(
    :class="{ 'is-open': sheetOpen }"
    @click="sheetOpen = false"
  )

  //- 側邊資訊面板（桌機常駐 / 手機 bottom sheet）
  .PageWarRoom__panel(:class="{ 'is-sheet-open': sheetOpen }")
    //- 手機 bottom sheet 拖把（視覺）
    .PageWarRoom__sheet-handle(@click="sheetOpen = false")

    .PageWarRoom__panel-header
      .PageWarRoom__panel-title 即時作戰室
      .PageWarRoom__panel-sub WAR ROOM

    //- P19：狀態 filter
    .PageWarRoom__filter
      button.PageWarRoom__filter-btn(
        :class="{ 'is-active': filter === 'all' }"
        @click="filter = 'all'"
      ) 全部 {{ driverCounts.all }}
      button.PageWarRoom__filter-btn(
        :class="{ 'is-active': filter === 'online' }"
        @click="filter = 'online'"
      ) 上線 {{ driverCounts.online }}
      button.PageWarRoom__filter-btn(
        :class="{ 'is-active': filter === 'busy' }"
        @click="filter = 'busy'"
      ) 任務中 {{ driverCounts.busy }}
      button.PageWarRoom__filter-btn(
        :class="{ 'is-active': filter === 'offline' }"
        @click="filter = 'offline'"
      ) 離線 {{ driverCounts.offline }}

    .PageWarRoom__panel-meta(v-if="lastRefresh")
      span.PageWarRoom__meta-label 最後更新
      span.PageWarRoom__meta-val {{ lastRefresh }}

    //- 司機列表
    .PageWarRoom__driver-list
      .PageWarRoom__driver-item(
        v-for="d in filteredDrivers"
        :key="d.driverId"
        :class="`is-${d.derivedStatus}`"
      )
        .PageWarRoom__driver-dot(:class="`is-${d.derivedStatus}`")
        .PageWarRoom__driver-info
          .PageWarRoom__driver-name {{ d.displayName || d.driverId.slice(0, 8) }}
          .PageWarRoom__driver-coords {{ d.lat.toFixed(4) }}, {{ d.lng.toFixed(4) }}
          //- P19：busy driver 顯示 activeOrder
          .PageWarRoom__driver-order(v-if="d.derivedStatus === 'busy' && d.activeOrder")
            span.PageWarRoom__driver-order-id \#{{ d.activeOrder.orderId.slice(-6).toUpperCase() }}
            span.PageWarRoom__driver-order-status {{ ORDER_STATUS_LABEL[d.activeOrder.orderStatus] ?? d.activeOrder.orderStatus }}

    .PageWarRoom__empty(v-if="!filteredDrivers.length")
      | {{ filter === 'all' ? '目前無司機資料' : '此狀態下無司機' }}
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageWarRoom {
  display: flex;
  height: calc(100vh - 60px);
  background: #0f1115;
  overflow: hidden;
  position: relative;
}

// ── 地圖 ──────────────────────────────────────────────────
.PageWarRoom__map {
  flex: 1;
  height: 100%;
}

// ── 浮動按鈕（手機）──────────────────────────────────────
.PageWarRoom__fab {
  display: none;
  position: fixed;
  right: 16px;
  bottom: 24px;
  z-index: 60;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  border-radius: 100px;
  border: 1px solid rgba(212, 134, 10, 0.5);
  background: var(--da-amber);
  color: #fff;
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;

  &:active { transform: scale(0.96); }
}

.PageWarRoom__fab-icon { font-size: 16px; line-height: 1; }
.PageWarRoom__fab-count {
  min-width: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

// ── Sheet 遮罩（手機）────────────────────────────────────
.PageWarRoom__sheet-mask {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.25s ease, visibility 0.25s ease;

  &.is-open {
    opacity: 1;
    visibility: visible;
  }
}

// ── Sheet 拖把（手機）────────────────────────────────────
.PageWarRoom__sheet-handle {
  display: none;
  width: 40px;
  height: 4px;
  margin: 6px auto 12px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.25);
  cursor: pointer;
  flex-shrink: 0;
}

// ── 側邊面板 ──────────────────────────────────────────────
.PageWarRoom__panel {
  width: 300px;
  flex-shrink: 0;
  background: #1a1a2e;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  padding: 20px 16px;
  overflow-y: auto;
}

// ── 手機（< 768px）：地圖滿版 / 面板改 bottom sheet ─────
@media (max-width: 767.98px) {
  .PageWarRoom {
    flex-direction: column;
    height: calc(100svh - 56px);
  }

  .PageWarRoom__map { height: 100%; }

  .PageWarRoom__fab { display: inline-flex; }
  .PageWarRoom__sheet-mask { display: block; }
  .PageWarRoom__sheet-handle { display: block; }

  .PageWarRoom__panel {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 80;
    width: 100%;
    max-height: 75vh;
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px 20px 0 0;
    padding: 4px 16px 24px;
    transform: translateY(100%);
    transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5);

    &.is-sheet-open { transform: translateY(0); }
  }
}

.PageWarRoom__panel-header {
  margin-bottom: 16px;
}

.PageWarRoom__panel-title {
  font-family: $font-display;
  font-size: 28px;
  color: #fff;
  letter-spacing: 0.04em;
  line-height: 1;
}

.PageWarRoom__panel-sub {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  color: var(--da-amber);
  margin-top: 2px;
}

// ── Filter（P19）──────────────────────────────────────────
.PageWarRoom__filter {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 16px;
}

.PageWarRoom__filter-btn {
  font-family: $font-condensed;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.15s;

  &:hover { background: rgba(255, 255, 255, 0.06); }
  &.is-active {
    background: var(--da-amber);
    border-color: var(--da-amber);
    color: #fff;
  }
}

// ── Meta ──────────────────────────────────────────────────
.PageWarRoom__panel-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 4px;
}

.PageWarRoom__meta-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
}

.PageWarRoom__meta-val {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}

// ── 司機列表 ──────────────────────────────────────────────
.PageWarRoom__driver-list {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageWarRoom__driver-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;

  &.is-offline { opacity: 0.55; }
}

.PageWarRoom__driver-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 6px;

  &.is-online  { background: #22c55e; box-shadow: 0 0 6px rgba(34, 197, 94, 0.5); }
  &.is-busy    { background: var(--da-amber); box-shadow: 0 0 6px rgba(212, 134, 10, 0.5); }
  &.is-offline { background: #6b7280; }
}

.PageWarRoom__driver-info {
  flex: 1;
  min-width: 0;
}

.PageWarRoom__driver-name {
  font-family: $font-condensed;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.PageWarRoom__driver-coords {
  font-family: $font-condensed;
  font-size: 9px;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 2px;
}

// P19：active order 顯示
.PageWarRoom__driver-order {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  background: rgba(212, 134, 10, 0.08);
  border: 1px solid rgba(212, 134, 10, 0.2);
  border-radius: 6px;
}

.PageWarRoom__driver-order-id {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--da-amber);
}

.PageWarRoom__driver-order-status {
  font-family: $font-condensed;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
  letter-spacing: 0.05em;
}

// ── 空狀態 ────────────────────────────────────────────────
.PageWarRoom__empty {
  margin-top: 24px;
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.2);
  text-align: center;
}

</style>
