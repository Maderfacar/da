/**
 * GET /nuxt-api/tags/[id]/audit-logs
 *
 * 查詢單一標籤的 audit log 歷史（desc by performedAt）。
 * Query: ?limit=20（default 20，max 100）
 * 權限：canManageFleet
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { toTagAuditLogDto, type TagAuditLogDto } from '@@/utils/tag';

interface ListRes {
  logs: TagAuditLogDto[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要車隊管理權限', en: 'canManageFleet required', ja: 'フリート管理権限が必要です' });
  }

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: '缺少標籤 ID', en: 'Tag id required', ja: 'タグ ID が必要です' });
  }

  const query = getQuery(event);
  const limitRaw = typeof query.limit === 'string' ? Number(query.limit) : DEFAULT_LIMIT;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('tag_audit_logs')
      .where('tagId', '==', id)
      .orderBy('performedAt', 'desc')
      .limit(limit)
      .get();
    const logs = snap.docs
      .map(toTagAuditLogDto)
      .filter((l): l is TagAuditLogDto => l !== null);
    return successResponse<ListRes>({ logs });
  } catch (err) {
    console.error('[tags audit-logs GET] failed:', err);
    return serverError();
  }
});
