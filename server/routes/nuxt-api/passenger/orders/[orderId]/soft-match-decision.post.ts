/**
 * POST /nuxt-api/passenger/orders/:orderId/soft-match-decision — Phase 1F
 *
 * Passenger 對 Soft Match Flex 的 3 選 1 回應：
 *   - body: { decision: 'accept' | 'wait' | 'cancel' }
 *   - Auth: order owner（lineUid match orderData.userId 或 orderData.lineUserId）
 *           ── 此 endpoint 也可由 webhook postback 內部呼叫（不會通過 auth；
 *               postback handler 在 LINE webhook 內已驗 source.userId 對齊 owner）
 *   - 守則：order.passengerConfirmationStatus === 'pending'
 *
 * 三分支動作：
 *   - accept：寫 passengerConfirmationStatus='accepted'；訂單繼續執行
 *   - wait：呼叫 rematchOrder()（同 admin force rematch）；推 3 推播
 *   - cancel：呼叫 declineSoftMatch()；訂單 → cancelled；推 deselect 給原 driver
 *
 * audit：passenger 動作仍寫 audit_logs（追蹤用，與 P25-2 慣例略不同；
 *       因為 soft-match decision 直接影響配對狀態，方便事後 debug）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import {
  acceptSoftMatch,
  declineSoftMatch,
  rematchOrder,
} from '@@/utils/order-soft-match';
import { DispatchGuardError, loadActiveDrivers } from '@@/utils/order-dispatch';
import {
  pushOrderDispatchToDrivers,
  getDispatchPushEnv,
} from '@@/utils/line-dispatch-push';
import { pushDriverDeselected, pushPassengerRematch } from '@@/utils/line-soft-match-push';
import { buildTagIndex } from '@@/utils/vehicle-profile';
import { getUserLang } from '@@/utils/i18n-message';

type Decision = 'accept' | 'wait' | 'cancel';

interface PostBody {
  decision?: Decision;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const orderId = getRouterParam(event, 'orderId');
  if (!orderId) {
    return badRequestError({ zh_tw: '缺少訂單 ID', en: 'Missing orderId', ja: '注文IDが必要です' });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  const decision = body?.decision;
  if (decision !== 'accept' && decision !== 'wait' && decision !== 'cancel') {
    return badRequestError({
      zh_tw: 'decision 必須為 accept / wait / cancel',
      en: 'decision must be accept / wait / cancel',
      ja: 'decision は accept / wait / cancel のいずれか',
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    // 取訂單守 owner
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }
    const orderData = orderSnap.data() ?? {};
    const orderUserId = (orderData.userId as string | undefined) ?? '';
    const orderLineUserId = (orderData.lineUserId as string | undefined) ?? '';
    const isOwner = orderUserId === auth.lineUid || orderLineUserId === auth.lineUid;
    if (!isOwner) {
      return forbiddenError({
        zh_tw: '無權變更此訂單',
        en: 'Not authorized for this order',
        ja: 'この注文への権限がありません',
      });
    }

    const env = getDispatchPushEnv();
    const passengerLineUid = orderLineUserId || orderUserId;
    const pickupDateTime = (orderData.pickupDateTime as string) ?? '';
    const pickupAddress = (orderData.pickupLocation?.displayName as string) || (orderData.pickupLocation?.address as string) || '';
    const dropoffAddress = (orderData.dropoffLocation?.displayName as string) || (orderData.dropoffLocation?.address as string) || '';
    const passengerCount = (orderData.passengerCount as number) ?? 1;
    const estimatedFare = (orderData.estimatedFare as number) ?? 0;

    if (decision === 'accept') {
      try {
        await acceptSoftMatch(db, orderId);
      } catch (err) {
        if (err instanceof DispatchGuardError) {
          if (err.code === 'order_not_found') {
            return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
          }
          if (err.code === 'invalid_status') {
            return badRequestError({
              zh_tw: '訂單狀態不可接受配對（須為待乘客確認）',
              en: 'Order not in pending-confirmation state',
              ja: '注文ステータスは確認待ちではありません',
            });
          }
        }
        throw err;
      }
      await writeAuditLog({
        event,
        auth,
        action: 'order.soft_match_response',
        targetType: 'order',
        targetId: orderId,
        payload: { decision: 'accept' },
      });
      return successResponse({ orderId, decision: 'accept', orderStatus: 'confirmed', passengerConfirmationStatus: 'accepted' });
    }

    if (decision === 'wait') {
      // 守 passenger 只在 confirmationStatus='pending' 才允許 → rematchOrder 內 transaction
      // 守 'confirmed'+ driverId 必存在；額外檢查：confirmationStatus 必須 'pending'
      if (orderData.passengerConfirmationStatus !== 'pending') {
        return badRequestError({
          zh_tw: '訂單目前非待確認狀態',
          en: 'Order not in pending-confirmation state',
          ja: '注文ステータスは確認待ちではありません',
        });
      }

      let prevDriverLineUid: string;
      let reMatchRound: number;
      try {
        const r = await rematchOrder(db, orderId, 'rematched_by_passenger');
        prevDriverLineUid = r.prevDriverLineUid;
        reMatchRound = r.reMatchRound;
      } catch (err) {
        if (err instanceof DispatchGuardError) {
          if (err.code === 'invalid_status') {
            return badRequestError({
              zh_tw: '訂單狀態不可重新配對',
              en: 'Order not eligible for re-matching',
              ja: '再マッチングできません',
            });
          }
        }
        throw err;
      }

      // 撈原 driver lineUserId
      const prevDriverSnap = await db.collection('users').doc(prevDriverLineUid).get();
      const prevDriverLineUserId = (prevDriverSnap.exists ? (prevDriverSnap.data()?.lineUserId as string | undefined) : undefined) ?? prevDriverLineUid;

      // 偏好 chips
      const tagIdx = await buildTagIndex(db);
      const preferences = orderData.preferences as { tagIds?: unknown } | undefined;
      const preferenceTagIds: string[] = Array.isArray(preferences?.tagIds) ? (preferences!.tagIds as string[]) : [];
      const preferenceChips = preferenceTagIds
        .map((id) => tagIdx.get(id)?.nameZh ?? '')
        .filter((s) => s.length > 0);

      // 3 個 fire-and-forget push
      void (async () => {
        try {
          await pushDriverDeselected(prevDriverLineUserId, { orderId, pickupDateTime });
        } catch (err) {
          console.error('[passenger/soft-match-decision/wait] deselect push failed:', err);
        }
      })();
      void (async () => {
        try {
          const drivers = await loadActiveDrivers(db);
          await pushOrderDispatchToDrivers({
            orderId,
            pickupDateTime,
            pickupAddress,
            dropoffAddress,
            passengerCount,
            estimatedFare,
            preferenceChips,
          }, env, drivers.map((d) => d.lineUserId));
        } catch (err) {
          console.error('[passenger/soft-match-decision/wait] dispatch push failed:', err);
        }
      })();
      void (async () => {
        try {
          const lang = await getUserLang(db, passengerLineUid);
          await pushPassengerRematch(passengerLineUid, { orderId, pickupDateTime }, lang);
        } catch (err) {
          console.error('[passenger/soft-match-decision/wait] passenger push failed:', err);
        }
      })();

      await writeAuditLog({
        event,
        auth,
        action: 'order.soft_match_response',
        targetType: 'order',
        targetId: orderId,
        payload: { decision: 'wait', reMatchRound, prevDriverId: prevDriverLineUid },
      });
      return successResponse({ orderId, decision: 'wait', orderStatus: 'pending', reMatchRound });
    }

    // decision === 'cancel'
    if (orderData.passengerConfirmationStatus !== 'pending') {
      return badRequestError({
        zh_tw: '訂單目前非待確認狀態',
        en: 'Order not in pending-confirmation state',
        ja: '注文ステータスは確認待ちではありません',
      });
    }
    let prevDriverLineUid: string;
    try {
      const r = await declineSoftMatch(db, orderId, 'passenger_soft_match_declined');
      prevDriverLineUid = r.prevDriverLineUid;
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        if (err.code === 'invalid_status') {
          return badRequestError({
            zh_tw: '訂單狀態不可取消',
            en: 'Order not in cancellable state',
            ja: 'キャンセルできません',
          });
        }
      }
      throw err;
    }

    // 通知原中選 driver：訂單已取消（沿用 deselect 文案）
    void (async () => {
      try {
        if (!prevDriverLineUid) return;
        const prevDriverSnap = await db.collection('users').doc(prevDriverLineUid).get();
        const prevDriverLineUserId = (prevDriverSnap.exists ? (prevDriverSnap.data()?.lineUserId as string | undefined) : undefined) ?? prevDriverLineUid;
        await pushDriverDeselected(prevDriverLineUserId, { orderId, pickupDateTime });
      } catch (err) {
        console.error('[passenger/soft-match-decision/cancel] deselect push failed:', err);
      }
    })();

    await writeAuditLog({
      event,
      auth,
      action: 'order.soft_match_response',
      targetType: 'order',
      targetId: orderId,
      payload: { decision: 'cancel', prevDriverId: prevDriverLineUid },
    });

    return successResponse({ orderId, decision: 'cancel', orderStatus: 'cancelled', passengerConfirmationStatus: 'declined' });
  } catch (err) {
    console.error('[passenger/orders/soft-match-decision] failed:', err);
    return serverError();
  }
});
