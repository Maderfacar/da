<script setup lang="ts">
definePageMeta({ layout: 'driver', middleware: ['auth', 'role'], ssr: false });

type DriverStatus = 'offline' | 'online' | 'busy';

const STATUS_CONFIG: Record<DriverStatus, { label: string; cls: string; action: string }> = {
  offline: { label: '目前離線', cls: 'is-offline', action: '開始上線' },
  online:  { label: '等待派車', cls: 'is-online',  action: '開始接客' },
  busy:    { label: '任務進行中', cls: 'is-busy',  action: '完成行程' },
};

const authStore = StoreAuth();

const driverStatus = ref<DriverStatus>('offline');
const currentLat = ref<number | null>(null);
const currentLng = ref<number | null>(null);
const heading = ref<number | null>(null);
const lastUploadAt = ref<string>('');
const uploading = ref(false);
const geoError = ref('');

let _watchId: number | null = null;
let _uploadTimer: ReturnType<typeof setInterval> | null = null;

// ── GPS 取得 ────────────────────────────────────────────────
const _StartGeoWatch = () => {
  if (!navigator.geolocation) {
    geoError.value = '裝置不支援 GPS 定位';
    return;
  }
  geoError.value = '';
  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentLat.value = pos.coords.latitude;
      currentLng.value = pos.coords.longitude;
      if (pos.coords.heading !== null) heading.value = pos.coords.heading;
    },
    (err) => { geoError.value = `GPS 錯誤：${err.message}`; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
  );
};

const _StopGeoWatch = () => {
  if (_watchId !== null) {
    navigator.geolocation.clearWatch(_watchId);
    _watchId = null;
  }
};

// ── 位置上傳 ─────────────────────────────────────────────────
const ApiUploadLocation = async (status: DriverStatus) => {
  const uid = authStore.user?.uid;
  if (!uid || currentLat.value === null || currentLng.value === null) return;

  uploading.value = true;
  await $api.UpdateDriverLocation(uid, {
    lat: currentLat.value,
    lng: currentLng.value,
    heading: heading.value ?? undefined,
    status,
    displayName: authStore.lineProfile?.displayName ?? '',
  });
  uploading.value = false;
  lastUploadAt.value = $dayjs().format('HH:mm:ss');
};

const _StartUploadLoop = (status: DriverStatus) => {
  _StopUploadLoop();
  ApiUploadLocation(status);
  _uploadTimer = setInterval(() => ApiUploadLocation(status), 30_000);
};

const _StopUploadLoop = () => {
  if (_uploadTimer !== null) {
    clearInterval(_uploadTimer);
    _uploadTimer = null;
  }
};

// ── 狀態切換 ─────────────────────────────────────────────────
const ClickStatusAction = async () => {
  if (driverStatus.value === 'offline') {
    _StartGeoWatch();
    driverStatus.value = 'online';
    _StartUploadLoop('online');
  } else if (driverStatus.value === 'online') {
    driverStatus.value = 'busy';
    _StartUploadLoop('busy');
  } else {
    driverStatus.value = 'online';
    _StartUploadLoop('online');
  }
};

const ClickGoOffline = async () => {
  _StopUploadLoop();
  const uid = authStore.user?.uid;
  if (uid && currentLat.value !== null && currentLng.value !== null) {
    await $api.UpdateDriverLocation(uid, {
      lat: currentLat.value,
      lng: currentLng.value,
      status: 'offline',
    });
  }
  _StopGeoWatch();
  driverStatus.value = 'offline';
  currentLat.value = null;
  currentLng.value = null;
  lastUploadAt.value = '';
};

onUnmounted(() => {
  _StopUploadLoop();
  _StopGeoWatch();
});
</script>

