// W4（2026-06-18）：受保護頁骨架兜底
//
// authStore.roles 透過 middleware/role lazy load；middleware 內 await 過 Ensure*，
// page mount 時通常 roles 已就緒。但 Ensure* 內 Firestore read 失敗（rules / 網路）會
// silently swallow，roles 留空 → 骨架永遠 stuck。
//
// 此 composable 提供 5 秒 timeout 兜底：
//   - 'loading'：roles 未就緒且未逾時 → 頁面顯示骨架
//   - 'ready'：roles.length > 0 → 頁面正常渲染
//   - 'failed'：逾時仍 roles=[] → 頁面顯示「載入失敗，請重新登入」+ 跳 /login 按鈕
//
// 使用範圍（Brain AI 拍板，2026-06-18）：只套乘客端
//   - app/layouts/front-desk.vue
//   - app/pages/profile/index.vue
//   - app/pages/orders/index.vue
import { logLifecycle } from '~/utils/error-log';

const ROLES_LOAD_TIMEOUT_MS = 5_000;

export const UseRolesLoadGuard = () => {
  const authStore = StoreAuth();
  const state = ref<'loading' | 'ready' | 'failed'>(
    authStore.roles.length > 0 ? 'ready' : 'loading',
  );

  const stopWatch = watch(
    () => authStore.roles.length,
    (n) => {
      if (n > 0) state.value = 'ready';
    },
    { immediate: true },
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (state.value === 'loading') {
    timer = setTimeout(() => {
      if (state.value === 'loading') {
        state.value = 'failed';
        logLifecycle({
          event: 'lifecycle.roles-load.timeout',
          severity: 'warn',
          message: 'UseRolesLoadGuard 5s timeout — roles=[]',
        });
      }
    }, ROLES_LOAD_TIMEOUT_MS);
  }

  const ClickReLogin = (): void => {
    void navigateTo('/login', { replace: true });
  };

  onScopeDispose(() => {
    stopWatch();
    if (timer) clearTimeout(timer);
  });

  return { state, ClickReLogin };
};
