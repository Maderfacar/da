/**
 * PUT /nuxt-api/admin/discount-codes/[code]
 *
 * 更新既有折扣碼（code 不可改、redemptionCount 不可改）。
 * 切換啟用：傳 enabled。停用 = enabled:false（不提供刪除）。
 * Body: 同 POST 但不含 code。
 * 權限：canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { normalizeDiscountCode, validateDiscountCodeBody } from '@@/utils/discount-code';

interface PutRes {
  code: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const codeCheck = normalizeDiscountCode(getRouterParam(event, 'code'));
  if (!codeCheck.ok) return badRequestError({ zh_tw: codeCheck.error, en: codeCheck.error, ja: codeCheck.error });

  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const bodyCheck = validateDiscountCodeBody(body);
  if (!bodyCheck.ok) return badRequestError({ zh_tw: bodyCheck.error, en: bodyCheck.error, ja: bodyCheck.error });

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('discount_codes').doc(codeCheck.value);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '折扣碼不存在', en: 'Discount code not found', ja: '割引コードが見つかりません' });
    }

    const v = bodyCheck.value;

    // referral-welcome / referral-reward 為系統鑄碼，admin 後台不可改其 source/ownerUid
    const existingSource = snap.data()?.source;
    if (existingSource === 'referral-welcome' || existingSource === 'referral-reward') {
      return badRequestError({
        zh_tw: '推薦系統鑄造的折扣碼不可由 admin 編輯',
        en: 'Referral-minted codes cannot be edited via admin',
        ja: '紹介システムが鋳造した割引コードは管理画面では編集できません',
      });
    }

    // source='driver-referral' 時驗證 ownerUid 對應的 user 確實是 driver
    if (v.source === 'driver-referral' && v.ownerUid) {
      const userSnap = await db.collection('users').doc(v.ownerUid).get();
      if (!userSnap.exists) {
        return badRequestError({ zh_tw: '歸屬司機不存在', en: 'Owner driver not found', ja: '所属ドライバーが存在しません' });
      }
      const roles = userSnap.data()?.roles;
      if (!Array.isArray(roles) || !roles.includes('driver')) {
        return badRequestError({ zh_tw: '指定使用者不是司機', en: 'Specified user is not a driver', ja: '指定されたユーザーはドライバーではありません' });
      }
    }

    await ref.set({
      discountAmount: v.discountAmount,
      validFrom: v.validFromMs !== null ? Timestamp.fromMillis(v.validFromMs) : null,
      validUntil: Timestamp.fromMillis(v.validUntilMs),
      maxRedemptions: v.maxRedemptions,
      perUserLimit: v.perUserLimit,
      minFare: v.minFare,
      allowedOrderTypes: v.allowedOrderTypes,
      enabled: v.enabled,
      source: v.source,
      ownerUid: v.ownerUid,
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await writeAuditLog({
      event,
      auth,
      action: 'discount_code.update',
      targetType: 'discount_code',
      targetId: codeCheck.value,
      payload: { discountAmount: v.discountAmount, enabled: v.enabled, source: v.source, ownerUid: v.ownerUid },
    });

    return successResponse<PutRes>({ code: codeCheck.value });
  } catch (err) {
    console.error('[admin/discount-codes [code] PUT] failed:', err);
    return serverError();
  }
});
