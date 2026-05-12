/**
 * DELETE /nuxt-api/admin/config/{resource}/{id}
 *
 * 刪除 fleet config 項目。需 canManageFleet 權限。
 *
 * 注意：刪除車型 / 行李類型不會自動清掉既有訂單的引用；
 *      上線後若需要硬刪建議改用 enabled=false 軟刪保留歷史 reference。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { isFleetResource, getCollectionName } from '@@/utils/fleet-config';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要 fleet 管理權限', en: 'canManageFleet required', ja: 'fleet管理権限が必要です' });
  }

  const resource = getRouterParam(event, 'resource');
  const id = getRouterParam(event, 'id');
  if (!isFleetResource(resource)) {
    return badRequestError({ zh_tw: '無效的 resource', en: 'Invalid resource', ja: '無効なリソース' });
  }
  if (!id) {
    return badRequestError({ zh_tw: '缺少 id', en: 'Missing id', ja: 'IDが不足' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const collectionName = getCollectionName(resource);
    const docRef = db.collection(collectionName).doc(id);

    const existing = await docRef.get();
    if (!existing.exists) {
      return notFoundError({ zh_tw: `找不到項目：${id}`, en: `Not found: ${id}`, ja: `項目が見つかりません：${id}` });
    }

    const before = existing.data() ?? {};
    await docRef.delete();
    // P25-2 audit log
    await writeAuditLog({
      event,
      auth,
      action: 'fleet.delete',
      targetType: 'fleet',
      targetId: `${resource}/${id}`,
      payload: { resource, id, before },
    });
    return successResponse({ id });
  } catch (err) {
    console.error('[admin/config DELETE] failed:', err);
    return serverError({ zh_tw: '刪除失敗', en: 'Delete failed', ja: '削除に失敗しました' });
  }
});
