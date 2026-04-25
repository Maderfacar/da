<script setup lang="ts">
// OpenDialogVideoRecording // 錄製影片
// -- 引入 --------------------------------------------------------------------------------------------
const $option = UseOpenComOption();

// -- 資料 --------------------------------------------------------------------------------------------
type Props = {
  resolve: (file: File) => void; // 回傳影片檔案
}
const props = defineProps<Props>();

// 常數 ------------------------------------------------------------
const MAX_DURATION = 30; // 錄影最長秒數
// 使用者代理偵測（盡量簡單，避免外部依賴）
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isIOS = /iP(hone|od|ad)/.test(UA);
const isSafari = /^((?!chrome|android).)*safari/i.test(UA);
const isMobile = /Mobi|Android/i.test(UA) || isIOS;
const isMobileSafari = isIOS && isSafari;
const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false;

// 錄影相關狀態 --------------------------------------------
const videoRef = ref<HTMLVideoElement | null>(null); // 影片展示元素
const mediaStream = ref<MediaStream | null>(null); // 相機串流
const mediaRecorder = ref<MediaRecorder | null>(null); // 錄影器
const chunks = ref<BlobPart[]>([]); // 錄影暫存片段

const isRecording = ref(false); // 是否錄製中
const recordedBlob = ref<Blob | null>(null); // 錄製完成的影片 Blob
const recordedUrl = ref<string | null>(null); // Blob URL 用於預覽
const errorMsg = ref<string | null>(null); // 錯誤訊息

// UI 與邏輯狀態 -------------------------------------------------
const countdownSec = ref<number>(0); // 倒數秒數（30 秒）
let countdownTimer: number | null = null; // 計時器 id
const isPlaying = ref(false); // 是否正在播放（已錄製影片）
// iOS Safari 多數情況需要使用者手勢才能啟動相機
const needsUserGesture = ref<boolean>(false);

// 裝置切換 -------------------------------------------------------
const videoDevices = ref<MediaDeviceInfo[]>([]); // 所有可用攝影機
const currentDeviceId = ref<string | null>(null); // 目前使用的攝影機 deviceId
const currentFacing = ref<'user' | 'environment'>('user'); // 目前的鏡頭方向（行動裝置優先使用）

/** 取得視訊約束條件（優先使用 deviceId，其次使用 facingMode） */
const GetVideoConstraints = (): MediaStreamConstraints => {
  const video: MediaTrackConstraints = {};
  if (currentDeviceId.value) {
    video.deviceId = { exact: currentDeviceId.value } as ConstrainDOMString;
  } else if (currentFacing.value) {
    // 行動裝置：前鏡頭 user、後鏡頭 environment
    video.facingMode = { ideal: currentFacing.value } as ConstrainDOMString;
  }
  // 可加上解析度需求，例如： video.width = { ideal: 1280 }; video.height = { ideal: 720 };
  // 僅請求視訊，不需麥克風
  return { video, audio: false } as MediaStreamConstraints;
};

/** 切換鏡頭（前/後或不同 deviceId） */
const ToggleCamera = async (): Promise<void> => {
  if (isRecording.value) return; // 錄影中不允許切換

  // 優先使用多裝置輪替
  if (videoDevices.value.length >= 2) {
    const idx = videoDevices.value.findIndex((d) => d.deviceId === currentDeviceId.value);
    const nextIdx = (idx + 1) % videoDevices.value.length;
    currentDeviceId.value = videoDevices.value[nextIdx]?.deviceId ?? null;
    await StartCamera();
    return;
  }

  // 退而求其次：切換 facingMode
  currentDeviceId.value = null; // 清除固定 deviceId
  currentFacing.value = currentFacing.value === 'user' ? 'environment' : 'user';
  await StartCamera();
};

/** 枚舉可用攝影機清單 */
const EnumerateVideoDevices = async (): Promise<void> => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices.value = devices.filter((d) => d.kind === 'videoinput');
    // 若當前 deviceId 不存在於清單，重置
    if (currentDeviceId.value && !videoDevices.value.some((d) => d.deviceId === currentDeviceId.value)) {
      currentDeviceId.value = videoDevices.value[0]?.deviceId ?? null;
    }
  } catch (err: any) {
    ElMessage.error(err?.message ?? '無法取得裝置清單');
  }
};

