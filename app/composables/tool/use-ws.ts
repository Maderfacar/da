/*
 * WebSocket 工具（Nuxt/Vue 可組合式函式）
 * 功能：
 * - 自動重連（帶指數退避、上限控制）
 * - 心跳機制（定時 ping，逾時或多次未回應則視為異常重連）
 * - 處理瀏覽器分頁切換、行動裝置待機、網路離線/恢復
 * - 若達到即時重連次數上限，會進入被動等待模式，當網路或頁面回到健康狀態時自動恢復連線
 * - SSR 安全保護（僅在瀏覽器執行）
 * 
 * 使用方式：
 * const ws = UseWS('wss://example.com/ws', { OnMessage: (ev, payload) => { ... } });
 * ws.connect();
 * ws.sendJSON({ type: 'hello' });
 */

export type WSData = string | ArrayBufferLike | Blob | ArrayBufferView;
/**
 * WebSocket 工具選項
 *
 * 注意：本模組僅負責連線管理與事件轉交，所有業務邏輯（如文字解析、訊息路由）請在模組外部處理。
 */
export interface UseWSOptions {
  /** 建立連線時使用的 protocols（原生 WebSocket 參數） */
  protocols?: string | string[]
  /** 是否在 onBeforeUnmount 中移除 */
  canDispose?: boolean
  /** 是否自動連線 */
  autoConnect?: boolean
  /** 關閉後是否嘗試重連 */
  reconnectOnClose?: boolean

  // 重連策略
  /** 初始延遲 */
  initialBackoffMs?: number
  /** 乘數 */
  backoffFactor?: number
  /** 單次最大延遲 */
  maxBackoffMs?: number
  /** 立即重試上限（達標後轉為被動等待） */
  maxImmediateRetries?: number

  /** 心跳間隔 */
  heartbeatIntervalMs?: number
  /** 心跳等待回應逾時 */
  heartbeatTimeoutMs?: number
  /** 發送內容 */
  heartbeatMsg?: string | (() => WSData)
  /** 是否期待服務端回 Pong（若為 false，則以任何訊息視為活躍） */
  expectPong?: boolean

  // JSON 解析/發送
  parseJSON?: boolean // 收到訊息嘗試 JSON.parse

  // 事件回呼
  OnOpen?: (ev: Event) => void
  OnClose?: (ev: CloseEvent) => void
  OnError?: (ev: Event) => void
  OnMessage?: (ev: MessageEvent, parsed: unknown | null) => void
}

/**
 * 建立 WebSocket 管理器（可重用）
 *
 * - 僅管理連線生命周期（連線、重連、心跳、離線/分頁切換），不涉入訊息內容處理。
 * - 對外暴露 Connect/Disconnect/Send/SendJSON/SetURL/Dispose 等方法。
 * - OnMessage 僅轉交原始事件與可選的 JSON 解析結果，實際處理請留在外部。
 *
 * @param initialURL 預設連線 URL
 * @param options    行為設定（重連/心跳/事件回呼等）
 */
