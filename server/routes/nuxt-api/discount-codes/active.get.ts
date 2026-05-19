/**
 * GET /nuxt-api/discount-codes/active
 *
 * 列出目前生效中的折扣碼，供首頁優惠專區展示。登入即可（不需特殊權限）。
 * 「生效中」= enabled && 在 validFrom~validUntil 區間 && 未達 maxRedemptions。
 * 僅回公開安全欄位（不含 createdBy / redemptionCount / perUserLimit 等內部欄位）。
 * 依 discountAmount 大到小排序。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { isDiscountCodeActive, type DiscountCodeDoc } from '@@/utils/discount-code';

interface PublicDiscountCode {
  code: string;
  discountAmount: number;
  validUntil: string | null;
  minFare: number | null;
  allowedOrderTypes: string[] | null;
}

interface ActiveRes {
  items: PublicDiscountCode[];
}

function tsToIso(v: unknown): string | null {
  const d = (v as { toDate?: () => Date } | null)?.toDate?.();
  return d ? d.toISOString() : null;
}

function tsToMs(v: unknown): number | null {
  const d = (v as { toDate?: () => Date } | null)?.toDate?.();
  return d ? d.getTime() : null;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('discount_codes').get();
    const nowMs = Date.now();

    const items: PublicDiscountCode[] = snap.docs
      .map((doc) => {
        const d = doc.data() as Partial<DiscountCodeDoc>;
        return {
          code: doc.id,
          data: d,
          active: isDiscountCodeActive(
            {
              discountAmount: typeof d.discountAmount === 'number' ? d.discountAmount : 0,
              validFromMs: tsToMs(d.validFrom),
              validUntilMs: tsToMs(d.validUntil) ?? 0,
              maxRedemptions: typeof d.maxRedemptions === 'number' ? d.maxRedemptions : null,
              perUserLimit: null,
              minFare: null,
              allowedOrderTypes: null,
              enabled: d.enabled === true,
              redemptionCount: typeof d.redemptionCount === 'number' ? d.redemptionCount : 0,
            },
            nowMs,
          ),
        };
      })
      .filter((x) => x.active)
      .map((x) => ({
        code: x.code,
        discountAmount: typeof x.data.discountAmount === 'number' ? x.data.discountAmount : 0,
        validUntil: tsToIso(x.data.validUntil),
        minFare: typeof x.data.minFare === 'number' ? x.data.minFare : null,
        allowedOrderTypes: Array.isArray(x.data.allowedOrderTypes) ? x.data.allowedOrderTypes : null,
      }))
      .sort((a, b) => b.discountAmount - a.discountAmount);

    return successResponse<ActiveRes>({ items });
  } catch (err) {
    console.error('[discount-codes/active GET] failed:', err);
    return serverError();
  }
});
