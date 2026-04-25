export const StoreTool = defineStore('StoreTool', () => {
  // 寬度 RWD 資訊 --------------------------------
  const pcSize = 1024;
  /* 上次 scrolltop 的值 */
  let _lastScrollTopVal = 0;
  /* scrolltop 的值 */
  const scrollTopVal = ref(0);
  const windowWidth = ref<number>(pcSize);
  /* 是行動端 */
  const isMobileDevice = ref(true);
  /* > 1024px */
  const isPc = computed(() => windowWidth.value >= pcSize);
  /* < 1024px */
  const isMobile = computed(() => windowWidth.value < pcSize);

  /* 滾動方向(px) */
  const scrollUpDown = ref<-1 | 0 | 1>(0); // -1 up, 0:no scroll, 1: down // 滾動方向(px)

  /* 目前網址 */
  const currentUrl = computed(() => {
    if (import.meta.server) return '';
    return window.location.href;
  });

  /* 設定裝置 */
  const SetDevice = () => {
    if (import.meta.client) {
      const userAgent = navigator.userAgent;
      isMobileDevice.value = !!(userAgent.match(
        /(phone|pad|pod|iPhone|iPod|ios|iPad|Android|Mobile|BlackBerry|IEMobile|MQQBrowser|JUC|Fennec|wOSBrowser|BrowserNG|WebOS|Symbian|Windows Phone)/i
      ));
    }
  };

  // 設定寬度
  const SetWindowWidth = () => {
    if (import.meta.client) {
      const { innerWidth: width } = window;
      windowWidth.value = width;
    }
  };

  // 畫面滾動
  const SetWindowScroll = $lodash.throttle(() => {
    const _scrollTop = document.querySelector('html')?.scrollTop || 0;
    scrollTopVal.value = _scrollTop;
    // 滾動方向
    scrollUpDown.value = (_scrollTop - _lastScrollTopVal) > 0 ? 1 : -1;
    RecoverScrollUpDown();
    _lastScrollTopVal = _scrollTop;
  }, 200);

  // 恢復方向
  const RecoverScrollUpDown = $lodash.debounce(() => {
    scrollUpDown.value = 0;
  }, 300);


  onMounted(() => {
    SetDevice();
    SetWindowWidth();
    window.addEventListener('resize', SetWindowWidth);
    window.addEventListener('scroll', SetWindowScroll);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', SetWindowWidth);
    window.removeEventListener('scroll', SetWindowScroll);
  });

  return {
    /** 是否行動端 */
    isMobileDevice,
    /** > 1024px */
    isPc,
    /** < 1024px */
    isMobile,
    /** 畫面寬度 */
    windowWidth,
    /** 畫面滾動 */
    scrollTopVal,
    /** 目前網址 */
    currentUrl,
    /** 滾動方向(px) */
    scrollUpDown,
  };
});
