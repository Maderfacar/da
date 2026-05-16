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
    await ref.set({
      discountAmount: v.discountAmount,
      validFrom: v.validFromMs !== null ? Timestamp.fromMillis(v.validFromMs) : null,
      validUntil: Timestamp.fromMillis(v.validUntilMs),
      maxRedemptions: v.maxRedemptions,
      perUserLimit: v.perUserLimit,
      minFare: v.minFare,
      allowedOrderTypes: v.allowedOrderTypes,
      enabled: v.enabled,
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await writeAuditLog({
      event,
      auth,
      action: 'discount_code.update',
      targetType: 'discount_code',
      targetId: codeCheck.value,
      payload: { discountAmount: v.discountAmount, enabled: v.enabled },
    });

    return successResponse<PutRes>({ code: codeCheck.value });
  } catch (err) {
    console.error('[admin/discount-codes [code] PUT] failed:', err);
    return serverError();
  }
});
