/**
 * Server 端登入事件 → client_error_logs（認證根治 P3.6-FU）
 *
 * P3 的 server OAuth（/nuxt-api/auth/line/{start,callback}）是純 server 流程，原本只 console.log
 * 到 Vercel runtime log。本 helper 讓這些「登入成敗」也寫進 Firestore `client_error_logs`
 * （category='auth'），與三端 client 埋點（logAuth/logApi/logMiddleware）同一 collection，
 * 統一用既有 firebase-admin 查詢腳本一站查完，免分兩處（Firestore + Vercel log）。
 *
 * schema 對齊 server/routes/nuxt-api/_log/client-error.post.ts（含 timestamp serverTimestamp
 * → error-log-retention 的每日 cron 依 timestamp 自動回收，無需另設清理）。
 *
 * 設計：caller 傳入 path/userAgent/appVersion（Nitro runtime 才有的值），本函式只做純寫入
 * → 可單元測試、不依賴 auto-import 全域。永不 throw、永不阻斷登入流程（fire-and-forget 語意，
 * 但 caller 應 await —— serverless 送出 302 後函式可能凍結，不 await 會遺失寫入）。
 */
import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

type Severity = 'error' | 'warn' | 'info';
type EndKind = 'passenger' | 'driver' | 'admin';

export interface ServerAuthLogInput {
  /** e.g. 'auth.line-login.callback.fail' / '.ok' */
  event: string;
  severity: Severity;
  message: string;
  end: EndKind;
  /** 請求路徑（已去 querystring） */
  path: string;
  userAgent?: string;
  appVersion?: string;
  lineUserId?: string | null;
  metadata?: Record<string, unknown>;
}

const MAX_EVENT = 200;
const MAX_MESSAGE = 500;
const MAX_PATH = 500;
const MAX_UA = 500;
const MAX_VERSION = 64;

/** 寫一筆 auth log 進 client_error_logs（schema 對齊 _log/client-error）。永不 throw。 */
export async function writeAuthErrorLog(db: Firestore, input: ServerAuthLogInput): Promise<void> {
  try {
    await db.collection('client_error_logs').add({
      timestamp: FieldValue.serverTimestamp(),
      category: 'auth',
      severity: input.severity,
      event: input.event.slice(0, MAX_EVENT),
      message: input.message.slice(0, MAX_MESSAGE),
      context: {
        lineUserId: input.lineUserId ?? null,
        path: (input.path ?? '').slice(0, MAX_PATH),
        prevPath: null,
        userAgent: (input.userAgent ?? '').slice(0, MAX_UA),
        isInLiffClient: null,
        roles: [],
        end: input.end,
        appVersion: (input.appVersion ?? '').slice(0, MAX_VERSION),
        sessionId: '',
      },
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  } catch (err) {
    // Firestore 失敗不可阻斷登入流程（callback 仍要 302 導頁）
    console.error('[server-auth-log] write failed (non-fatal):', err);
  }
}
