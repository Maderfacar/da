/**
 * GET /nuxt-api/tags/active
 *
 * Active-only 標籤清單，給司機 / booking 端用。
 * Query: ?scope=driver|vehicle（可選；不帶則回全部 active）
 * 權限：logged-in user
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { toTagDto, type TagDto } from '@@/utils/tag';

interface ListRes {
  tags: TagDto[];
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const query = getQuery(event);
  const scopeRaw = typeof query.scope === 'string' ? query.scope : '';
  const scope = scopeRaw === 'driver' || scopeRaw === 'vehicle' ? scopeRaw : null;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    let q = db.collection('tags').where('status', '==', 'active');
    if (scope) q = q.where('scope', '==', scope);
    const snap = await q.get();
    const tags = snap.docs
      .map(toTagDto)
      .filter((t): t is TagDto => t !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return successResponse<ListRes>({ tags });
  } catch (err) {
    console.error('[tags GET active] failed:', err);
    return serverError();
  }
});
