<script setup lang="ts">
import type { GooglePlace } from '~/protocol/fetch-api/api/maps';

interface Props {
  origin?: GooglePlace | null;
  waypoints?: GooglePlace[];
  destination?: GooglePlace | null;
  /** 目前正在編輯哪個欄位（決定 Drop Pin 要更新哪個 emit）*/
  activeField?: 'origin' | `waypoint-${number}` | 'destination' | null;
  height?: string;
}

const props = withDefaults(defineProps<Props>(), {
  origin: null,
  waypoints: () => [],
  destination: null,
  activeField: null,
  height: '260px',
});

const emit = defineEmits<{
  (e: 'pin-placed', field: string, place: GooglePlace): void;
}>();

// ── 台灣本島邊界 ──────────────────────────────────────────
const TW_BOUNDS = {
  sw: { lat: 21.8, lng: 120.0 },
  ne: { lat: 25.3, lng: 122.0 },
};
const TW_CENTER = { lat: 23.7, lng: 121.0 };

function _isInTaiwan(lat: number, lng: number): boolean {
  return (
    lat >= TW_BOUNDS.sw.lat && lat <= TW_BOUNDS.ne.lat &&
    lng >= TW_BOUNDS.sw.lng && lng <= TW_BOUNDS.ne.lng
  );
}

// ── refs ──────────────────────────────────────────────────
const mapEl = ref<HTMLDivElement | null>(null);
const mapReady = ref(false);
const pinLoading = ref(false);
const pinError = ref('');

let gmMap: google.maps.Map | null = null;
let directionsService: google.maps.DirectionsService | null = null;
let directionsRenderer: google.maps.DirectionsRenderer | null = null;
// 各點的 Marker
let originMarker: google.maps.Marker | null = null;
let destMarker: google.maps.Marker | null = null;
const waypointMarkers: google.maps.Marker[] = [];
// 臨時 Drop Pin marker
let dropPinMarker: google.maps.Marker | null = null;
// 長按計時器
let longPressTimer: ReturnType<typeof setTimeout> | null = null;

// ── Google Maps 動態載入（僅 Client-side）────────────────
function _loadGoogleMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.maps?.places) { resolve(); return; }

    const existing = document.getElementById('gm-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Maps 載入失敗')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'gm-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&language=zh-TW&region=TW&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps 載入失敗'));
    document.head.appendChild(script);
  });
}

// ── 初始化地圖 ─────────────────────────────────────────────
async function _InitMapFlow() {
  if (!mapEl.value) return;

  const { googleMapsBrowserKey } = useRuntimeConfig().public;
  if (!googleMapsBrowserKey) {
    console.warn('[MapRoutePreview] googleMapsBrowserKey 未設定，地圖無法載入');
    return;
  }

  try {
    await _loadGoogleMapsScript(googleMapsBrowserKey);
  } catch (e) {
    console.error(e);
    return;
  }

  const taBounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(TW_BOUNDS.sw.lat, TW_BOUNDS.sw.lng),
    new google.maps.LatLng(TW_BOUNDS.ne.lat, TW_BOUNDS.ne.lng)
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

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    suppressMarkers: true, // 我們自行管理 Marker
    polylineOptions: { strokeColor: '#D4860A', strokeWeight: 4 },
  });
  directionsRenderer.setMap(gmMap);

  // 點擊 Drop Pin（Desktop）
  gmMap.addListener('click', (e: google.maps.MapMouseEvent) => {
    if (e.latLng) _DropPinFlow(e.latLng.lat(), e.latLng.lng());
  });

  // 長按 Drop Pin（Mobile）
  gmMap.addListener('touchstart', (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch || !gmMap) return;
    longPressTimer = setTimeout(() => {
      const point = new google.maps.Point(touch.clientX, touch.clientY);
      const overlay = new google.maps.OverlayView();
      overlay.setMap(gmMap);
      overlay.onAdd = () => {
        const proj = overlay.getProjection();
        if (!proj) return;
        const latLng = proj.fromContainerPixelToLatLng(point);
        if (latLng) _DropPinFlow(latLng.lat(), latLng.lng());
        overlay.setMap(null);
      };
      overlay.draw = () => {};
    }, 600);
  });

  gmMap.addListener('touchend', () => { if (longPressTimer) clearTimeout(longPressTimer); });
  gmMap.addListener('touchmove', () => { if (longPressTimer) clearTimeout(longPressTimer); });

  mapReady.value = true;
  _SyncMarkersAndRoute();
}