// -- 函式（箭頭函式大駝峰） ---------------------------------------------------------------------------
/** 開始倒數（每秒 -1） */
const StartCountdown = (): void => {
  countdownSec.value = MAX_DURATION;
  ClearCountdown();
  countdownTimer = window.setInterval(() => {
    countdownSec.value = Math.max(0, countdownSec.value - 1);
    if (countdownSec.value <= 0) StopRecording();
  }, 1000);
};

/** 清除倒數計時器 */
const ClearCountdown = (): void => {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
};

/** 清理錄製結果與播放狀態（不動相機） */
const ClearRecordingState = (): void => {
  if (recordedUrl.value) URL.revokeObjectURL(recordedUrl.value);
  recordedUrl.value = null;
  recordedBlob.value = null;
  chunks.value = [];
  isPlaying.value = false;
};

/** 全面清理資源（相機/倒數/錄製狀態） */
const CleanupResources = (): void => {
  StopCamera();
  ClearCountdown();
  ClearRecordingState();
  mediaRecorder.value = null;
};

/** 啟動相機（僅預覽） */
const StartCamera = async (): Promise<void> => {
  try {
    // 先釋放既有相機
    StopCamera();
    // 依照目前裝置/方向申請攝影機權限（僅視訊）
    const constraints = GetVideoConstraints();
    // 基本環境檢查
    if (!('mediaDevices' in navigator) || !navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('此瀏覽器不支援相機存取（getUserMedia）', 'NotSupportedError');
    }
    if (!isSecure && location.hostname !== 'localhost') {
      // 非安全環境（HTTP）大多數瀏覽器會封鎖相機
      throw new DOMException('非安全連線（HTTPS）可能導致相機被封鎖，請改用 HTTPS 或 localhost。', 'SecurityError');
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    mediaStream.value = stream;

    // 顯示即時串流於 <video>
    const v = videoRef.value;
    if (v) {
      v.srcObject = stream;
      v.muted = true; // 避免回授
      // iOS/Safari 在未互動情境可能拒絕自動播放，故捕捉錯誤
      v.play().catch((err) => console.error(err));
    }
    // 啟動成功後枚舉裝置以便切換
    await EnumerateVideoDevices();
  } catch (err: any) {
    console.error(err);
    const name = err?.name as string | undefined;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      // 可能是使用者拒絕、或是缺乏使用者手勢
      errorMsg.value = '相機權限被拒絕，或需要使用者手勢啟動。請允許權限，或點擊下方「啟動相機」重試。';
      // 行動裝置上特別提示以點擊方式啟動
      if (isMobileSafari || isMobile) needsUserGesture.value = true;
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      errorMsg.value = '找不到可用的攝影機裝置。';
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      errorMsg.value = '裝置目前被其他應用程式占用，無法存取相機。';
    } else if (name === 'OverconstrainedError') {
      errorMsg.value = '目前裝置無法符合指定的相機條件，請嘗試切換鏡頭或移除限制。';
    } else if (name === 'SecurityError') {
      errorMsg.value = '瀏覽器安全性限制阻擋了相機存取，請確認使用 HTTPS 或在瀏覽器設定中允許權限。';
    } else {
      errorMsg.value = err?.message || '無法啟動相機，請檢查權限設定';
    }
    ElMessage.error(errorMsg.value || '無法啟動相機，請檢查權限設定');
  }
};

/** 釋放相機/麥克風資源 */
const StopCamera = (): void => {
  try {
    const v = videoRef.value;
    if (v) {
      v.pause();
      // 解除影片來源
      v.srcObject = null;
    }
    mediaStream.value?.getTracks().forEach((t) => t.stop());
  } finally {
    mediaStream.value = null;
  }
};

