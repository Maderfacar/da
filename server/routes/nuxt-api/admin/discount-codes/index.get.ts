/**
 * GET /nuxt-api/admin/discount-codes
 *
 * 列出所有折扣碼（依 createdAt 新到舊）。
 * 權限：canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { toDiscountCodeDto, type DiscountCodeDoc, type DiscountCodeDto } from '@@/utils/discount-code';

interface ListRes {
  items: DiscountCodeDto[];
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('discount_codes').get();
    const items: DiscountCodeDto[] = snap.docs
      .map((d) => toDiscountCodeDto({ ...(d.data() as Partial<DiscountCodeDoc>), code: d.id }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return successResponse<ListRes>({ items });
  } catch (err) {
    console.error('[admin/discount-codes GET list] failed:', err);
    return serverError();
  }
});