<template lang="pug">
.PageDriverTrip
  .PageDriverTrip__watermark DRIVER

  //- 頁首
  .PageDriverTrip__header
    .PageDriverTrip__header-label MISSION CONTROL
    h1.PageDriverTrip__header-title 任務中心
    p.PageDriverTrip__header-sub DRIVER OPERATIONS

  //- 狀態卡
  .PageDriverTrip__status-card(:class="STATUS_CONFIG[driverStatus].cls")
    .PageDriverTrip__status-dot
    span.PageDriverTrip__status-label {{ STATUS_CONFIG[driverStatus].label }}
    .PageDriverTrip__status-uploading(v-if="uploading") ↑ 上傳中…

  //- GPS 資訊
  .PageDriverTrip__gps(v-if="driverStatus !== 'offline'")
    .PageDriverTrip__gps-row(v-if="currentLat !== null")
      span.PageDriverTrip__gps-key LAT
      span.PageDriverTrip__gps-val {{ currentLat.toFixed(5) }}
    .PageDriverTrip__gps-row(v-if="currentLng !== null")
      span.PageDriverTrip__gps-key LNG
      span.PageDriverTrip__gps-val {{ currentLng.toFixed(5) }}
    .PageDriverTrip__gps-row(v-if="lastUploadAt")
      span.PageDriverTrip__gps-key LAST SYNC
      span.PageDriverTrip__gps-val {{ lastUploadAt }}
    .PageDriverTrip__gps-row(v-if="geoError")
      span.PageDriverTrip__gps-err {{ geoError }}
    .PageDriverTrip__gps-waiting(v-else-if="currentLat === null")
      | 正在取得 GPS 座標…

  //- 主要操作按鈕
  .PageDriverTrip__actions
    UiButton(
      type="primary"
      style="width:100%"
      @click="ClickStatusAction"
    ) {{ STATUS_CONFIG[driverStatus].action }}

    UiButton(
      v-if="driverStatus !== 'offline'"
      type="secondary"
      style="width:100%;margin-top:12px"
      @click="ClickGoOffline"
    ) 結束下線
</template>

<style lang="scss" scoped>
$font-display:   'Bebas Neue', sans-serif;
$font-condensed: 'Barlow Condensed', 'Noto Sans TC', sans-serif;
$font-body:      'Barlow', 'Noto Sans TC', sans-serif;

.PageDriverTrip {
  position: relative;
  min-height: 100vh;
  background: var(--da-dark);
  padding: 76px 20px 120px;
  overflow: hidden;
}

.PageDriverTrip__watermark {
  position: fixed;
  top: 80px; right: -10px;
  font-family: $font-display;
  font-size: 100px;
  color: #fff;
  opacity: 0.03;
  pointer-events: none;
  user-select: none;
  letter-spacing: 0.04em;
}

// ── 頁首 ──────────────────────────────────────────────────
.PageDriverTrip__header {
  margin-bottom: 32px;
}

.PageDriverTrip__header-label {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--da-amber);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  &::before {
    content: '';
    width: 20px; height: 1.5px;
    background: var(--da-amber);
  }
}

.PageDriverTrip__header-title {
  font-family: $font-display;
  font-size: 48px;
  color: #fff;
  letter-spacing: 0.02em;
  line-height: 0.9;
}

.PageDriverTrip__header-sub {
  font-family: $font-condensed;
  font-size: 11px;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 4px;
}

// ── 狀態卡 ────────────────────────────────────────────────
.PageDriverTrip__status-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 18px 20px;
  margin-bottom: 24px;

  &.is-online  { border-color: rgba(34, 197, 94, 0.3); }
  &.is-busy    { border-color: rgba(212, 134, 10, 0.4); }
  &.is-offline { border-color: rgba(255, 255, 255, 0.08); }
}

.PageDriverTrip__status-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;

  .is-online  & { background: #22c55e; box-shadow: 0 0 8px rgba(34, 197, 94, 0.6); }
  .is-busy    & { background: var(--da-amber); box-shadow: 0 0 8px rgba(212, 134, 10, 0.6); }
  .is-offline & { background: rgba(255, 255, 255, 0.2); }
}

.PageDriverTrip__status-label {
  font-family: $font-condensed;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #fff;
  flex: 1;
}

.PageDriverTrip__status-uploading {
  font-family: $font-condensed;
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--da-amber);
}

// ── GPS 資訊 ──────────────────────────────────────────────
.PageDriverTrip__gps {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 28px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.PageDriverTrip__gps-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.PageDriverTrip__gps-key {
  font-family: $font-condensed;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: rgba(255, 255, 255, 0.35);
}

.PageDriverTrip__gps-val {
  font-family: $font-condensed;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.05em;
}

.PageDriverTrip__gps-err {
  font-family: $font-body;
  font-size: 12px;
  color: #ef4444;
}

.PageDriverTrip__gps-waiting {
  font-family: $font-condensed;
  font-size: 12px;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
  padding: 8px 0;
}

// ── 操作按鈕 ──────────────────────────────────────────────
.PageDriverTrip__actions {
  display: flex;
  flex-direction: column;
}
</style>
