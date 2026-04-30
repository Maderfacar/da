import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, badRequestError, notFoundError, serverError } from '@@/utils/response';

interface PatchOrderBody {
  orderStatus?: string;
  assignedDriverId?: string;
}

export default defineEventHandler(async (event) => {
  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文 ID が不足しています' });
  }

  const body = await readBody<PatchOrderBody>(event);
  const updates: Record<string, string> = {};
  if (body.orderStatus) updates.orderStatus = body.orderStatus;
  if (body.assignedDriverId !== undefined) updates.assignedDriverId = body.assignedDriverId;

  if (!Object.keys(updates).length) {
    return badRequestError({ zh_tw: '沒有可更新的欄位', en: 'No fields to update', ja: '更新するフィールドがありません' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError();
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }
    await ref.update(updates);
    return successResponse({ orderId, ...updates });
  } catch (err) {
    console.error('[orders/patch] Firestore update failed:', err);
    return serverError();
  }
});
