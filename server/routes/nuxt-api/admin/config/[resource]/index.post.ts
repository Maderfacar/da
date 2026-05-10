/**
 * POST /nuxt-api/admin/config/{resource}
 *   resource ∈ { vehicles, luggage-types, extras }
 *
 * 新增 fleet config 項目；doc id 可由 client 指定（slug）或由 server 產生 uuid。
 * 需 canManageFleet 權限。
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

interface CreateBody {
  /** 指定的 doc id（slug）。省略則 server 自動 uuid（建議 extras 用） */
  id?: string;
  [key: string]: unknown;
}

const ID_REGEX = /^[a-z0-9][a-z0-9-]{0,49}$/;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要 fleet 管理權限', en: 'canManageFleet required', ja: 'fleet管理権限が必要です' });
  }

  const resource = getRouterParam(event, 'resource');
  if (!isFleetResource(resource)) {
    return badRequestError({ zh_tw: '無效的 resource', en: 'Invalid resource', ja: '無効なリソース' });
  }

  const body = await readBody<CreateBody>(event);
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

  const docId = body.id && typeof body.id === 'string' && ID_REGEX.test(body.id)
    ? body.id
    : crypto.randomUUID();

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const collectionName = getCollectionName(resource);
    const docRef = db.collection(collectionName).doc(docId);

    const existing = await docRef.get();
    if (existing.exists) {
      return badRequestError({ zh_tw: `ID 已存在：${docId}`, en: `ID already exists: ${docId}`, ja: `IDはすでに存在します：${docId}` });
    }

    await docRef.set(validation.data);
    return successResponse({ id: docId, ...validation.data });
  } catch (err) {
    console.error('[admin/config POST] write failed:', err);
    return serverError({ zh_tw: '寫入失敗', en: 'Write failed', ja: '書き込みに失敗しました' });
  }
});
