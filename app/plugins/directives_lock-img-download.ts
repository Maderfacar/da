// 阻止圖片下載選單 v-lock-img-download
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('lock-img-download', {
    mounted(el, binding) {
      // 阻止右鍵
      const MouseEventHandler = (e: MouseEvent) => {
        if (binding.value === false) return;
        const target = e.target as HTMLElement | null;
        if (target && target.tagName.toLowerCase() === 'img') {
          e.preventDefault();
        }
      };
      
      // 阻止拖曳
      const DragEventHandler = (e: DragEvent) => {
        if (binding.value === false) return;
        const target = e.target as HTMLElement;
        if (target && target.tagName.toLowerCase() === 'img') {
          e.preventDefault();
        }
      };

      (el as any)._noContextmenuMouseEventHandler = MouseEventHandler;
      (el as any)._noContextmenuDragEventHandler = DragEventHandler;
   
      el.addEventListener('contextmenu', MouseEventHandler);
      el.addEventListener('dragstart', DragEventHandler);
    },

    beforeUnmount(el) {
      const MouseEventHandler = (el as any)._noContextmenuMouseEventHandler;
      if (MouseEventHandler) {
        el.removeEventListener('contextmenu', MouseEventHandler);
        delete (el as any)._noContextmenuMouseEventHandler;
      }

      const DragEventHandler = (el as any)._noContextmenuDragEventHandler;
      if (DragEventHandler) {
        el.removeEventListener('dragstart', DragEventHandler);
        delete (el as any)._noContextmenuDragEventHandler;
      }
    },
  });
});