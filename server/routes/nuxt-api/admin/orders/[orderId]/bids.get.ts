/**
 * GET /nuxt-api/admin/orders/:orderId/bids — Phase 1E
 *
 * 回某筆訂單的所有 bids（含撤回的）+ 對應 driver 的 matchCount / completedOrders / verifiedAt。
 *
 * 認證：admin + canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { loadBidsWithDriverInfo } from '@@/utils/order-dispatch';
import { buildTagIndex } from '@@/utils/vehicle-profile';
import { buildDispatchTagIndex } from '~shared/orderDispatch';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({ zh_tw: '需要訂單管理權限', en: 'canManageOrders required', ja: '注文管理権限が必要です' });
  }

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文IDが必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    // 借用 1B 的 buildTagIndex（id / group / nameZh），補上 ja/en name 給 dispatch 用
    // 簡化：1E 計算 match 時 admin UI 顯示繁中即可（拍版 #16）
    const tagIdx = await buildTagIndex(db);
    const dispatchIndex = buildDispatchTagIndex(
      Array.from(tagIdx.values()).map((t) => ({
        id: t.id,
        name: { zh_tw: t.nameZh },
        group: t.group,
      })),
    );

    const { orderExists, preferenceTagIds, bids } = await loadBidsWithDriverInfo(
      db,
      orderId,
      dispatchIndex,
      'zh_tw',
    );
    if (!orderExists) {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }
    return successResponse({ preferenceTagIds, bids });
  } catch (err) {
    console.error('[admin/orders/bids] failed:', err);
    return serverError();
  }
});
