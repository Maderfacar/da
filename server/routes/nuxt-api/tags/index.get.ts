/**
 * GET /nuxt-api/tags
 *
 * Admin 列表，含 archived；依 group.sortOrder（程式常數）+ sortOrder 排序由前端處理。
 * 權限：canManageFleet
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { toTagDto, type TagDto } from '@@/utils/tag';

interface ListRes {
  tags: TagDto[];
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要車隊管理權限', en: 'canManageFleet required', ja: 'フリート管理権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('tags').get();
    const tags = snap.docs
      .map(toTagDto)
      .filter((t): t is TagDto => t !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return successResponse<ListRes>({ tags });
  } catch (err) {
    console.error('[tags GET list] failed:', err);
    return serverError();
  }
});