export const UseWS = (initialURL: string, options: UseWSOptions = {}) => {
  // 基礎設定 -----------------------------
  /** 判斷是否支持 WebSocket */
  const isSupported = computed(() => import.meta.client && typeof WebSocket !== 'undefined');
  /** ws url */
  const urlRef = ref(initialURL);
  /** ws instance */
  const wsRef = shallowRef<WebSocket | null>(null);
  /** ws protocols（可於執行期更新） */
  const protocolsRef = ref<string | string[] | undefined>(options.protocols);
  /** 是否在 onBeforeUnmount 中移除銷毀 websocket */
  const canDispose = options.canDispose ?? true;

  // 連線狀態 -----------------------------
  /** 連線中 */
  const isConnecting = ref(false);
  /** 連線完成 */
  const isConnected = ref(false);
  /** 重連次數 */
  const retryCount = ref(0);
  /** 最後錯誤 */
  const lastError = ref<unknown>(null);
  /** 最後訊息 */
  const lastMessage = ref<MessageEvent | null>(null);
  /** WebSocket 狀態 */
  const readyState = ref<number | null>(null);

  // 重連控制 -----------------------------
  /** 初始延遲 */
  const initialBackoffMs = options.initialBackoffMs ?? 1000;
  /** 乘數 */
  const backoffFactor = options.backoffFactor ?? 1.6;
  /** 單次最大延遲 */
  const maxBackoffMs = options.maxBackoffMs ?? 30000;
  /** 立即重試上限（達標後轉為被動等待） */
  const maxImmediateRetries = options.maxImmediateRetries ?? 10;

  // 心跳控制 -----------------------------
  /** 心跳間隔 */
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25000;
  /** 心跳等待回應逾時 */
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10000;
  /** 發送內容 */
  const heartbeatMsg = options.heartbeatMsg ?? 'ping';
  /** 是否期待服務端回 Pong（若為 false，則以任何訊息視為活躍） */
  const expectPong = options.expectPong ?? false;
  /** 關閉後是否嘗試重連 */
  const reconnectOnClose = options.reconnectOnClose ?? true;
  /** 是否自動連線 */
  const autoConnect = options.autoConnect ?? true;
  /** JSON 解析 */
  const parseJSON = options.parseJSON ?? true;

  // 計時器 -----------------------------
  /** 重連計時器 */
  let reconnectTimer: number | null = null;
  /** 心跳間隔計時器 */
  let heartbeatIntervalId: number | null = null;
  /** 心跳逾時計時器 */
  let heartbeatTimeoutId: number | null = null;
  /** 健康檢查定時器（守護進程） */
  let healthCheckIntervalId: number | null = null;
  /** 連線建立超時計時器（CONNECTING > timeout 自動關閉） */
  let connectingTimeoutId: number | null = null;

  // 標記 -----------------------------
  /** 是否已銷毀 */
  let disposed = false;
  /** 是否進入被動等待模式 */
  let passiveWaitMode = false; // 達到 maxImmediateRetries 後，改為被動等待（online/可見時再啟動）
  /** 是否主動關閉 */
  const suppressedClose = ref(false); // 主動 disconnect 不觸發重連

  // -----------------------------------------------------------------------------------------------
  /** 計算指數退避延遲時間（毫秒） */
  const CalcBackoff = () => {
    const exp = Math.min(retryCount.value, 10);
    const delay = Math.min(initialBackoffMs * Math.pow(backoffFactor, exp), maxBackoffMs);
    return Math.floor(delay);
  };

  /** 清除重連計時器 */
  const ClearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  /** 清除心跳相關計時器 */
  const ClearHeartbeat = () => {
    if (heartbeatIntervalId !== null) {
      window.clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
    if (heartbeatTimeoutId !== null) {
      window.clearTimeout(heartbeatTimeoutId);
      heartbeatTimeoutId = null;
    }
  };

  /**
   * 啟動心跳：週期性傳送 ping（或自訂內容），若逾時未獲回應則強制關閉以觸發重連。
   * 注意：實際『pong』字串或回應格式由後端決定。若 expectPong=false，則任一訊息都會被視為活躍以清除逾時計時。
   */
  const StartHeartbeat = () => {
    if (!isSupported.value || !wsRef.value) return;
    ClearHeartbeat();
    // 定時傳送心跳
    heartbeatIntervalId = window.setInterval(() => {
      // 若非連線狀態則不送
      if (!wsRef.value || wsRef.value.readyState !== WebSocket.OPEN) return;

      try {
        const payload = typeof heartbeatMsg === 'function' ? heartbeatMsg() : heartbeatMsg;
        wsRef.value.send(payload as WSData);
      } catch { /* 忽略發送錯誤，等待下次心跳 */ }

      // 設定心跳回應逾時計時
      if (heartbeatTimeoutId !== null) window.clearTimeout(heartbeatTimeoutId);
      heartbeatTimeoutId = window.setTimeout(() => {
        // 視為心跳失敗，強制關閉以觸發重連
        try { wsRef.value?.close(); } catch { /* ignore */ }
      }, heartbeatTimeoutMs);
    }, heartbeatIntervalMs);
  };

  /** 停止心跳 */
  const StopHeartbeat = () => {
    ClearHeartbeat();
  };

  /** 啟動健康檢查：定期檢查連線狀態，若發現關閉或不存在則嘗試恢復 */
  const StartHealthCheck = () => {
    if (!import.meta.client) return;
    if (healthCheckIntervalId !== null) window.clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = window.setInterval(() => {
      if (!isSupported.value || disposed) return;
      const state = wsRef.value?.readyState;
      // 若無連線或已關閉且非主動關閉，主動嘗試恢復
      if ((wsRef.value == null || state === WebSocket.CLOSED) && !suppressedClose.value) {
        TryResumeIfEligible();
      }
    }, 5000);
  };

  /** 任一訊息抵達時，視為連線存活，清除心跳逾時計時（在不期待特定 pong 時） */
  const NotifyAlive = () => {
    // 任一訊息視為連線仍存活（若不期待特定 pong）
    if (!expectPong && heartbeatTimeoutId !== null) {
      window.clearTimeout(heartbeatTimeoutId);
      heartbeatTimeoutId = null;
    }
  };

  const ClearConnectingTimeout = () => {
    if (connectingTimeoutId !== null) window.clearTimeout(connectingTimeoutId);
    connectingTimeoutId = null;
  };

  /** 建立並初始化 WebSocket 實例，綁定事件處理，並在 onopen 後重置重連與啟動心跳 */
  const SetupWS = () => {
    if (!isSupported.value || disposed) return;
    if (wsRef.value && (wsRef.value.readyState === WebSocket.OPEN || wsRef.value.readyState === WebSocket.CONNECTING)) return;

    isConnecting.value = true;
    lastError.value = null;
    readyState.value = WebSocket.CONNECTING;

    try {
      const ws = new WebSocket(urlRef.value, protocolsRef.value as any);
      wsRef.value = ws;
      // 設定連線建立超時：若 10 秒仍未 onopen，主動關閉以觸發重連
      if (connectingTimeoutId !== null) window.clearTimeout(connectingTimeoutId);
      connectingTimeoutId = window.setTimeout(() => {
        try { wsRef.value?.close(); } catch { /* ignore */ }
      }, 10000);
      // -- onopen ----------------------------
      ws.onopen = (ev) => {
        isConnecting.value = false;
        isConnected.value = true;
        readyState.value = ws.readyState;
        retryCount.value = 0;
        passiveWaitMode = false;
        ClearReconnectTimer();
        StartHeartbeat();
        // 清除連線超時計時器
        ClearConnectingTimeout();
        // 連上後嘗試清空緩存佇列
        options.OnOpen?.(ev);
      };

      // -- onmessage ----------------------------
      ws.onmessage = (ev) => {
        if (!ev.data) return;
        lastMessage.value = ev;
        // 心跳活性通知
        NotifyAlive();

        let parsed: unknown | null = null;
        if (parseJSON && typeof ev.data === 'string') {
          try { parsed = JSON.parse(ev.data); } catch { parsed = null; }
        }

        // 若預期 pong，嘗試辨識簡單 'pong'
        if (expectPong && typeof ev.data === 'string') {
          if (ev.data.toLowerCase?.() === 'pong') {
            if (heartbeatTimeoutId !== null) {
              window.clearTimeout(heartbeatTimeoutId);
              heartbeatTimeoutId = null;
            }
          }
        }
        options.OnMessage?.(ev, parsed);
      };

      // -- onerror ----------------------------
      ws.onerror = (ev) => {
        lastError.value = ev;
        options.OnError?.(ev);
        // 在部分環境下，error 可能不一定伴隨 close 事件，為保險起見主動嘗試恢復
        if (!disposed && !suppressedClose.value && reconnectOnClose) {
          // 讓瀏覽器有機會自行觸發 onclose，再補一次檢查
          window.setTimeout(() => {
            TryResumeIfEligible();
          }, 300);
        }
      };

      // -- onclose ----------------------------
      ws.onclose = (ev) => {
        isConnecting.value = false;
        isConnected.value = false;
        readyState.value = ws.readyState;
        StopHeartbeat();
        // 清除連線超時計時器
        ClearConnectingTimeout();
        options.OnClose?.(ev);

        if (disposed || suppressedClose.value) return;
        if (!reconnectOnClose) return;

        // 排程重連
        ScheduleReconnect();
      };
    } catch (err) {
      isConnecting.value = false;
      isConnected.value = false;
      lastError.value = err;
      ScheduleReconnect();
    }
  };

  /** 排程重連：未達上限則依退避時間重試；達上限則轉為被動等待（等待 online/visible 後再恢復） */
  const ScheduleReconnect = () => {
    if (!isSupported.value || disposed) return;

    ClearReconnectTimer();

    // 達到上限改為被動等待（不繼續指數退避），直到網路恢復/頁面返回可見。
    if (retryCount.value >= maxImmediateRetries) {
      passiveWaitMode = true;
      return;
    }

    const delay = CalcBackoff();
    retryCount.value += 1;
    reconnectTimer = window.setTimeout(() => {
      SetupWS();
    }, delay);
  };

  /** 嘗試恢復連線：需同時滿足「網路在線」與「頁面可見」。若處於被動等待模式，恢復前會重置計數 */
  const TryResumeIfEligible = () => {
    if (!isSupported.value || disposed) return;
    if (isConnected.value || isConnecting.value) return;
    // 僅在網路在線且頁面可見時嘗試
    const online = navigator.onLine !== false;
    const visible = document.visibilityState === 'visible';
    if (!online || !visible) return;
    // 若處於被動等待模式，重置重試次數並嘗試立即連線
    if (passiveWaitMode) {
      retryCount.value = 0;
      passiveWaitMode = false;
    }
    SetupWS();
  };

  // 公開 API -----------------------------
  /** 主動發起連線或在條件符合時恢復連線 */
  const Connect = () => {
    if (!isSupported.value) return;
    suppressedClose.value = false;
    TryResumeIfEligible();
  };

  /**
   * 主動關閉連線並停止重連。
   * @param code   WebSocket 關閉碼
   * @param reason 關閉原因
   */
  const Disconnect = (code?: number, reason?: string) => {
    if (!isSupported.value) return;
    suppressedClose.value = true;
    ClearReconnectTimer();
    StopHeartbeat();
    retryCount.value = 0;
    try {
      wsRef.value?.close(code, reason);
    } catch { /* ignore */ }
    wsRef.value = null;
    isConnected.value = false;
    isConnecting.value = false;
    ClearConnectingTimeout();
    readyState.value = WebSocket.CLOSED;
  };

  /** 更新 URL（不會自動連線，請搭配 ForceReconnect 使用） */
  const SetURL = (nextUrl: string) => {
    urlRef.value = nextUrl;
  };

  /** 更新 Protocols（例如更新 Token），不會自動連線，請搭配 ForceReconnect 使用） */
  const SetProtocols = (nextProtocols?: string | string[]) => {
    protocolsRef.value = nextProtocols;
  };

  /** 傳送原始資料（字串/二進位）。 回傳是否成功送出（需連線為 OPEN） */
  const Send = (data: WSData) => {
    if (!isSupported.value) return false;
    const ws = wsRef.value;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(data); return true; } catch { return false; }
  };

  /** 傳送 JSON 物件（外部仍可選擇改用 Send 以自行序列化） */
  const SendJSON = (obj: any) => {
    try { return Send(JSON.stringify(obj)); } catch { return false; }
  };

  /**
   * 清理資源：移除事件監聽並關閉連線（通常於組件卸載時呼叫）。
   * @description 移除網路、可見度變更、頁面生命週期事件監聽，並關閉 WebSocket 連線。
   */
  const Dispose = () => {
    disposed = true;
    if (import.meta.client) {
      window.removeEventListener('online', HandleOnline);
      window.removeEventListener('offline', HandleOffline);
      document.removeEventListener('visibilitychange', HandleVisibility);
      window.removeEventListener('pageshow', HandlePageShow);
      window.removeEventListener('pagehide', HandlePageHide);
    }
    ClearReconnectTimer();
    StopHeartbeat();
    if (healthCheckIntervalId !== null) {
      window.clearInterval(healthCheckIntervalId);
      healthCheckIntervalId = null;
    }
    ClearConnectingTimeout();

    try { wsRef.value?.close(); } catch { /* ignore */ }
    wsRef.value = null;
    readyState.value = null;
  };

  // 強制重連：清除被動等待與重試次數並立即嘗試連線
  const ForceReconnect = () => {
    if (!isSupported.value) return;
    passiveWaitMode = false;
    retryCount.value = 0;
    ClearReconnectTimer();
    SetupWS();
  };

  // 事件處理：網路
  /** 網路恢復事件：嘗試恢復連線 */
  const HandleOnline = () => {
    // 網路恢復時嘗試恢復
    TryResumeIfEligible();
  };

  /** 網路離線事件：立即關閉，待恢復時再重連 */
  const HandleOffline = () => {
    // 立即關閉，等恢復時再重連
    try {
      readyState.value = WebSocket.CLOSING;
      wsRef.value?.close();
    } catch { /* ignore */ }
  };

  // 事件處理：頁面可見度
  /** 頁面可見度變更：回到前景時嘗試恢復；進入背景時可暫停心跳以節能 */
  const HandleVisibility = () => {
    if (document.visibilityState === 'visible') {
      // 回到前景：嘗試恢復
      TryResumeIfEligible();
    } else {
      // 進入背景：可選擇暫停心跳以節能
      StopHeartbeat();
    }
  };

  // 事件處理：行動裝置/瀏覽器 Page Lifecycle
  /** PageShow（含 bfcache 返回）事件：回到頁面時立即驗證並恢復 */
  const HandlePageShow = (ev: PageTransitionEvent) => {
    // persisted 為 true 代表從 bfcache 回來，應立即驗證並恢復
    TryResumeIfEligible();
  };
  /** PageHide 事件：背景長時間可能凍結計時器，先清理計時器並嘗試關閉 */
  const HandlePageHide = () => {
    // 某些瀏覽器在背景長時間會凍結計時器，確保關閉以便稍後恢復
    // 但不要進入 suppressed 模式，讓 onshow 能立即恢復
    ClearReconnectTimer();
    StopHeartbeat();
    try { wsRef.value?.close(); } catch { /* ignore */ }
  };

  // -----------------------------------------------------------------------------------------------
  onMounted(() => {
    if (!isSupported.value) return;
    window.addEventListener('online', HandleOnline);
    window.addEventListener('offline', HandleOffline);
    document.addEventListener('visibilitychange', HandleVisibility);
    window.addEventListener('pageshow', HandlePageShow);
    window.addEventListener('pagehide', HandlePageHide);
    if (autoConnect) Connect();
    StartHealthCheck();
  });

  onBeforeUnmount(() => {
    if (!isSupported.value) return;
    if (canDispose) {
      Dispose();
    }
  });

  // -----------------------------------------------------------------------------------------------
  // 派發只讀引用
  return {
    /** 是否支援 WebSocket */
    isSupported,
    /** 是否正在連線 */
    isConnecting,
    /** 是否已連線 */
    isConnected,
    /** WebSocket 狀態 */
    readyState,
    /** 重試次數 */
    retryCount,
    /** 最後錯誤 */
    lastError,
    /** 最後訊息 */
    lastMessage,
    /** 是否主動關閉 */
    suppressedClose,

    /** 連線 */
    Connect,
    /** 主動關閉 */
    Disconnect,
    /** 更新 URL */
    SetURL,
    /** 更新 Protocols */
    SetProtocols,
    /** 發送 */
    Send,
    /** 發送 JSON */
    SendJSON,
    /** 釋放 */
    Dispose,
    /** 強制重連 */
    ForceReconnect,
  };
};
