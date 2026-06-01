/**
 * PATCH /nuxt-api/drivers/me/vehicle-capacity
 * 司機自編車輛資訊（airport-calibration wave 後 SU 已停用）
 *
 * Body: { trunkPhotoUrl?: string }
 *
 * 寫入：drivers/{lineUid}.vehicleCapacity = {
 *   trunkPhotoUrl,  // Firebase Storage 公開 URL，admin 審核背書「車輛符合所掛車型描述」
 *   updatedAt,
 * }
 *
 * 認證：require driver self
 *
 * 註：trunkVolumeLiters / derivedLuggageSU / seatConfigs 已 deprecated；
 *     舊資料保留不刪，新請求不再寫入。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';

interface PatchBody {
  trunkPhotoUrl?: unknown;
}

const MAX_URL_LENGTH = 2048;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const url = body.trunkPhotoUrl;
  let trunkPhotoUrl: string | null = null;
  if (url !== undefined && url !== null && url !== '') {
    if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) {
      return badRequestError({
        zh_tw: 'trunkPhotoUrl 必須是字串（≤ 2048 字元）',
        en: 'trunkPhotoUrl must be a string (≤ 2048 chars)',
        ja: 'trunkPhotoUrl は文字列が必要です（2048 文字以下）',
      });
    }
    if (!/^https:\/\//.test(url)) {
      return badRequestError({
        zh_tw: 'trunkPhotoUrl 必須是 https URL',
        en: 'trunkPhotoUrl must be an https URL',
        ja: 'trunkPhotoUrl は https URL が必要です',
      });
    }
    trunkPhotoUrl = url;
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const vehicleCapacity: Record<string, unknown> = {
      trunkPhotoUrl,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await driverRef.update({ vehicleCapacity });

    return successResponse({ trunkPhotoUrl });
  } catch (err) {
    console.error('[drivers/me/vehicle-capacity.patch] failed:', err);
    return serverError();
  }
});
