// P19：driver 端統一定位 composable
//
// 設計目標：
// - layout 層級啟動，整 driver 端期間共用一個 watchPosition + 上傳 loop
// - 上傳節流：5m 距離 + 60s 強制 force refresh + 50m accuracy filter
// - status 變更（接訂單操作）強制立即上傳一次
// - unmount 時 clearWatch 防 leak
//
// 由於 Nuxt 自動匯入 composables/**，匯出 useDriverGeolocation 即可在任何 component 內使用。
// 但本實作以「全域 singleton」為前提（同時多個呼叫者 share 同一份 state），所以底層 state
// 用模組級 closure，不在 composable 內 new ref。

const PERMISSION_TIMEOUT_MS = 5_000;       // 等使用者答覆授權的上限
const UPLOAD_DISTANCE_THRESHOLD_M = 5;     // 5m 距離 threshold
const UPLOAD_FORCE_REFRESH_MS = 60_000;    // 60s 強制 force refresh
const ACCURACY_FILTER_M = 50;              // accuracy > 50m 不上傳

type PermissionState = 'pending' | 'granted' | 'denied';

interface CurrentPos {
  lat: number;
  lng: number;
  heading: number | null;
  accuracy: number;
  receivedAt: number;
}

// 模組級 state（singleton）
const _permissionState = ref<PermissionState>('pending');
const _currentPos = ref<CurrentPos | null>(null);
let _watchId: number | null = null;
let _lastUploadedPos: CurrentPos | null = null;
let _lastUploadAt = 0;
let _uploading = false;

// Haversine 距離計算（公尺）
function _distanceMeters(a: CurrentPos, b: CurrentPos): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function _DoUpload(pos: CurrentPos): Promise<void> {
  if (_uploading) return; // 避免併發
  const authStore = StoreAuth();
  const uid = authStore.user?.uid;
  if (!uid) return;

  _uploading = true;
  try {
    await $api.UpdateDriverLocation(uid, {
      lat: pos.lat,
      lng: pos.lng,
      heading: pos.heading ?? undefined,
      accuracy: pos.accuracy,
      displayName: authStore.lineProfile?.displayName ?? '',
      // status 缺省 → server 推導（有執行中訂單則 busy；否則 online）
    });
    _lastUploadedPos = pos;
    _lastUploadAt = Date.now();
  } catch (err) {
    console.error('[useDriverGeolocation] upload failed:', err);
  } finally {
    _uploading = false;
  }
}

function _shouldUpload(pos: CurrentPos): boolean {
  // accuracy > 50m → cold start 期間不上傳，等收斂
  if (pos.accuracy > ACCURACY_FILTER_M) return false;
  // 第一次必傳
  if (!_lastUploadedPos) return true;
  // 距離 >= 5m 必傳
  if (_distanceMeters(pos, _lastUploadedPos) >= UPLOAD_DISTANCE_THRESHOLD_M) return true;
  // 距離不足但時間 >= 60s → force refresh（war-room alive ping）
  if (Date.now() - _lastUploadAt >= UPLOAD_FORCE_REFRESH_MS) return true;
  return false;
}

function _PositionSuccess(geoPos: GeolocationPosition): void {
  const pos: CurrentPos = {
    lat: geoPos.coords.latitude,
    lng: geoPos.coords.longitude,
    heading: geoPos.coords.heading,
    accuracy: geoPos.coords.accuracy,
    receivedAt: Date.now(),
  };
  _currentPos.value = pos;
  if (_shouldUpload(pos)) _DoUpload(pos);
}

function _PositionError(err: GeolocationPositionError): void {
  console.error('[useDriverGeolocation] position error:', err.code, err.message);
  if (err.code === err.PERMISSION_DENIED) {
    _permissionState.value = 'denied';
    _StopWatch();
  }
}

function _StopWatch(): void {
  if (_watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(_watchId);
    _watchId = null;
  }
}

export function useDriverGeolocation() {
  /**
   * 觸發瀏覽器 / LINE WebView 授權框；resolve 'granted' / 'denied' / 'timeout'
   * timeout 預設 5 秒（PERMISSION_TIMEOUT_MS）。
   *
   * 拒絕第二次後 caller 應 navigateTo('/home')。
   */
  const RequestPermission = (): Promise<'granted' | 'denied' | 'timeout'> => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      _permissionState.value = 'denied';
      return Promise.resolve('denied');
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: 'granted' | 'denied' | 'timeout') => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const timeoutId = setTimeout(() => {
        settle('timeout');
      }, PERMISSION_TIMEOUT_MS);

      navigator.geolocation.getCurrentPosition(
        (geoPos) => {
          clearTimeout(timeoutId);
          _permissionState.value = 'granted';
          // 第一次拿到座標也順便當作 init
          _PositionSuccess(geoPos);
          settle('granted');
        },
        (err) => {
          clearTimeout(timeoutId);
          if (err.code === err.PERMISSION_DENIED) {
            _permissionState.value = 'denied';
            settle('denied');
          } else {
            // POSITION_UNAVAILABLE / TIMEOUT 仍視為拒絕（無法定位等同無法使用）
            _permissionState.value = 'denied';
            settle('denied');
          }
        },
        { enableHighAccuracy: true, timeout: PERMISSION_TIMEOUT_MS, maximumAge: 0 },
      );
    });
  };

  /**
   * 啟動 watchPosition 持續監聽 + 自動節流上傳。
   * 只能在 permission='granted' 後呼叫。
   */
  const StartWatch = (): void => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    if (_watchId !== null) return; // 已啟動，避免重複
    _watchId = navigator.geolocation.watchPosition(
      _PositionSuccess,
      _PositionError,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
  };

  /**
   * 停止 watch + 重置 state。
   * driver layout onUnmounted 時呼叫。
   */
  const StopWatch = (): void => {
    _StopWatch();
    _currentPos.value = null;
    _lastUploadedPos = null;
    _lastUploadAt = 0;
    // permission state 不重置（同 session 內離開 driver 端再回來不該重彈授權框）
  };

  /**
   * 強制立即上傳一次當前座標，跳過 5m / 60s / accuracy 檢查。
   * driver 操作訂單按鈕（前往/到點/上車/下車）時呼叫，
   * 讓 war-room 看到該關鍵節點的精確位置。
   *
   * 若尚未取得任何座標 → 不做任何事（log warn）；caller 不需 await error。
   */
  const UploadNow = async (): Promise<void> => {
    if (!_currentPos.value) {
      console.warn('[useDriverGeolocation] UploadNow called but no currentPos yet');
      return;
    }
    await _DoUpload(_currentPos.value);
  };

  return {
    permissionState: readonly(_permissionState),
    currentPos: readonly(_currentPos),
    RequestPermission,
    StartWatch,
    StopWatch,
    UploadNow,
  };
}
