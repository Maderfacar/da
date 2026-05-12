/**
 * PATCH /nuxt-api/admin/drivers/:uid
 * 管理員編輯司機 profile 業務欄位（P26）
 *
 * 開放欄位：
 *   - phone：聯絡電話
 *
 * 不開放（P26 spec）：
 *   - driverName / plateNumber / vehicleType / bankCode / bankAccount
 *     （牽涉 trip matching + 收款）
 *   - approved / roles / rejectedAt 等：走 PATCH /nuxt-api/admin/users/:uid
 *
 * 認證：require admin + canManageDrivers 權限
 *
 * 對應 docs/decision-log.md P26 條目
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

interface PatchBody {
  phone?: string;
}

const TW_MOBILE_RE = /^09\d{8}$/;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }
  if (!hasPermission(auth, 'canManageDrivers')) {
    return forbiddenError({ zh_tw: '需要司機管理權限', en: 'canManageDrivers required', ja: 'ドライバー管理権限が必要です' });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: 'uid 缺失', en: 'uid is required', ja: 'uidが必要です' });
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
    const driverRef = db.collection('drivers').doc(uid);
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
      action: 'driver.profile_edit',
      targetType: 'driver',
      targetId: uid,
      payload: { before: { phone: beforePhone ?? null }, after: { phone: body.phone } },
    });

    return successResponse({ uid, updated: true });
  } catch (err) {
    console.error('[admin/drivers/[uid].patch] Firestore update failed:', err);
    return serverError();
  }
});
