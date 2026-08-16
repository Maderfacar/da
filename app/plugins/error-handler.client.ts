// Client Error Handler — Phase 1 MVP（2026-06-26）
//
// 三端通用：window.onerror + unhandledrejection + Vue app errorHandler。
// 任何 JS 崩潰 / Promise reject 自動進 client_error_logs（category='unhandled'）。
//
// 收集器自身崩潰絕不外洩（error-log.ts 已雙重 try-catch + Promise.catch）。
import { logUnhandled } from '~/utils/error-log';

export default defineNuxtPlugin((nuxtApp) => {
  if (typeof window === 'undefined') return;

  // 1. JS 同步錯誤
  window.addEventListener('error', (ev) => {
    logUnhandled({
      event: 'window.onerror',
      message: ev.message || (ev.error instanceof Error ? ev.error.message : 'Unknown error'),
      stack: ev.error instanceof Error ? ev.error.stack : undefined,
      metadata: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      },
    });
  });

  // 2. unhandled Promise rejection
  window.addEventListener('unhandledrejection', (ev) => {
    const reason: unknown = ev.reason;
    const message = reason instanceof Error
      ? reason.message
      : (typeof reason === 'string' ? reason : 'Unhandled rejection');
    const stack = reason instanceof Error ? reason.stack : undefined;
    logUnhandled({
      event: 'window.unhandledrejection',
      message,
      stack,
    });
  });

  // 3. Vue render / lifecycle 錯誤
  nuxtApp.vueApp.config.errorHandler = (err, _instance, info) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logUnhandled({
      event: 'vue.errorHandler',
      message: e.message,
      stack: e.stack,
      metadata: { info },
    });
    // 保留 console.error 讓開發者在 DevTools 看到原始堆疊
    console.error('[Vue errorHandler]', err, info);
  };

  // 3.5. Nuxt 自身的錯誤鉤子（2026-08-17）
  //      上面三道攔不到 route middleware / plugin / setup() 拋出的錯誤 —— Nuxt 會直接接住
  //      並渲染 error.vue，現場只看得到全螢幕 500、log 全空（司機 OA 進站閃 500 即屬此類）。
  //      app:error 是這條路徑上最早、最泛用的攔截點；error.vue 內另有一道兜底。
  nuxtApp.hook('app:error', (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logUnhandled({
      event: 'app.error-hook',
      message: e.message,
      stack: e.stack,
      metadata: {
        statusCode: (err as { statusCode?: number } | null)?.statusCode ?? null,
        href: typeof window === 'undefined' ? '' : window.location.href.slice(0, 500),
      },
    });
    console.error('[Nuxt app:error]', err);
  });

  // 4. Chunk load 失敗自癒（P1，2026-07-31）
  //    新版部署後，仍開著舊 HTML 的分頁參照到已被清掉的 JS chunk → dynamic import 失敗 →
  //    白畫面 / 功能壞（例：07-24 `Importing a module script failed`）。偵測到就「一次性硬重載」
  //    拉回新版自癒。sessionStorage 旗標防重載迴圈；app 穩定運行 10s 後清旗標，讓下次部署仍可自癒。
  const CHUNK_RELOAD_KEY = 'da_chunk_reloaded';
  const _reloadOnceForChunk = (source: string, message: string): void => {
    logUnhandled({
      event: 'app.chunk-error',
      severity: 'warn',
      message: `${source}: ${message}`,
      metadata: { source },
    });
    try {
      if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return; // 已重載過 → 不再重載，避免迴圈
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch { /* 隱私模式：仍嘗試重載一次 */ }
    // 稍延遲讓 fire-and-forget log 有機會送出，再硬重載
    setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 200);
  };

  // Nuxt route chunk / dynamic import 失敗
  nuxtApp.hook('app:chunkError', ({ error }) => {
    const e = error instanceof Error ? error : new Error(String(error));
    _reloadOnceForChunk('app:chunkError', e.message);
  });

  // Vite preload 失敗（初次載入 / 手動 dynamic import 皆會 fire）
  window.addEventListener('vite:preloadError', (ev) => {
    const message = (ev as unknown as { payload?: { message?: string } }).payload?.message
      ?? 'vite preload error';
    _reloadOnceForChunk('vite:preloadError', message);
  });

  // app 穩定運行 10s 後清旗標（避免「shell 起得來但某路由 chunk 永久 404」時無限重載）
  nuxtApp.hook('app:mounted', () => {
    setTimeout(() => {
      try { sessionStorage.removeItem(CHUNK_RELOAD_KEY); } catch { /* ignore */ }
    }, 10_000);
  });
});