// ── Drop Pin：逆向地理編碼 + 台灣圍欄驗證 ────────────────
async function _DropPinFlow(lat: number, lng: number) {
  if (!props.activeField) return; // 未指定目標欄位，不放 Pin
  if (!_isInTaiwan(lat, lng)) {
    pinError.value = '所選地點不在台灣本島服務範圍內';
    setTimeout(() => { pinError.value = ''; }, 3000);
    return;
  }

  pinLoading.value = true;
  pinError.value = '';

  // 先放臨時 pin（視覺反饋）
  _PlaceTempPin(lat, lng);

  const res = await $api.GetMapsReverseGeocode({ lat, lng });
  pinLoading.value = false;

  if (res.status.code !== 200) {
    pinError.value = res.status.message.zh_tw;
    _RemoveTempPin();
    setTimeout(() => { pinError.value = ''; }, 3000);
    return;
  }

  const place = res.data as GooglePlace;
  emit('pin-placed', props.activeField, place);
  _RemoveTempPin();
}

function _PlaceTempPin(lat: number, lng: number) {
  if (!gmMap) return;
  _RemoveTempPin();
  dropPinMarker = new google.maps.Marker({
    position: { lat, lng },
    map: gmMap,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#D4860A',
      fillOpacity: 0.8,
      strokeColor: '#fff',
      strokeWeight: 2,
    },
    zIndex: 99,
    animation: google.maps.Animation.DROP,
  });
}

function _RemoveTempPin() {
  dropPinMarker?.setMap(null);
  dropPinMarker = null;
}

// ── 同步 Markers 與路線 ────────────────────────────────────
function _SyncMarkersAndRoute() {
  if (!gmMap || !mapReady.value) return;

  _UpdateOriginMarker();
  _UpdateDestMarker();
  _UpdateWaypointMarkers();
  _DrawRoute();
}

function _markerIcon(color: string, label: string): google.maps.Symbol & { label?: google.maps.MarkerLabel } {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 10,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#fff',
    strokeWeight: 2,
  } as any;
}

function _UpdateOriginMarker() {
  if (!gmMap) return;
  originMarker?.setMap(null);
  originMarker = null;
  if (!props.origin?.lat) return;
  originMarker = new google.maps.Marker({
    position: { lat: props.origin.lat, lng: props.origin.lng },
    map: gmMap,
    label: { text: 'A', color: '#fff', fontSize: '12px', fontWeight: '700' },
    icon: { ..._markerIcon('#D4860A', 'A') },
    title: props.origin.displayName,
    zIndex: 10,
  });
}

function _UpdateDestMarker() {
  if (!gmMap) return;
  destMarker?.setMap(null);
  destMarker = null;
  if (!props.destination?.lat) return;
  destMarker = new google.maps.Marker({
    position: { lat: props.destination.lat, lng: props.destination.lng },
    map: gmMap,
    label: { text: 'B', color: '#fff', fontSize: '12px', fontWeight: '700' },
    icon: { ..._markerIcon('#2D2D2D', 'B') },
    title: props.destination.displayName,
    zIndex: 10,
  });
}

function _UpdateWaypointMarkers() {
  if (!gmMap) return;
  waypointMarkers.forEach((m) => m.setMap(null));
  waypointMarkers.length = 0;
  props.waypoints?.forEach((wp, i) => {
    if (!wp?.lat) return;
    const m = new google.maps.Marker({
      position: { lat: wp.lat, lng: wp.lng },
      map: gmMap!,
      label: { text: String(i + 1), color: '#fff', fontSize: '11px', fontWeight: '700' },
      icon: { ..._markerIcon('#4A7C59', String(i + 1)) },
      title: wp.displayName,
      zIndex: 9,
    });
    waypointMarkers.push(m);
  });
}

