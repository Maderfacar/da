/**
 * PUT /nuxt-api/admin/config/{resource}/{id}
 *
 * 更新 fleet config 項目。需 canManageFleet 權限。
 * 完整覆寫 doc（client 必須帶完整 payload）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  isFleetResource,
  getCollectionName,
  validateVehiclePayload,
  validateLuggageTypePayload,
  validateExtraPayload,
} from '@@/utils/fleet-config';

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

  const body = await readBody<Record<string, unknown>>(event);
  if (!body || typeof body !== 'object') {
    return badRequestError({ zh_tw: '缺少 body', en: 'Missing body', ja: 'ボディが不足' });
  }

  const validation =
    resource === 'vehicles' ? validateVehiclePayload(body) :
    resource === 'luggage-types' ? validateLuggageTypePayload(body) :
    validateExtraPayload(body);

  if (!validation.ok) {
    return badRequestError({ zh_tw: validation.error, en: validation.error, ja: validation.error });
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

    await docRef.set(validation.data);
    return successResponse({ id, ...validation.data });
  } catch (err) {
    console.error('[admin/config PUT] write failed:', err);
    return serverError({ zh_tw: '更新失敗', en: 'Update failed', ja: '更新に失敗しました' });
  }
});
