// 搭配 assets/styles/css/_theme.css
type ThemeType = 'system' | 'dark' | 'light' | 'pink'

export const StoreTheme = defineStore('StoreTheme', () => {
  
  const colorMode = useColorMode();
  
  const _lightColorsMap = reactive({
    primaryTest: '#00ff00'
  });
  
  // -----------------------------------------
  const _darkColorsMap = reactive({
    primaryTest: '#ff0000'
  });

  const colors = computed(() => {
    if (colorMode.preference === 'dark') {
      return _darkColorsMap;
    }
    if (colorMode.preference === 'light') {
      return _lightColorsMap;
    }
    return _lightColorsMap;
  });
  
  // 動態主題色配置 ----------------------------------------------------------------------------------
  const ChangeTheme = (theme: ThemeType) => {
    colorMode.preference = theme;
  };

  // -----------------------------------------------------------------------------------------------
  return {
    colors,
    ChangeTheme,
  };
});