async function _DrawRoute() {
  if (!directionsService || !directionsRenderer || !gmMap) return;

  const origin = props.origin;
  const destination = props.destination;

  // 若起點或終點尚未設定，清除路線但保留 Markers
  if (!origin?.lat || !destination?.lat) {
    directionsRenderer.setDirections({ routes: [] } as any);

    // fitBounds 至現有 Markers
    const bounds = new google.maps.LatLngBounds();
    let count = 0;
    if (origin?.lat) { bounds.extend({ lat: origin.lat, lng: origin.lng }); count++; }
    props.waypoints?.forEach((wp) => { if (wp?.lat) { bounds.extend({ lat: wp.lat, lng: wp.lng }); count++; } });
    if (count > 0) gmMap.fitBounds(bounds, 80);
    return;
  }

  const waypoints = (props.waypoints ?? [])
    .filter((wp) => wp?.lat)
    .map((wp) => ({ location: { lat: wp.lat, lng: wp.lng }, stopover: true }));

  directionsService.route(
    {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      waypoints,
      travelMode: google.maps.TravelMode.DRIVING,
      region: 'TW',
    },
    (result, status) => {
      if (status === google.maps.DirectionsStatus.OK && result) {
        directionsRenderer!.setDirections(result);
        // fitBounds 至整條路線
        const bounds = new google.maps.LatLngBounds();
        result.routes[0]?.overview_path?.forEach((pt) => bounds.extend(pt));
        gmMap!.fitBounds(bounds, 60);
      }
    }
  );
}

// ── Watch props 更新地圖 ───────────────────────────────────
watch(() => [props.origin, props.destination, props.waypoints], _SyncMarkersAndRoute, { deep: true });

// ── 自訂地圖樣式（機場復古風）───────────────────────────────
function _mapStyles(): google.maps.MapTypeStyle[] {
  return [
    { elementType: 'geometry', stylers: [{ color: '#f5f2ec' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#e8dfc7' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#d4860a' }, { lightness: 60 }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#b8d4e8' }] },
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ];
}

// ── Lifecycle ─────────────────────────────────────────────
onMounted(() => { _InitMapFlow(); });

onUnmounted(() => {
  if (longPressTimer) clearTimeout(longPressTimer);
  originMarker?.setMap(null);
  destMarker?.setMap(null);
  waypointMarkers.forEach((m) => m.setMap(null));
  _RemoveTempPin();
});
</script>

<template lang="pug">
.MapRoutePreview(:style="{ height: props.height }")
  .MapRoutePreview__map(ref="mapEl")

  //- 無 activeField 時不顯示 Drop Pin 提示
  .MapRoutePreview__hint(v-if="activeField && !pinLoading && !pinError")
    span 點擊地圖設定 {{ activeField === 'origin' ? '上車' : activeField === 'destination' ? '下車' : '停靠' }}地點

  .MapRoutePreview__loading(v-if="pinLoading")
    .MapRoutePreview__spinner
    span 解析地址中…

  transition(name="fade")
    .MapRoutePreview__error(v-if="pinError") {{ pinError }}
</template>

<style lang="scss" scoped>
.MapRoutePreview {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background: var(--da-cream);
}

.MapRoutePreview__map {
  width: 100%;
  height: 100%;
}

// ── 提示浮層 ───────────────────────────────────────────────
.MapRoutePreview__hint {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 20px;
  white-space: nowrap;
  pointer-events: none;
}

// ── loading 浮層 ───────────────────────────────────────────
.MapRoutePreview__loading {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.9);
  color: var(--da-dark);
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.MapRoutePreview__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--da-gray-pale);
  border-top-color: var(--da-amber);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

// ── 圍欄錯誤訊息 ───────────────────────────────────────────
.MapRoutePreview__error {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: #fff0f0;
  color: var(--err, #d03030);
  font-family: 'Barlow', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid rgba(208, 48, 48, 0.25);
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

// ── fade 動畫 ──────────────────────────────────────────────
.fade-enter-active,
.fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
