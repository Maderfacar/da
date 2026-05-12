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

// P19 hotfix：5 秒 timeout 對真實 UX 太緊（使用者讀完授權彈框文字 + 決定 + 點擊都需時間），
// 改 30 秒。實測 Chrome / LINE WebView 第一次授權彈框平均 8-15 秒；30 秒給充分緩衝且仍有上限。
const PERMISSION_TIMEOUT_MS = 30_000;
// P19 hotfix（threshold 調整）：
// - 5m 距離 → 10m：GPS noise 平均 ±5-10m，5m threshold 讓靜止司機也偶爾觸發小幅抖動更新
//   且車輛 5m 級距太密（典型行進 1 秒 14m / 50km/h 級），10m 更貼近實際移動
// - accuracy 50m → 100m：LINE WebView 內 GPS 精度典型 30-100m，cold start 可達 200m+；
//   50m 太嚴會在弱訊號 / 第一次 fix 全部 skip → 司機位置卡在最初不準的座標永不更新；
//   100m 仍能擋掉真正爛的 fix（>100m 通常 GPS 完全不可信）
const UPLOAD_DISTANCE_THRESHOLD_M = 10;
const ACCURACY_FILTER_M = 100;
// 2026/05/12：司機登入後背景 ping 改為 30s 主動上傳一次（不依賴位置變化觸發）
// 舊版用 watchPosition + 60s force refresh，依賴 GPS tick 才會觸發；若 LINE WebView 暫停 watch
// 或司機靜止超過 60s 不動 → admin war-room 可能看到「司機消失」誤判。
// 新版獨立 setInterval 30s ping：watchPosition 仍維持移動 10m+ 立即上傳（即時性），
// setInterval 保證靜止時每 30s 至少 ping 一次（用最新一次 watch 的座標）。
const BACKGROUND_PING_INTERVAL_MS = 30_000;

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
let _backgroundPingId: ReturnType<typeof setInterval> | null = null;
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
  if (!uid) {
    console.warn('[useDriverGeolocation] skip upload: no auth uid yet');
    return;
  }

  _uploading = true;
  try {
    // methods.put 用 .catch((err)=>err) 把 reject 包成 resolve；
    // 必須檢查 res.status.code 才知道是否真的成功
    const res = await $api.UpdateDriverLocation(uid, {
      lat: pos.lat,
      lng: pos.lng,
      heading: pos.heading ?? undefined,
      accuracy: pos.accuracy,
      displayName: authStore.lineProfile?.displayName ?? '',
      // status 缺省 → server 推導（有執行中訂單則 busy；否則 online）
    });
    const code = res?.status?.code;
    if (code !== 200) {
      console.error('[useDriverGeolocation] upload returned error:', code, res?.status?.message);
      // 不更新 _lastUploadedPos / _lastUploadAt，下次 watch tick 會再嘗試
      return;
    }
    const isFirst = _lastUploadedPos === null;
    _lastUploadedPos = pos;
    _lastUploadAt = Date.now();
    if (isFirst) {
      // 首次上傳成功僅 log 一次，方便確認 driver 端確實開始送資料
      console.info('[useDriverGeolocation] first upload succeeded', {
        lat: pos.lat.toFixed(5),
        lng: pos.lng.toFixed(5),
        accuracy: pos.accuracy,
      });
    }
  } catch (err) {
    console.error('[useDriverGeolocation] upload threw exception:', err);
  } finally {
    _uploading = false;
  }
}

function _shouldUpload(pos: CurrentPos): boolean {
  // accuracy > 100m → cold start 期間不上傳，等收斂
  if (pos.accuracy > ACCURACY_FILTER_M) return false;
  // 第一次必傳
  if (!_lastUploadedPos) return true;
  // 距離 >= 10m 必傳（移動觸發；靜止時靠 _StartBackgroundPing 每 30s 強制上傳）
  if (_distanceMeters(pos, _lastUploadedPos) >= UPLOAD_DISTANCE_THRESHOLD_M) return true;
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

// 背景定時 ping：司機登入後每 30s 主動把當前最新座標上傳一次
// 與 watchPosition 雙軌：watch 負責移動 10m+ 立即上傳，ping 負責靜止保險
// 不重複套用 _shouldUpload accuracy/距離過濾（強制當前最新值上傳，讓 admin war-room 有 freshness）
function _StartBackgroundPing(): void {
  if (_backgroundPingId !== null) return;
  _backgroundPingId = setInterval(() => {
    if (_currentPos.value) {
      _DoUpload(_currentPos.value);
    }
  }, BACKGROUND_PING_INTERVAL_MS);
}

function _StopBackgroundPing(): void {
  if (_backgroundPingId !== null) {
    clearInterval(_backgroundPingId);
    _backgroundPingId = null;
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
   * 啟動 watchPosition 持續監聽 + 30s 背景定時 ping。
   * 只能在 permission='granted' 後呼叫。
   *
   * 雙軌設計：
   * - watchPosition：移動 10m+ 立即上傳（即時性，位置變化驅動）
   * - background ping：每 30s 主動把當前座標上傳（保險，時間驅動）
   */
  const StartWatch = (): void => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    if (_watchId !== null) return; // 已啟動，避免重複
    _watchId = navigator.geolocation.watchPosition(
      _PositionSuccess,
      _PositionError,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    _StartBackgroundPing();
  };

  /**
   * 停止 watch + 背景 ping + 重置 state。
   * driver layout onUnmounted 時呼叫。
   */
  const StopWatch = (): void => {
    _StopWatch();
    _StopBackgroundPing();
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
