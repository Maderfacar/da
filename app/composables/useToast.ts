// 模組層級單例，確保全 app 共用同一個 toast 狀態
const _toast = reactive({
  message: '',
  visible: false,
  timer: null as ReturnType<typeof setTimeout> | null,
});

export function useToast() {
  function showToast(message: string, duration = 3000) {
    if (_toast.timer) clearTimeout(_toast.timer);
    _toast.message = message;
    _toast.visible = true;
    _toast.timer = setTimeout(() => {
      _toast.visible = false;
    }, duration);
  }

  function hideToast() {
    _toast.visible = false;
    if (_toast.timer) {
      clearTimeout(_toast.timer);
      _toast.timer = null;
    }
  }

  return { toastState: _toast, showToast, hideToast };
}
