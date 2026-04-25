// https://cn.vuejs.org/guide/reusability/custom-directives.html#directive-hooks
// 進場動畫（支援模式參數）
// API：v-from="[x, y, delay, mode]"
//   - x, y: 起始位移量（數字）或自訂動畫函式
//   - delay: 進場延遲（毫秒）
//   - mode: 單一字串參數，控制觸發模式
//       'once'        -> 只觸發一次（預設）
//       'repeat'      -> 可重複觸發，離開時恢復（opacity: 0）
//       'repeat-keep' -> 可重複觸發，離開時不恢復（維持當前狀態）
// 亦支援修飾詞：v-from.repeat 等同 mode='repeat'，v-from.loop 等同 mode='repeat'
// 相容舊寫法：
//   - 第 4 參數為 boolean：true 等同 'repeat' / false 或未提供等同 'once'
//   - 第 4 參數為物件：{ repeat: true, resetOnLeave: true|false } 對應為 'repeat' 或 'repeat-keep'
// 範例：
// <div v-from="[100, 0, 300]"/>
// <div v-from.repeat="[100, 0, 300]"/>
// <div v-from="[100, 0, 300, 'repeat-keep']"/>
export default defineNuxtPlugin((nuxtApp) => {
  // 從哪進入
  nuxtApp.vueApp.directive('from', {
    mounted (el, binding) {
      // 解析模式（once | repeat | repeat-keep），相容舊寫法
      const resolveMode = (): 'once' | 'repeat' | 'repeat-keep' => {
        const byModifier = binding?.modifiers || {};
        // 修飾詞優先
        if (byModifier.repeat || byModifier.loop) return 'repeat';

        const raw = binding?.value?.[3];
        if (raw === undefined || raw === null) return 'once';
        if (typeof raw === 'string') {
          if (raw === 'repeat' || raw === 'repeat-keep' || raw === 'once') return raw;
        } else if (typeof raw === 'boolean') {
          return raw ? 'repeat' : 'once';
        } else if (typeof raw === 'object') {
          // 舊寫法 { repeat: boolean, resetOnLeave?: boolean }
          const r = !!raw.repeat;
          const reset = raw.resetOnLeave;
          if (!r) return 'once';
          return reset === false ? 'repeat-keep' : 'repeat';
        }
        return 'once';
      };

      // 僅解析一次，避免在每次 Intersection callback 中重複判斷
      const mode = resolveMode();
      const isOnce = mode === 'once';
      const isRepeat = mode === 'repeat' || mode === 'repeat-keep';
      const shouldResetOnLeave = mode === 'repeat';

      // 綁定目標進入畫面時觸發
      const OnIntersection = (entries: IntersectionObserverEntry[]) => {
        entries.forEach((entry: any) => {
          // 進入判定點後
          const targetEl = entry.target as HTMLElement & { _inView?: boolean };

          // 進入視窗時（避免在已在視窗狀態下重複觸發）
          if (entry.isIntersecting) {
            if (!targetEl._inView) {
              targetEl._inView = true;
              // 依據延遲，執行動畫
              const delay = binding.value[2] || 0;
              setTimeout(() => {
                el.style.opacity = '1';
                TrigAnimate(entry.target);
                // once 模式：觸發一次後解除觀測
                if (isOnce) {
                  observer.unobserve(entry.target);
                  observer.disconnect();
                }
              }, delay);
            }
          } else {
            // 離開視窗時
            if (targetEl._inView) {
              targetEl._inView = false;
              // repeat 模式：離開時恢復初始狀態（僅影響 opacity）
              if (isRepeat && shouldResetOnLeave) {
                (entry.target as HTMLElement).style.opacity = '0';
              }
            }
          }
        });
      };

      const TrigAnimate = (target: any) => {
        // 依據 RWD 放大位移量
        let scaleUp = 1;
        if (window && window.innerWidth > 768) scaleUp = 1.2;
        if (window && window.innerWidth > 1440) scaleUp = 1.4;

        const x = binding.value[0] * scaleUp || 0; // 位移距離
        const y = binding.value[1] * scaleUp || 0;

        const moveXAnimation = {
          transform: ['translate3d(0,0,0)', `translate3d(${x}px,${y}px,0)`],
          opacity: [1, 0]
        };
        const animateOption = {
          easing: 'ease-in',
          direction: 'reverse',
          duration: 1000
        };

        const isTranslate = typeof binding.value[0] === 'number';
        if (isTranslate) {
          // 若傳入數字，則為預設位移動畫
          target.animate(moveXAnimation, animateOption);
        } else {
          // 若傳入函示，則為自訂動畫
          binding.value[0](target);
        }
      };

      el.style.opacity = 0;
      const observer = new IntersectionObserver(OnIntersection, {
        root: null, // 觀察範圍 viewport。預設為瀏覽器
        rootMargin: '-30px', // 偵測範圍內縮
        threshold: 0.1 // 目標可見度為 10% 時就觸發
      });

      observer.observe(el);
      el._observer = observer;
    },
    unmounted (el) {
      el._observer?.unobserve(el);
    }
  });
  // -----------------------------------------------------------------------------------------------
});
