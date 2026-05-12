/**
 * PATCH /nuxt-api/drivers/me/profile
 * 司機自編 profile（P26）
 *
 * 開放欄位：
 *   - phone：聯絡電話（即時生效，無 SMS 驗證）
 *
 * 不開放：driverName / plateNumber / vehicleType / bankCode / bankAccount
 *   （牽涉 trip matching + 收款，要走另開申請流程）
 *
 * 認證：require driver self（caller 必須是該 driver 本人）
 *
 * 對應 docs/decision-log.md P26 條目
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';

interface PatchBody {
  phone?: string;
}

// 台灣手機 09 開頭 + 後 8 碼數字 = 共 10 碼
const TW_MOBILE_RE = /^09\d{8}$/;

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
  if (!body || body.phone === undefined) {
    return badRequestError({ zh_tw: '請提供至少一個更新欄位', en: 'Provide at least one update field', ja: '少なくとも 1 つの更新フィールドを指定してください' });
  }

  if (body.phone !== undefined) {
    if (typeof body.phone !== 'string' || !TW_MOBILE_RE.test(body.phone)) {
      return badRequestError({ zh_tw: '電話格式不正確（需 09 開頭 10 碼）', en: 'Invalid phone format (must be 10-digit starting with 09)', ja: '電話番号の形式が正しくありません（09で始まる10桁）' });
    }
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const driverRef = db.collection('drivers').doc(auth.lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      return notFoundError({ zh_tw: '找不到司機資料', en: 'Driver record not found', ja: 'ドライバー情報が見つかりません' });
    }

    const beforePhone = driverSnap.data()?.application?.phone as string | undefined;

    const update: Record<string, unknown> = {};
    if (body.phone !== undefined) {
      update['application.phone'] = body.phone;
    }

    await driverRef.update(update);

    await writeAuditLog({
      event,
      auth,
      action: 'driver.self_profile_edit',
      targetType: 'driver',
      targetId: auth.lineUid,
      payload: { before: { phone: beforePhone ?? null }, after: { phone: body.phone } },
    });

    return successResponse({ uid: auth.lineUid, updated: true });
  } catch (err) {
    console.error('[drivers/me/profile.patch] Firestore update failed:', err);
    return serverError();
  }
});
