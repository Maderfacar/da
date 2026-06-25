// Client Error Log — Phase 1 MVP（2026-06-26）
//
// 框架層 fire-and-forget 錯誤收集器：寫入 Firestore `client_error_logs` collection。
// 設計準則：永不 throw、永不阻塞主流程；fetch / 自身崩潰一律 swallow。
//
// 三端通用（passenger / driver / admin），由 path 前綴自動推導 `end`。
// 任何個別頁面 / 元件不需手動 log；框架層 5 道收集器自動繼承覆蓋。
//
// 業務手動 log 入口：logFeature（自由欄位 metadata）。

type Severity = 'error' | 'warn' | 'info';
type Category = 'auth' | 'api' | 'unhandled' | 'navigation' | 'middleware' | 'lifecycle' | 'feature';
type EndKind = 'passenger' | 'driver' | 'admin';

export interface ErrorLogPayload {
  event: string;
  message: string;
  metadata?: Record<string, unknown>;
  severity?: Severity;
  stack?: string;
}

interface ErrorLogContext {
  lineUserId?: string;
  path: string;
  prevPath?: string;
  userAgent: string;
  isInLiffClient?: boolean;
  roles: string[];
  end: EndKind;
  appVersion: string;
  sessionId: string;
}

const SESSION_KEY = 'da_log_session';
const ENDPOINT = '/nuxt-api/_log/client-error';

let _sid = '';
let _prevPath = '';

const _ensureSessionId = (): string => {
  if (_sid) return _sid;
  try {
    if (typeof sessionStorage !== 'undefined') {
      let v = sessionStorage.getItem(SESSION_KEY);
      if (!v) {
        v = Math.random().toString(36).slice(2, 9);
        sessionStorage.setItem(SESSION_KEY, v);
      }
      _sid = v;
      return _sid;
    }
  } catch { /* 隱私模式 / quota 滿時 fall through */ }
  _sid = Math.random().toString(36).slice(2, 9);
  return _sid;
};

const _resolveEnd = (path: string): EndKind => {
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/driver')) return 'driver';
  return 'passenger';
};

const _safeIsInLiff = (): boolean | undefined => {
  try {
    const w = window as unknown as { liff?: { isInClient?: () => boolean } };
    if (w.liff && typeof w.liff.isInClient === 'function') return w.liff.isInClient();
  } catch { /* ignore */ }
  return undefined;
};

const _safeReadAuth = (): { lineUserId?: string; roles: string[] } => {
  try {
    const w = window as unknown as {
      __authStore?: { user?: { uid?: string }; roles?: string[] };
    };
    const uid = w.__authStore?.user?.uid ?? '';
    const lineUserId = uid.startsWith('line:') ? uid.slice(5) : (uid || undefined);
    const roles = Array.isArray(w.__authStore?.roles) ? [...w.__authStore!.roles!] : [];
    return { lineUserId, roles };
  } catch {
    return { roles: [] };
  }
};

const _safeAppVersion = (): string => {
  try {
    const cfg = useRuntimeConfig().public as { appVersion?: string };
    return cfg.appVersion ?? '';
  } catch {
    return '';
  }
};

const _buildContext = (): ErrorLogContext => {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const { lineUserId, roles } = _safeReadAuth();
  return {
    lineUserId,
    path,
    prevPath: _prevPath || undefined,
    userAgent,
    isInLiffClient: _safeIsInLiff(),
    roles,
    end: _resolveEnd(path),
    appVersion: _safeAppVersion(),
    sessionId: _ensureSessionId(),
  };
};

const _send = (category: Category, payload: ErrorLogPayload): void => {
  if (typeof window === 'undefined') return;
  try {
    const body = {
      category,
      severity: payload.severity ?? 'error',
      event: String(payload.event ?? '').slice(0, 200),
      message: String(payload.message ?? '').slice(0, 500),
      stack: payload.stack ? String(payload.stack).slice(0, 2000) : undefined,
      context: _buildContext(),
      metadata: payload.metadata,
    };
    void $fetch(ENDPOINT, { method: 'POST', body }).catch(() => { /* fire-and-forget */ });
  } catch { /* 自身崩潰絕不外洩 */ }
};

/** 給 navigation-log plugin 用：每次 route 切換後記下，下一次 log 帶 prevPath */
export const _updatePrevPath = (path: string): void => { _prevPath = path; };

export const logAuth       = (p: ErrorLogPayload): void => _send('auth', p);
export const logApi        = (p: ErrorLogPayload): void => _send('api', p);
export const logMiddleware = (p: ErrorLogPayload): void => _send('middleware', p);
export const logUnhandled  = (p: ErrorLogPayload): void => _send('unhandled', p);
export const logNavigation = (p: ErrorLogPayload): void => _send('navigation', p);
export const logLifecycle  = (p: ErrorLogPayload): void => _send('lifecycle', p);
export const logFeature    = (p: ErrorLogPayload): void => _send('feature', p);
