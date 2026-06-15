/**
 * UseAskForPin — admin 敏感操作 PIN step-up auth 二次確認。
 *
 * 使用方式（在 click handler 內）：
 *   const { askForPin } = UseAskForPin();
 *   const token = await askForPin();
 *   if (!token) return;            // 使用者取消
 *   await $api.PatchSomeSensitive(...);  // 後續呼叫已自動帶 X-Admin-Pin-Session header
 *
 * 內部行為：
 *   1. 檢查 sessionStorage 'da_admin_pin_session'（+ '_exp' 留 30s buffer）；若未過期直接回 token
 *   2. 否則彈 PinPrompt → 使用者輸 4-8 位 PIN → 呼 /admin/pin/verify
 *   3. 成功寫 sessionStorage + 回 token；失敗顯示錯誤訊息留在彈窗
 *   4. 使用者取消 → 回 null
 *
 * Module-level singleton state — askForPin() 同時被多處呼叫時共用同一個彈窗實例。
 * PinPrompt.vue 透過同一個 composable 讀 _visible/_busy/_errorMsg 並驅動 UI。
 */
const SESSION_KEY = 'da_admin_pin_session';
const SESSION_EXP_KEY = 'da_admin_pin_session_exp';
const SESSION_TTL_MS = 5 * 60 * 1000;
const CLIENT_BUFFER_MS = 30 * 1000; // 30s 提前 expire 留 buffer，避免 server 端剛過期 race

// module-level reactive state（singleton）
const _visible = ref(false);
const _busy = ref(false);
const _errorMsg = ref('');
let _resolve: ((token: string | null) => void) | null = null;

const _readCachedToken = (): string | null => {
  if (typeof sessionStorage === 'undefined') return null;
  const token = sessionStorage.getItem(SESSION_KEY);
  const expStr = sessionStorage.getItem(SESSION_EXP_KEY);
  if (!token || !expStr) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_EXP_KEY);
    return null;
  }
  return token;
};

const _writeToken = (token: string) => {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(SESSION_KEY, token);
  sessionStorage.setItem(SESSION_EXP_KEY, String(Date.now() + SESSION_TTL_MS - CLIENT_BUFFER_MS));
};

export const UseAskForPin = () => {
  const askForPin = (): Promise<string | null> => {
    const cached = _readCachedToken();
    if (cached) return Promise.resolve(cached);
    _errorMsg.value = '';
    _visible.value = true;
    return new Promise<string | null>((res) => {
      _resolve = res;
    });
  };

  const submitPin = async (pin: string): Promise<void> => {
    if (!/^\d{4,8}$/.test(pin)) {
      _errorMsg.value = 'PIN 必須為 4-8 位純數字';
      return;
    }
    _busy.value = true;
    _errorMsg.value = '';
    try {
      const res = await $api.VerifyAdminPin({ pin });
      if (res.status?.code !== 200 || !res.data?.sessionToken) {
        _errorMsg.value = res.status?.message?.zh_tw || 'PIN 錯誤';
        return;
      }
      _writeToken(res.data.sessionToken);
      _visible.value = false;
      _resolve?.(res.data.sessionToken);
      _resolve = null;
    } finally {
      _busy.value = false;
    }
  };

  const cancel = () => {
    _visible.value = false;
    _resolve?.(null);
    _resolve = null;
  };

  return {
    askForPin,
    submitPin,
    cancel,
    _visible,
    _busy,
    _errorMsg,
  };
};
