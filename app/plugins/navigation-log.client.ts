// Navigation Log — Phase 1 MVP（2026-06-26）
//
// Vue Router afterEach 監聽：三端所有頁面跳轉記入 client_error_logs（category='navigation'）。
// severity='info'；量大時靠 endpoint IP rate limit 60/min 兜底。
import { logNavigation, _updatePrevPath } from '~/utils/error-log';

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return;
  const router = useRouter();

  let lastStart = 0;
  router.beforeEach(() => {
    lastStart = Date.now();
  });

  router.afterEach((to, from) => {
    const elapsedMs = lastStart > 0 ? Date.now() - lastStart : 0;
    logNavigation({
      event: 'route.navigate',
      severity: 'info',
      message: `${from.fullPath} → ${to.fullPath}`,
      metadata: {
        from: from.fullPath,
        to: to.fullPath,
        elapsedMs,
      },
    });
    _updatePrevPath(from.fullPath);
  });
});
