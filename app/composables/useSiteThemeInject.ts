// 乘客端季節主題注入（W1）— FOUC-free SSR。
//
// 在乘客 layout（front-desk / marketing）的 setup 呼叫。流程：
//   1. useAsyncData('site-theme') 於 SSR 撈生效主題 → payload 序列化到 client（hydration 不重打）
//   2. setResolved 進 StoreTheme（其他元件可讀）
//   3. useHead 注入 scoped <style id="da-theme-vars">，選擇器 [data-da-theme]
//
// 為何 FOUC-free：useAsyncData 於 server 端被 await，useHead 在 SSR HTML 已含 style，
// client hydration 讀 payload 不重新請求、不閃色。
//
// 隔離：注入選擇器為 [data-da-theme]（掛在乘客 layout 根容器），非 :root →
// admin（back-desk）/ driver layout 不掛此屬性，永遠吃 _theme-colors.css 的 :root 預設。
import { buildThemeCss, type ResolvedTheme } from '~shared/site-theme';

export const useSiteThemeInject = () => {
  const store = StoreTheme();

  const { data } = useAsyncData<ResolvedTheme | null>('site-theme', async () => {
    try {
      const res = await $api.GetSiteTheme();
      if (res.status?.code === $enum.apiStatus.success && res.data) {
        return res.data as unknown as ResolvedTheme;
      }
    } catch {
      // fire-and-forget：撈失敗 → 不注入覆寫，乘客端退回 :root 預設調色盤（即經典主題）
    }
    return null;
  });

  watchEffect(() => {
    if (data.value) store.setResolved(data.value);
  });

  useHead(
    computed(() => ({
      style: data.value
        ? [{ id: 'da-theme-vars', innerHTML: buildThemeCss(data.value) }]
        : [],
    })),
  );
};
