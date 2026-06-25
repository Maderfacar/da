// Client Error Log endpoint — Phase 1 MVP（2026-06-26）
//
// 接收三端 client-side fire-and-forget 錯誤 log 寫入 Firestore `client_error_logs`。
//
// 設計準則：
// - 不擋 auth（client 任何狀態都能寫，包含未登入 / signed-out）
// - schema 驗證失敗 / Firestore 寫失敗 → 一律回 200 successResponse，不洩 detection 也不破壞主流程
// - Phase 1.5 加 IP rate limit 60/min + payload sanitize（metadata > 5KB / 字串超長截斷）

import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, getClientIp } from '@@/utils/rate-limit';

type Severity = 'error' | 'warn' | 'info';
type Category = 'auth' | 'api' | 'unhandled' | 'navigation' | 'middleware' | 'lifecycle' | 'feature';
type EndKind = 'passenger' | 'driver' | 'admin';

interface RequestBody {
  category?: Category;
  severity?: Severity;
  event?: string;
  message?: string;
  stack?: string;
  context?: {
    lineUserId?: string;
    path?: string;
    prevPath?: string;
    userAgent?: string;
    isInLiffClient?: boolean;
    roles?: string[];
    end?: EndKind;
    appVersion?: string;
    sessionId?: string;
  };
  metadata?: Record<string, unknown>;
}

const VALID_CATEGORIES: ReadonlySet<Category> = new Set([
  'auth', 'api', 'unhandled', 'navigation', 'middleware', 'lifecycle', 'feature',
]);
const VALID_SEVERITIES: ReadonlySet<Severity> = new Set(['error', 'warn', 'info']);
const VALID_ENDS: ReadonlySet<EndKind> = new Set(['passenger', 'driver', 'admin']);

const MAX_EVENT_LEN = 200;
const MAX_MESSAGE_LEN = 500;
const MAX_STACK_LEN = 2000;
const MAX_PATH_LEN = 500;
const MAX_UA_LEN = 500;
const MAX_VERSION_LEN = 64;
const MAX_SID_LEN = 32;
const MAX_LINE_UID_LEN = 64;
const MAX_ROLES = 5;
const MAX_METADATA_BYTES = 5 * 1024;

const _clip = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max) : '';

export default defineEventHandler(async (event) => {
  // Phase 1.5：IP rate limit 60/min（fail-open）
  try {
    const config = useRuntimeConfig();
    if (config.firebaseServiceAccountJson) {
      const { db: limitDb } = useFirebaseAdmin(config.firebaseServiceAccountJson);
      const ip = getClientIp(event);
      const limit = await checkRateLimit(limitDb, {
        key: `client-error-log:ip:${ip}`,
        windowSec: 60,
        max: 60,
      });
      if (!limit.ok) {
        // 不洩 detection — 回 200，server 內部 silent drop
        return successResponse({ ok: true });
      }
    }
  } catch { /* fail-open */ }

  let body: RequestBody;
  try {
    body = await readBody<RequestBody>(event);
  } catch {
    return successResponse({ ok: true });
  }

  if (!body || typeof body !== 'object') return successResponse({ ok: true });
  if (!body.category || !VALID_CATEGORIES.has(body.category)) return successResponse({ ok: true });
  if (!body.event || typeof body.event !== 'string') return successResponse({ ok: true });
  if (!body.message || typeof body.message !== 'string') return successResponse({ ok: true });
  if (!body.context || typeof body.context !== 'object') return successResponse({ ok: true });

  const severity: Severity = body.severity && VALID_SEVERITIES.has(body.severity)
    ? body.severity : 'error';
  const ctx = body.context;
  const end: EndKind = ctx.end && VALID_ENDS.has(ctx.end) ? ctx.end : 'passenger';

  // Phase 1.5：metadata 整包 stringify > 5KB 拒收
  let metadataSafe: Record<string, unknown> | undefined;
  if (body.metadata && typeof body.metadata === 'object') {
    try {
      const serialized = JSON.stringify(body.metadata);
      if (serialized && serialized.length <= MAX_METADATA_BYTES) {
        metadataSafe = body.metadata;
      }
    } catch { /* circular / unserializable → drop metadata */ }
  }

  try {
    const config = useRuntimeConfig();
    if (!config.firebaseServiceAccountJson) return successResponse({ ok: true });

    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);

    const doc: Record<string, unknown> = {
      timestamp: FieldValue.serverTimestamp(),
      category: body.category,
      severity,
      event: _clip(body.event, MAX_EVENT_LEN),
      message: _clip(body.message, MAX_MESSAGE_LEN),
      context: {
        lineUserId: _clip(ctx.lineUserId, MAX_LINE_UID_LEN) || null,
        path: _clip(ctx.path, MAX_PATH_LEN),
        prevPath: _clip(ctx.prevPath, MAX_PATH_LEN) || null,
        userAgent: _clip(ctx.userAgent, MAX_UA_LEN),
        isInLiffClient: typeof ctx.isInLiffClient === 'boolean' ? ctx.isInLiffClient : null,
        roles: Array.isArray(ctx.roles)
          ? ctx.roles.filter((r): r is string => typeof r === 'string').slice(0, MAX_ROLES)
          : [],
        end,
        appVersion: _clip(ctx.appVersion, MAX_VERSION_LEN),
        sessionId: _clip(ctx.sessionId, MAX_SID_LEN),
      },
    };
    if (body.stack) doc.stack = _clip(body.stack, MAX_STACK_LEN);
    if (metadataSafe) doc.metadata = metadataSafe;

    await db.collection('client_error_logs').add(doc);
  } catch { /* Firestore 失敗也回 200，不破壞主流程 */ }

  return successResponse({ ok: true });
});
