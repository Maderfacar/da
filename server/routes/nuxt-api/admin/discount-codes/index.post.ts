/**
 * POST /nuxt-api/admin/discount-codes
 *
 * 建立折扣碼。code 轉大寫作為 doc id；若已存在則拒絕（避免覆寫 redemptionCount）。
 * Body: { code, discountAmount, validFrom?, validUntil, maxRedemptions?, perUserLimit?,
 *         minFare?, allowedOrderTypes?, enabled? }
 * 權限：canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { normalizeDiscountCode, validateDiscountCodeBody } from '@@/utils/discount-code';

interface PostRes {
  code: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const codeCheck = normalizeDiscountCode(body.code);
  if (!codeCheck.ok) return badRequestError({ zh_tw: codeCheck.error, en: codeCheck.error, ja: codeCheck.error });

  const bodyCheck = validateDiscountCodeBody(body);
  if (!bodyCheck.ok) return badRequestError({ zh_tw: bodyCheck.error, en: bodyCheck.error, ja: bodyCheck.error });

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('discount_codes').doc(codeCheck.value);
    const existing = await ref.get();
    if (existing.exists) {
      return badRequestError({ zh_tw: '折扣碼已存在', en: 'Discount code already exists', ja: '割引コードは既に存在します' });
    }

    const v = bodyCheck.value;
    await ref.set({
      code: codeCheck.value,
      discountAmount: v.discountAmount,
      validFrom: v.validFromMs !== null ? Timestamp.fromMillis(v.validFromMs) : null,
      validUntil: Timestamp.fromMillis(v.validUntilMs),
      maxRedemptions: v.maxRedemptions,
      perUserLimit: v.perUserLimit,
      minFare: v.minFare,
      allowedOrderTypes: v.allowedOrderTypes,
      enabled: v.enabled,
      redemptionCount: 0,
      createdBy: auth.lineUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      event,
      auth,
      action: 'discount_code.create',
      targetType: 'discount_code',
      targetId: codeCheck.value,
      payload: { discountAmount: v.discountAmount, enabled: v.enabled },
    });

    return successResponse<PostRes>({ code: codeCheck.value });
  } catch (err) {
    console.error('[admin/discount-codes POST] failed:', err);
    return serverError();
  }
});
