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
});
