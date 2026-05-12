/**
 * Firestore-based Rate Limiter — P31 資安債修補
 *
 * 用途：對 line-exchange / driver-apply / admin-broadcast 等敏感端點做限流，
 * 避免 LINE API 配額 / Firestore 寫入被惡意打爆。
 *
 * 設計：
 * - collection `rate_limits/{key}` = `{ count, windowStart: Timestamp }`
 * - key 內含 windowBucket（floor(now / windowSec)）→ 過期自然分片，不需手動清
 * - 用 Firestore transaction 保證原子性（多 instance 並行不會少算）
 * - 超限回 ok=false + retryAfter；caller 自行決定回 429
 *
 * 為何不用 Upstash / Redis：避免引入外部依賴 + 額外 env vars。Firestore 雖每次
 * 1 read + 1 write，但限流端點本來 QPS 個位數，月度成本可忽略（< US$1）。
 */

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

export interface RateLimitOptions {
  /** 限流 key 主體（不含 windowBucket），e.g. "line-exchange:ip:1.2.3.4" */
  key: string;
  /** 視窗長度（秒） */
  windowSec: number;
  /** 視窗內允許次數 */
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** 達上限時：建議重試秒數（視窗剩餘秒數） */
  retryAfter?: number;
  /** 當前已用次數（含本次） */
  count: number;
}

/**
 * 檢查並遞增 rate limit 計數。
 * - 視窗 bucket = floor(now / windowSec)
 * - 同 bucket 內共用同一 doc，過視窗自動換新 doc（key 含 bucket）
 *
 * 失敗（Firestore 故障）→ ok: true 放行，避免 Firestore 故障導致全平台停擺。
 */
export async function checkRateLimit(db: Firestore, opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now();
  const bucket = Math.floor(now / 1000 / opts.windowSec);
  const docId = `${opts.key}:${bucket}`;
  const ref = db.collection('rate_limits').doc(docId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.data()?.count as number ?? 0) : 0;
      const next = current + 1;
      if (next > opts.max) {
        // 視窗剩餘秒數
        const windowEnd = (bucket + 1) * opts.windowSec * 1000;
        const retryAfter = Math.max(1, Math.ceil((windowEnd - now) / 1000));
        return { ok: false, count: current, retryAfter };
      }
      tx.set(ref, {
        count: next,
        windowStart: FieldValue.serverTimestamp(),
        bucket,
      }, { merge: true });
      return { ok: true, count: next };
    });
    return result;
  } catch (err) {
    console.warn('[rate-limit] Firestore failure, fail-open:', err);
    return { ok: true, count: 0 };
  }
}

/**
 * 從 H3 event 取 client IP（穿透 Vercel / Cloudflare 等 proxy）。
 * 找不到時回 'unknown'。
 */
export function getClientIp(event: { node: { req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } } } }): string {
  const headers = event.node.req.headers;
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    // x-forwarded-for: client, proxy1, proxy2 → 取最左
    return xff.split(',')[0]!.trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0]!.split(',')[0]!.trim();
  }
  const xreal = headers['x-real-ip'];
  if (typeof xreal === 'string' && xreal.length > 0) return xreal;
  return event.node.req.socket?.remoteAddress ?? 'unknown';
}

/**
 * 標準 429 響應（搭配 unified response 樣板的三語訊息）。
 */
export function rateLimitedResponse(retryAfter: number) {
  return {
    data: { retryAfter },
    status: {
      code: 429,
      message: {
        zh_tw: `請求過於頻繁，請 ${retryAfter} 秒後再試`,
        en: `Too many requests, retry in ${retryAfter}s`,
        ja: `リクエストが多すぎます。${retryAfter}秒後に再試行してください`,
      },
    },
  };
}
