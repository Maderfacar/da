/**
 * POST /nuxt-api/admin/orders/:orderId/assign — Phase 1E + Phase 1F
 *
 * Admin 從某筆 dispatched 訂單的 bids 中挑一個 driver 指派：
 *   - body: { driverId: string }（lineUid 去前綴）
 *   - transaction 守 status='pending' && !assignedDriverId && driverId ∈ active bids
 *   - 寫入 assignedDriverId='line:Uxxx' / orderStatus='confirmed' / assignedAt / assignedBy
 *   - Phase 1F：依乘客偏好命中數判 Soft Match
 *       - 完全命中（或 0 偏好）→ passengerConfirmationStatus='auto'，正常通知配對成功
 *       - 部分 / 0 命中     → passengerConfirmationStatus='pending'，推 3 選 1 Flex
 *   - 推 LINE：driver（中選通知）；passenger（auto: 配對成功 / pending: Soft Match Flex）
 *   - audit log: action='order.assign'（含 driverId snapshot + confirmationStatus）
 *
 * 認證：admin + canManageOrders
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { assignDriver, DispatchGuardError } from '@@/utils/order-dispatch';
import { decideConfirmationStatus } from '@@/utils/order-soft-match';
import { buildTagIndex } from '@@/utils/vehicle-profile';
import { buildDispatchTagIndex, computeDriverMatch } from '~shared/orderDispatch';
import { getUserLang } from '@@/utils/i18n-message';
import {
  pushOrderAssignedToPassenger,
  pushOrderAssignedToDriver,
  getDispatchPushEnv,
} from '@@/utils/line-dispatch-push';
import { pushSoftMatchToPassenger } from '@@/utils/line-soft-match-push';

interface PostBody {
  driverId?: string;
}

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

  const body = await readBody<PostBody>(event).catch(() => null);
  const rawDriverId = typeof body?.driverId === 'string' ? body.driverId.trim() : '';
  if (!rawDriverId) {
    return badRequestError({ zh_tw: '缺少 driverId', en: 'driverId required', ja: 'driverId が必要です' });
  }
  const driverLineUid = rawDriverId.startsWith('line:') ? rawDriverId.slice(5) : rawDriverId;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    try {
      await assignDriver(db, orderId, driverLineUid, auth.lineUid);
    } catch (err) {
      if (err instanceof DispatchGuardError) {
        if (err.code === 'order_not_found') {
          return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
        }
        if (err.code === 'invalid_status') {
          return badRequestError({ zh_tw: '訂單狀態不可指派', en: 'Order not in dispatchable state', ja: '注文ステータスは派遣不可' });
        }
        if (err.code === 'already_assigned') {
          return badRequestError({ zh_tw: '訂單已指派司機', en: 'Order already assigned', ja: '注文は既に割り当て済み' });
        }
        if (err.code === 'driver_not_in_bids') {
          return badRequestError({ zh_tw: '該司機未在喊單清單', en: 'Driver not in active bids', ja: 'このドライバーは入札していません' });
        }
      }
      throw err;
    }

    // 撈最新 order + driver 資料給推播 / audit / Soft Match 判定用
    const [orderSnap, driverUserSnap, driverProfileSnap] = await Promise.all([
      db.collection('orders').doc(orderId).get(),
      db.collection('users').doc(driverLineUid).get(),
      db.collection('drivers').doc(driverLineUid).get(),
    ]);
    const orderData = orderSnap.data() ?? {};
    const driverUserData = driverUserSnap.exists ? (driverUserSnap.data() ?? {}) : {};
    const driverProfileData = driverProfileSnap.exists ? (driverProfileSnap.data() ?? {}) : {};
    const driverDisplayName = (driverUserData.displayName as string | undefined) ?? '';
    const driverLineUserId = (driverUserData.lineUserId as string | undefined) ?? driverLineUid;

    const env = getDispatchPushEnv();
    const passengerLineUid = (orderData.lineUserId as string | undefined) || (orderData.userId as string | undefined) || '';
    const pickupDateTime = (orderData.pickupDateTime as string) ?? '';
    const pickupAddress = (orderData.pickupLocation?.displayName as string) || (orderData.pickupLocation?.address as string) || '';
    const dropoffAddress = (orderData.dropoffLocation?.displayName as string) || (orderData.dropoffLocation?.address as string) || '';
    const passengerCount = (orderData.passengerCount as number) ?? 1;

    // Phase 1F：計算 Soft Match
    const preferences = orderData.preferences as { tagIds?: unknown } | undefined;
    const preferenceTagIds: string[] = Array.isArray(preferences?.tagIds) ? (preferences!.tagIds as string[]) : [];
    const vehicleProfileTags: string[] = Array.isArray((driverProfileData.vehicleProfile as { tags?: unknown } | undefined)?.tags)
      ? ((driverProfileData.vehicleProfile as { tags: string[] }).tags)
      : [];
    const driverScopeTags: string[] = Array.isArray(driverProfileData.tags) ? (driverProfileData.tags as string[]) : [];
    const completedOrders = typeof driverProfileData.totalTrips === 'number' ? driverProfileData.totalTrips : 0;

    const tagIdx = await buildTagIndex(db);
    const dispatchIndex = buildDispatchTagIndex(
      Array.from(tagIdx.values()).map((t) => ({
        id: t.id,
        name: { zh_tw: t.nameZh },
        group: t.group,
      })),
    );

    // 拿 passenger 語系（給 Soft Match Flex / 配對成功 Flex 用）
    const passengerLang = passengerLineUid ? await getUserLang(db, passengerLineUid) : 'zh_tw';
    const matchResult = computeDriverMatch(
      preferenceTagIds,
      { driverId: driverLineUid, vehicleProfileTags, driverScopeTags },
      dispatchIndex,
      passengerLang,
    );

    const { isSoft, confirmationStatus } = decideConfirmationStatus(preferenceTagIds, matchResult);

    // 寫 passengerConfirmationStatus（transaction 外，但 assign 已落定，這裡單純 patch field）
    try {
      await db.collection('orders').doc(orderId).update({ passengerConfirmationStatus: confirmationStatus });
    } catch (err) {
      console.error('[admin/orders/assign] write confirmationStatus failed:', err);
    }

    // 算 unmatched tag names（Soft Match Flex 用；matched 已在 matchResult.matched）
    let unmatchedTagNames: string[] = [];
    if (isSoft) {
      const matchedSet = new Set(matchResult.matched.map((m) => m.id));
      unmatchedTagNames = preferenceTagIds
        .filter((id) => !matchedSet.has(id))
        .map((id) => {
          const entry = dispatchIndex.get(id);
          return entry ? (entry.name.zh_tw || id) : id;
        });
    }

    // fire-and-forget：driver push（不論 soft）
    void (async () => {
      try {
        await pushOrderAssignedToDriver(driverLineUserId, {
          orderId,
          pickupDateTime,
          pickupAddress,
          dropoffAddress,
          passengerCount,
        }, env);
      } catch (err) {
        console.error('[admin/orders/assign] driver push failed:', err);
      }
    })();

    // fire-and-forget：passenger push（依 isSoft 分流）
    void (async () => {
      try {
        if (!passengerLineUid) return;
        if (isSoft) {
          await pushSoftMatchToPassenger(passengerLineUid, {
            orderId,
            pickupDateTime,
            driverDisplayName,
            driverId: driverLineUid,
            completedOrders,
            matchedTagNames: matchResult.matched.map((m) => m.name),
            unmatchedTagNames,
            preferenceCount: matchResult.preferenceCount,
            matchCount: matchResult.matchCount,
          }, env, passengerLang);
        } else {
          await pushOrderAssignedToPassenger(passengerLineUid, {
            orderId,
            pickupDateTime,
            driverDisplayName,
            driverId: driverLineUid,
          }, env, passengerLang);
        }
      } catch (err) {
        console.error('[admin/orders/assign] passenger push failed:', err);
      }
    })();

    await writeAuditLog({
      event,
      auth,
      action: 'order.assign',
      targetType: 'order',
      targetId: orderId,
      payload: {
        driverId: driverLineUid,
        driverDisplayName,
        via: 'dispatch_bid',
        confirmationStatus,
        matchCount: matchResult.matchCount,
        preferenceCount: matchResult.preferenceCount,
      },
    });

    return successResponse({
      orderId,
      driverId: driverLineUid,
      assigned: true,
      passengerConfirmationStatus: confirmationStatus,
      matchCount: matchResult.matchCount,
      preferenceCount: matchResult.preferenceCount,
    });
  } catch (err) {
    console.error('[admin/orders/assign] failed:', err);
    return serverError();
  }
});
