// 乘客端季節主題 store（W1 重構）
//
// 前身為 useColorMode dark/light/pink 佔位（dummy primaryTest 綠/紅，全站無人引用）。
// 現改為持有「當前生效季節主題」，由 useSiteThemeInject composable 於乘客 layout 載入時
// setResolved，並注入 [data-da-theme] 覆寫調色盤。
import type { ResolvedTheme } from '~shared/site-theme';

export const StoreTheme = defineStore('StoreTheme', () => {
  /** 當前生效主題（SSR 解析後帶入；null = 尚未載入，注入端回退不輸出覆寫） */
  const resolved = ref<ResolvedTheme | null>(null);

  const setResolved = (theme: ResolvedTheme) => {
    resolved.value = theme;
  };

  return {
    resolved,
    setResolved,
  };
});