/** 建立 MediaRecorder（依瀏覽器支援選擇適合的 MIME） */
const CreateMediaRecorder = (): MediaRecorder | null => {
  const stream = mediaStream.value;
  if (!stream) return null;

  // 在未請求音訊（audio:false）情況下，優先選擇「純視訊」的 webm 編碼，以避免因含 opus 音訊編碼而報錯
  const mimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    // 'video/mp4' // 註：多數瀏覽器對 MediaRecorder + mp4 支援不佳，即使宣稱支援，實際常失敗
  ];
  let mimeType = '';
  for (const t of mimeTypes) {
    if ((window as any).MediaRecorder && MediaRecorder.isTypeSupported?.(t)) {
      mimeType = t;
      break;
    }
  }

  try {
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    return rec;
  } catch (err) {
    ElMessage.error('瀏覽器不支援錄影或媒體格式不被支援');
    return null;
  }
};

/** 開始錄影 */
const StartRecording = (): void => {
  if (!mediaStream.value) return;
  // 將「開始錄影」視為「重新拍攝」：清除舊結果並切回相機預覽
  ClearRecordingState();

  // 切回即時相機畫面
  const v = videoRef.value;
  if (v) {
    v.controls = false;
    v.muted = true;
    v.src = '';
    v.srcObject = mediaStream.value;
    v.play().catch((err) => console.error(err));
  }

  // 設置倒數
  StartCountdown();

  const rec = CreateMediaRecorder();
  if (!rec) return;

  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) chunks.value.push(e.data);
  };
  rec.onstop = () => {
    const blob = new Blob(chunks.value, { type: rec.mimeType || 'video/webm' });
    recordedBlob.value = blob;
    recordedUrl.value = URL.createObjectURL(blob);

    // 預覽錄製結果
    const v2 = videoRef.value;
    if (v2) {
      v2.srcObject = null;
      v2.muted = false;
      v2.src = recordedUrl.value || '';
      v2.controls = false; // TODO
      // 不自動播放，等待使用者按播放
      isPlaying.value = false;
    }
    isRecording.value = false;

    // 停止倒數
    ClearCountdown();
  };

  mediaRecorder.value = rec;
  isRecording.value = true;
  rec.start();

  // 倒數計時已由 StartCountdown 管理
};

/** 停止錄影 */
const StopRecording = (): void => {
  if (!mediaRecorder.value) return;
  if (mediaRecorder.value.state !== 'inactive') {
    mediaRecorder.value.stop();
  }
};

/** 點擊覆蓋播放按鈕（播放已錄製影片） */
const PlayRecorded = (): void => {
  videoRef.value?.play();
};

/** 點擊覆蓋停止按鈕（停止播放並回到起點） */
const StopPlayback = (): void => {
  const v = videoRef.value;
  if (!v) return;
  v.pause();
  v.currentTime = 0;
};

// 取消「重新拍攝」邏輯，改由 StartRecording 直接處理

/** 使用此影片（回傳 File 並關閉視窗） */
const UseRecorded = (): void => {
  if (!recordedBlob.value) return;
  const ext = (mediaRecorder.value?.mimeType || 'video/webm').includes('mp4') ? 'mp4' : 'webm';
  const fileName = `record_${Date.now()}.${ext}`;
  const file = new File([recordedBlob.value], fileName, { type: recordedBlob.value.type });
  // 回傳給外部
  props.resolve(file);
  // 關閉視窗
  $option.visible.value = false;
};
/** 對話框關閉（釋放資源） */
const OnDialogClosed = (): void => {
  try {
    if (isRecording.value) {
      try { mediaRecorder.value?.stop(); } catch(err) { console.error(err); }
    }
  } finally {
    CleanupResources();
  }
};
/** 由使用者手動啟動相機（解決行動版需要手勢的限制） */
const OnUserEnableCamera = async (): Promise<void> => {
  errorMsg.value = null;
  needsUserGesture.value = false;
  await StartCamera();
};

// -- 生命週期 -----------------------------------------------------------------------------------------
onMounted(() => {
  // 初始進入：行動 Safari 可能需要使用者手勢才允許 getUserMedia
  if (isMobileSafari) {
    needsUserGesture.value = true;
    // 若在 PWA/或某些版本仍可自動啟動，可讓使用者點按後再開始
  } else {
    // 桌機或非 iOS Safari 嘗試自動啟動
    StartCamera();
  }
});

onBeforeUnmount(() => {
  OnDialogClosed();
});

// -- 接收事件 -----------------------------------------------------------------------------------------
</script>

