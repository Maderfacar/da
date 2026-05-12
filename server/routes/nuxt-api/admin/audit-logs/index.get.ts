/**
 * GET /nuxt-api/admin/audit-logs
 *
 * 列出 admin 操作日誌（P25-2）。**僅 super admin 可讀**。
 *
 * Query params（皆 optional）：
 *   - actorUid:    過濾特定 admin 的操作（lineUid，不含 'line:' prefix）
 *   - action:      過濾特定 AuditAction（例：'driver.approve'）
 *   - targetType:  過濾 targetType（driver / admin / order / broadcast / fleet）
 *   - targetId:    過濾 targetId（搭配 targetType 一起用較有意義）
 *   - cursor:      上一頁最後一筆的 createdAt millisecond（cursor pagination）
 *   - limit:       回傳筆數，預設 50，最大 100
 *
 * Response data shape：
 *   { items: AuditLogEntry[], nextCursor: number | null }
 *
 * 排序：createdAt DESC（最新在前）
 *
 * Firestore 複合索引需求（首次查不到會自動提示建立連結）：
 *   - actorUid (ASC) + createdAt (DESC)
 *   - action (ASC) + createdAt (DESC)
 *   - targetType (ASC) + targetId (ASC) + createdAt (DESC)
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import type { AuditAction, AuditTargetType } from '@@/utils/audit-log';

interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorDisplayName: string;
  actorLevel: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  payload: Record<string, unknown>;
  ip: string;
  userAgent: string;
  createdAt: number;  // millis
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const _parseLimit = (raw: unknown): number => {
  if (typeof raw !== 'string') return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

const _parseCursor = (raw: unknown): number | null => {
  if (typeof raw !== 'string') return null;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return null;
  return n;
};

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  // P25-2：audit logs **僅 super 可讀**（直接判斷 level，不過 permissions override）
  // Reason：audit log 是查 admin 自己的操作，若 admin 可看自己的日誌等於可知何時被監控，違反審計獨立性
  if (auth.level !== 'super') {
    return forbiddenError({
      zh_tw: '僅最高管理員可讀操作日誌',
      en: 'Only super admin can read audit logs',
      ja: '操作ログは最高管理者のみ閲覧可能です',
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const query = getQuery(event) as {
    actorUid?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    cursor?: string;
    limit?: string;
  };

  const limit = _parseLimit(query.limit);
  const cursor = _parseCursor(query.cursor);

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    let q: FirebaseFirestore.Query = db.collection('audit_logs');

    // 過濾條件（依 spec 三組複合索引）
    if (query.actorUid) q = q.where('actorUid', '==', query.actorUid);
    if (query.action) q = q.where('action', '==', query.action);
    if (query.targetType) q = q.where('targetType', '==', query.targetType);
    if (query.targetId) q = q.where('targetId', '==', query.targetId);

    q = q.orderBy('createdAt', 'desc').limit(limit + 1);  // +1 偵測 nextCursor

    if (cursor !== null) {
      // cursor 為「上一頁最後一筆 createdAt millis」→ startAfter 該 Timestamp
      const cursorTs = new Date(cursor);
      q = q.startAfter(cursorTs);
    }

    const snapshot = await q.get();
    const docs = snapshot.docs;
    const hasMore = docs.length > limit;
    const trimmed = hasMore ? docs.slice(0, limit) : docs;

    const items: AuditLogEntry[] = trimmed.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        actorUid: (d.actorUid as string) ?? '',
        actorDisplayName: (d.actorDisplayName as string) ?? '',
        actorLevel: (d.actorLevel as string) ?? 'unknown',
        action: d.action as AuditAction,
        targetType: d.targetType as AuditTargetType,
        targetId: (d.targetId as string) ?? '',
        payload: (d.payload as Record<string, unknown>) ?? {},
        ip: (d.ip as string) ?? '',
        userAgent: (d.userAgent as string) ?? '',
        createdAt: d.createdAt?.toMillis?.() ?? 0,
      };
    });

    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1]!.createdAt
      : null;

    return successResponse({ items, nextCursor });
  } catch (err) {
    console.error('[admin/audit-logs] query failed:', err);
    return serverError();
  }
});
