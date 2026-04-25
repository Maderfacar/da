/** 開請型組件操作 */
export const UseOpenComOption = () => {
  const visible = ref(true); // 開關
  const isChange = ref(false); // 參數是否有變化
  const isSendLock = ref(false); // 送出中

  // 參數變化
  const OnChange = () => {
    isChange.value = true;
  };

  // 直接關閉
  const OnClose = () => {
    isChange.value = false;
    visible.value = false;
    isSendLock.value = false;
  };

  // 狀態初始
  const InitStatus = () => {
    visible.value = true;
    isSendLock.value = false;
    isChange.value = false;
  };

  return {
    visible,
    isChange,
    isSendLock,
    OnChange,
    OnClose,
    InitStatus
  };
};
