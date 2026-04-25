// 監聽元件 resize 大小變化
// <div v-resize="OnResize"></div>
export default defineNuxtPlugin((nuxtApp) => {
  // 從哪進入
  nuxtApp.vueApp.directive('resize', {
    mounted (el, binding) {
      const callback = binding.value;
      const observer = new ResizeObserver((entries) => {
        callback(entries[0]?.contentRect);
      });
      observer.observe(el);
      el._resizeObserver = observer;
    },
    unmounted (el) {
      if (el._resizeObserver) {
        el._resizeObserver.disconnect();
      }
    }
  });
});
