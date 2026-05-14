/**
 * LINE API Error Log（P43 Phase 2）
 *
 * 對應 spec design.md §2 + Brain AI 拍板 Q2=2a（基本 schema）。
 *
 * 設計：
 *   - collection `line_api_errors/{autoId}`；client 全禁讀寫（firestore.rules）
 *   - 寫入用 await（業務流程已失敗，多 100-200ms 寫 log 可接受；與 audit-log 同策略）
 *   - schema 為基本版（不存 requestBody；errorDetails trim 500 字避免大 payload）
 *   - 不設 TTL（Q3=3c）；Phase 4 收尾後觀察 1-2 週實際寫入量
 *
 * 用法：
 *   import { writeLineApiError } from '@@/utils/line-api-error-log';
 *   try {
 *     await sendLinePush(...);
 *   } catch (err) {
 *     await writeLineApiError({
 *       channel: 'passenger',
 *       api: 'message/push',
 *       method: 'POST',
 *       statusCode: 429,
 *       errorMessage: err.message,
 *       errorDetails: err.data,
 *       context: { targetUid: lineUserId },
 *     });
 *     throw err;
 *   }
 */
import { FieldValue } from 'firebase-admin/firestore';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export type ErrorLogChannel = 'passenger' | 'driver' | 'unknown';

export interface WriteErrorLogInput {
  channel: ErrorLogChannel;
  api: string;
  method: 'GET' | 'POST' | 'DELETE';
  statusCode: number;
  errorMessage: string;
  errorDetails?: unknown;
  context?: {
    targetUid?: string | null;
    richMenuId?: string | null;
    orderId?: string | null;
  };
}

const ERROR_DETAILS_TRIM = 500;
const ERROR_MESSAGE_TRIM = 500;

/** 序列化 errorDetails 為 string（trim 500）；null/undefined 回 null */
function _serializeDetails(details: unknown): string | null {
  if (details === null || details === undefined) return null;
  if (typeof details === 'string') return details.slice(0, ERROR_DETAILS_TRIM);
  try {
    return JSON.stringify(details).slice(0, ERROR_DETAILS_TRIM);
  } catch {
    return String(details).slice(0, ERROR_DETAILS_TRIM);
  }
}

/**
 * 寫一筆 LINE API error log。**永不 throw**，失敗 silent。
 * 呼叫端 await 以確保 Vercel serverless 不砍 promise。
 */
export async function writeLineApiError(input: WriteErrorLogInput): Promise<void> {
  try {
    const { firebaseServiceAccountJson } = useRuntimeConfig();
    if (!firebaseServiceAccountJson) return;
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await db.collection('line_api_errors').add({
      channel: input.channel,
      api: input.api,
      method: input.method,
      statusCode: input.statusCode,
      errorMessage: (input.errorMessage ?? '').slice(0, ERROR_MESSAGE_TRIM),
      errorDetails: _serializeDetails(input.errorDetails),
      context: {
        targetUid: input.context?.targetUid ?? null,
        richMenuId: input.context?.richMenuId ?? null,
        orderId: input.context?.orderId ?? null,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[line-api-error-log] write failed (silent):', err);
  }
}

/**
 * 從 LINE API URL 取 api path 標記（如 'richmenu/create' / 'message/push'）。
 *
 * 範例：
 *   https://api.line.me/v2/bot/richmenu       → 'richmenu'
 *   https://api.line.me/v2/bot/richmenu/list  → 'richmenu/list'
 *   https://api-data.line.me/v2/bot/richmenu/abc/content → 'richmenu/content'
 *   https://api.line.me/v2/bot/user/all/richmenu → 'user/all/richmenu'
 */
export function extractApiPath(url: string): string {
  try {
    const u = new URL(url);
    // path 形如 /v2/bot/{rest}
    const parts = u.pathname.split('/').filter((p) => p.length > 0);
    // 去掉 v2 / bot prefix
    const rest = parts[0] === 'v2' && parts[1] === 'bot' ? parts.slice(2) : parts;
    // 移除 id-like 段（多為 hex/alphanumeric 長 ≥ 8）— 避免 path explosion
    const stripped = rest.filter((p) => !/^[a-zA-Z0-9_-]{8,}$/.test(p));
    return stripped.length > 0 ? stripped.join('/') : rest.join('/');
  } catch {
    return 'unknown';
  }
}
