<script setup lang="ts">
definePageMeta({ layout: 'back-desk', middleware: ['auth', 'role'], ssr: false });

const TW_CENTER = { lat: 23.7, lng: 121.0 };
const TW_BOUNDS = {
  sw: { lat: 21.8, lng: 120.0 },
  ne: { lat: 25.3, lng: 122.0 },
};
const POLL_INTERVAL = 15_000;

const mapEl = ref<HTMLDivElement | null>(null);
const drivers = ref<DriverInfo[]>([]);
const lastRefresh = ref('');

let gmMap: google.maps.Map | null = null;
const markerMap = new Map<string, google.maps.Marker>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

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
  } catch (e) {
    console.error(e);
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

// ── Markers 更新 ─────────────────────────────────────────
const _UpdateMarkers = (list: DriverInfo[]) => {
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
    const isBusy = d.status === 'busy';
    const icon: google.maps.Symbol = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 5,
      fillColor: isBusy ? '#d4860a' : '#22c55e',
      fillOpacity: 1,
      strokeColor: '#fff',
      strokeWeight: 1.5,
      rotation: d.heading ?? 0,
    };

    if (markerMap.has(d.driverId)) {
      const m = markerMap.get(d.driverId)!;
      m.setPosition(pos);
      m.setIcon(icon);
      m.setTitle(`${d.displayName || d.driverId} (${d.status})`);
    } else {
      const m = new google.maps.Marker({
        position: pos,
        map: gmMap,
        icon,
        title: `${d.displayName || d.driverId} (${d.status})`,
      });
      markerMap.set(d.driverId, m);
    }
  }
};

// ── 輪詢資料 ─────────────────────────────────────────────
const ApiRefreshDrivers = async () => {
  const res = await $api.GetAvailableDrivers();
  if (res.status.code !== $enum.apiStatus.success && res.status.code !== 0) return;
  drivers.value = res.data as DriverInfo[];
  lastRefresh.value = $dayjs().format('HH:mm:ss');
  _UpdateMarkers(drivers.value);
};

const _StartPoll = () => {
  ApiRefreshDrivers();
  pollTimer = setInterval(ApiRefreshDrivers, POLL_INTERVAL);
};

const _StopPoll = () => {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
};

onMounted(async () => {
  await _InitMapFlow();
  _StartPoll();
});

onUnmounted(_StopPoll);
</script>

<template lang="pug">
.PageWarRoom
  //- 地圖
  .PageWarRoom__map(ref="mapEl")

  //- 側邊資訊面板
  .PageWarRoom__panel
    .PageWarRoom__panel-header
      .PageWarRoom__panel-title 即時作戰室
      .PageWarRoom__panel-sub WAR ROOM
    .PageWarRoom__panel-meta
      span.PageWarRoom__meta-label 在線司機
      span.PageWarRoom__meta-val {{ drivers.length }}
    .PageWarRoom__panel-meta(v-if="lastRefresh")
      span.PageWarRoom__meta-label 最後更新
      span.PageWarRoom__meta-val {{ lastRefresh }}

    //- 司機列表
    .PageWarRoom__driver-list
      .PageWarRoom__driver-item(v-for="d in drivers" :key="d.driverId")
        .PageWarRoom__driver-dot(:class="d.status === 'busy' ? 'is-busy' : 'is-online'")
        .PageWarRoom__driver-info
          .PageWarRoom__driver-name {{ d.displayName || d.driverId.slice(0, 8) }}
          .PageWarRoom__driver-coords {{ d.lat.toFixed(4) }}, {{ d.lng.toFixed(4) }}
        .PageWarRoom__driver-status {{ d.status === 'busy' ? '任務中' : '待命' }}

    .PageWarRoom__empty(v-if="!drivers.length")
      | 目前無在線司機
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
}

// ── 地圖 ──────────────────────────────────────────────────
.PageWarRoom__map {
  flex: 1;
  height: 100%;
}

// ── 側邊面板 ──────────────────────────────────────────────
.PageWarRoom__panel {
  width: 280px;
  flex-shrink: 0;
  background: #1a1a2e;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  padding: 20px 16px;
  overflow-y: auto;
}

.PageWarRoom__panel-header {
  margin-bottom: 20px;
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
  font-size: 14px;
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
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
}

.PageWarRoom__driver-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.is-online { background: #22c55e; box-shadow: 0 0 6px rgba(34, 197, 94, 0.5); }
  &.is-busy   { background: var(--da-amber); box-shadow: 0 0 6px rgba(212, 134, 10, 0.5); }
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

.PageWarRoom__driver-status {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
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