<template lang="pug">
ElDialogPlus.OpenDialogVideoRecording(
  v-model="$option.visible.value"
  type="info"
  width="400px"
  title="錄製影片"
  :hiddenHeader="true"
  :hiddenFooter="true"
  @on-close="OnDialogClosed"
)
  .video-area
    //- 操作/預覽區塊
    .video-box
      OpenDialogVideoRecordingPhoneCard
        video.video-el(
          ref="videoRef"
          playsinline
          :class="{'is-recording': isRecording || !recordedBlob }"
          @play="isPlaying = true"
          @pause="isPlaying = false"
          @ended="isPlaying = false"
        )
        //- 覆蓋播放/停止按鈕
        .overlay-group(v-if="recordedBlob")
          button.play-overlay(v-if="!isPlaying" @click="PlayRecorded()") ▶
          //- button.play-overlay(v-else @click="StopPlayback()") ■

    //- 倒數秒數（錄影中顯示）
    .countdown
      p(v-if="isRecording") 剩餘 {{ countdownSec }} 秒
    //- 倒數進度條（30 秒 -> 100% 到 0%）
    .countdown-bar
      .progress(v-if="isRecording" :style="{ width: (countdownSec / MAX_DURATION * 100) + '%' }")

    //- 提示與啟用相機／重試按鈕
    .tips
      p.warn(v-if="!isSecure") 本頁面非 HTTPS 安全環境，瀏覽器可能封鎖相機，請改用 HTTPS 或 localhost。
      p.error(v-if="errorMsg") {{ errorMsg }}
    
    .actions(v-if="(errorMsg && !needsUserGesture) || needsUserGesture" )
        button.btn(@click="OnUserEnableCamera()") 啟動相機

    //- 操作按鈕
    .actions(v-else)
      //- 錄影未開始時顯示開始錄影；錄影中顯示停止
      button.btn.record(@click="isRecording ? StopRecording() : StartRecording()")
        | {{ isRecording ? '停止錄影' : recordedBlob?'重新錄影':'開始錄影' }}
      button.btn.primary(v-if="recordedBlob && !isRecording" :disabled="!recordedBlob" @click="UseRecorded()") 使用這支影片
</template>

<style lang="scss" scoped>
// 佈局 ----
.video-area {
  // height: 80vh;
  overflow-y: auto;
  display: grid;
  grid-template-rows: auto auto 30px auto auto;
  gap: 10px;
}

.video-box {
  @include wh;
  max-width: 250px;
  margin: 0 auto;
}

.video-el {
  @include wh;
  object-fit: cover;
  display: block;
  // height: 50vh;
  // border-radius: 12px;
  background: #000;
  // 自拍鏡像顯示（僅影響預覽與回放，不改變輸出檔案）
  transform: scaleX(-1);
  backface-visibility: hidden;
}

.is-recording {
  // transform: scaleX(-1);
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn {
  @include fs(16px, 700);
  padding: 10px 10px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background: #e5e7eb; // gray-200
  color: #111827; // gray-900
  &.record { background: $err; color: #fff; } // red-500
  &.roteate { 
    @include wh(48px);
    @include center;
    border-radius: 100px;
    background: #9ca3af; 
    color: #fff;
   } // gray-400
  &.primary { background: $primary; color: #fff; } // emerald-500
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

// 提示訊息區塊 ----
.tips {
  margin: 6px auto 0;
  max-width: 420px;
  text-align: center;
  .warn {
    @include fs(14px, 600);
    color: #b45309; // amber-700
    background: #fef3c7; // amber-100
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 6px;
  }
  .error {
    @include fs(14px, 600);
    color: #991b1b; // red-800
    background: #fee2e2; // red-100
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 8px;
  }
}

// 覆蓋播放按鈕 ----
.play-overlay {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

// 倒數顯示（數字與進度條）
.countdown {
  @include center;
  @include fs(24px, 700);
  color: $primary; // gray-900
}

.countdown-bar {
  width: 100%;
  height: 8px;
  background: #e5e7eb; // gray-200
  border-radius: 9999px;
  overflow: hidden;
}

.countdown-bar .progress {
  height: 100%;
  background: $primary; // amber-500
  transition: width 0.2s linear;
}
</style>
