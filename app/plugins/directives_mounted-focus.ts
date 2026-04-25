// 初始聚焦
// <input v-mounted-focus />
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('mounted-focus', {
    mounted (el) {
      el.focus();
    }
  });
});
