/**
 * PATCH /nuxt-api/drivers/me/vehicle-capacity
 * 司機自編車輛載運容量（立即生效，不走審核流程）— SU V2
 *
 * Body: { trunkVolumeLiters: number; seatConfigs?: SeatConfig[] }
 *
 * 寫入：drivers/{lineUid}.vehicleCapacity = {
 *   trunkVolumeLiters,
 *   derivedLuggageSU,  // server 端計算
 *   seatConfigs,
 *   updatedAt,
 * }
 *
 * 認證：require driver self
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { computeSU, validateSeatConfigs } from '~shared/luggageSU';

interface PatchBody {
  trunkVolumeLiters?: unknown;
  seatConfigs?: unknown;
}

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

  const liters = body.trunkVolumeLiters;
  if (liters === undefined || !Number.isFinite(liters as number) || (liters as number) <= 0) {
    return badRequestError({
      zh_tw: 'trunkVolumeLiters 必須是正數（公升）',
      en: 'trunkVolumeLiters must be a positive number (liters)',
      ja: 'trunkVolumeLiters は正の数（リットル）が必要です',
    });
  }

  const configError = validateSeatConfigs(body.seatConfigs);
  if (configError) {
    return badRequestError({ zh_tw: configError, en: configError, ja: configError });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const derivedLuggageSU = computeSU(liters as number);

    const vehicleCapacity: Record<string, unknown> = {
      trunkVolumeLiters: liters as number,
      derivedLuggageSU,
      seatConfigs: Array.isArray(body.seatConfigs) ? body.seatConfigs : null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await driverRef.update({ vehicleCapacity });

    return successResponse({ derivedLuggageSU });
  } catch (err) {
    console.error('[drivers/me/vehicle-capacity.patch] failed:', err);
    return serverError();
  }
});
