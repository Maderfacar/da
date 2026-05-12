import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { sendLinePush } from '@@/utils/line-push';
import { successResponse, badRequestError, notFoundError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

interface NotifyBody {
  target: 'passenger' | 'driver';
  message: string;
}

const _stripLinePrefix = (id: string): string => (id.startsWith('line:') ? id.slice(5) : id);

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  // 與 broadcast 一致：套 canBroadcast 權限
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要通知權限', en: 'canBroadcast required', ja: '通知権限が必要です' });
  }

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文 ID が不足しています' });
  }

  const body = await readBody<NotifyBody>(event);
  if (!body?.target || (body.target !== 'passenger' && body.target !== 'driver')) {
    return badRequestError({ zh_tw: 'target 必須為 passenger 或 driver', en: 'target must be passenger or driver', ja: 'target は passenger または driver' });
  }
  if (!body.message?.trim()) {
    return badRequestError({ zh_tw: '訊息內容不可為空', en: 'message is required', ja: 'メッセージは必須' });
  }
  if (body.message.length > 2000) {
    return badRequestError({ zh_tw: '訊息過長（最多 2000 字）', en: 'message too long (max 2000)', ja: 'メッセージが長すぎます' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError();
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    // 載訂單
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }
    const order = orderSnap.data() ?? {};

    // 取對應 lineUserId
    let targetLineUserId: string | null = null;
    if (body.target === 'passenger') {
      // 訂單 doc 直接有 lineUserId（passenger）
      targetLineUserId = (order.lineUserId as string) ?? null;
      if (!targetLineUserId) {
        // fallback：從 users/{userId} 撈
        const userId = (order.userId as string) ?? '';
        if (userId) {
          const userSnap = await db.collection('users').doc(userId).get();
          if (userSnap.exists) {
            targetLineUserId = (userSnap.data()?.lineUserId as string) ?? null;
          }
        }
      }
      if (!targetLineUserId) {
        return badRequestError({ zh_tw: '訂單缺少乘客 LINE 資料', en: 'Order missing passenger LINE info', ja: '注文に乗客の LINE 情報がありません' });
      }
    } else {
      // driver：訂單需有 assignedDriverId
      const assignedRaw = (order.assignedDriverId as string) ?? '';
      if (!assignedRaw) {
        return badRequestError({ zh_tw: '訂單尚未指派司機', en: 'Order has no assigned driver', ja: 'ドライバーが未指定' });
      }
      const driverDocId = _stripLinePrefix(assignedRaw);
      const driverSnap = await db.collection('drivers').doc(driverDocId).get();
      if (driverSnap.exists) {
        targetLineUserId = (driverSnap.data()?.lineUserId as string) ?? null;
      }
      if (!targetLineUserId) {
        // fallback：users collection
        const userSnap = await db.collection('users').doc(driverDocId).get();
        if (userSnap.exists) {
          targetLineUserId = (userSnap.data()?.lineUserId as string) ?? null;
        }
      }
      if (!targetLineUserId) {
        return badRequestError({ zh_tw: '司機缺少 LINE 資料', en: 'Driver missing LINE info', ja: 'ドライバーに LINE 情報がありません' });
      }
    }

    // P29：依 target 推到對應 OA（passenger / driver 各自的 channel）
    await sendLinePush(body.target, targetLineUserId, [{ type: 'text', text: body.message }]);

    // P25-2 audit log
    await writeAuditLog({
      event,
      auth,
      action: 'broadcast.notify_one',
      targetType: 'order',
      targetId: orderId,
      payload: { target: body.target, messagePreview: body.message.slice(0, 200) },
    });

    return successResponse({ orderId, target: body.target, sentTo: targetLineUserId });
  } catch (err) {
    console.error('[admin/orders/notify] failed:', err);
    return serverError();
  }
});
