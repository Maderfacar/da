/**
 * POST /nuxt-api/discount-codes/validate
 *
 * 乘客輸入折扣碼後即時預覽折抵金額。登入即可（不需特殊權限）。
 * Body: { code: string; fare: number; orderType: string }
 *
 * 回傳一律 200：
 *   - 可用：{ valid: true, discountAmount, failCode: null, reason: null }
 *   - 不可用：{ valid: false, discountAmount: 0, failCode, reason }（reason 三語）
 * 驗證「失敗」非 HTTP error — 讓前端可直接內嵌顯示原因。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { validateDiscountCode, type DiscountFailCode } from '@@/utils/discount-code';
import type { I18nMsg } from '@@/utils/response';

interface ValidateBody {
  code?: unknown;
  fare?: unknown;
  orderType?: unknown;
}

interface ValidateRes {
  valid: boolean;
  discountAmount: number;
  failCode: DiscountFailCode | null;
  reason: I18nMsg | null;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const body = await readBody<ValidateBody>(event).catch(() => null);
  const code = typeof body?.code === 'string' ? body.code : '';
  const fare = Number(body?.fare);
  const orderType = typeof body?.orderType === 'string' ? body.orderType : '';

  if (!code || !Number.isFinite(fare) || fare <= 0 || !orderType) {
    return badRequestError({
      zh_tw: '缺少必要欄位（code / fare / orderType）',
      en: 'Missing required fields (code / fare / orderType)',
      ja: '必須フィールドが不足しています（code / fare / orderType）',
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const result = await validateDiscountCode(db, {
      code,
      fare,
      orderType,
      userId: auth.lineUid,
    });

    if (result.ok) {
      return successResponse<ValidateRes>({
        valid: true,
        discountAmount: result.discountAmount,
        failCode: null,
        reason: null,
      });
    }
    return successResponse<ValidateRes>({
      valid: false,
      discountAmount: 0,
      failCode: result.code,
      reason: result.reason,
    });
  } catch (err) {
    console.error('[discount-codes/validate] failed:', err);
    return serverError();
  }
});
