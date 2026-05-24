/**
 * GET /nuxt-api/driver/dispatched-orders/:orderId — Phase 1E
 *
 * 司機接單看板 → 訂單詳情頁的資料 endpoint。
 *
 * 設計：
 *   - 與 /nuxt-api/orders/[orderId] 不同：那個 endpoint 要 admin / owner / assigned driver；
 *     本 endpoint 給「approved driver 但尚未被指派」用，唯一條件是訂單仍在派發中
 *   - 訂單必須 status='pending' && dispatchAt != null && !assignedDriverId
 *   - 不回乘客 PII（contactPhone、passengerName）— 接單前 driver 不應看到
 *   - 不回 fareBreakdown 細節（只回 estimatedFare 總額）
 *
 * 認證：driver + approved
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { serializeOrderPreferences } from '@@/utils/order-preferences';
import { type OrderBidEntry, loadDriverCategory } from '@@/utils/order-dispatch';
import { getNextDowngradeAt } from '@@/utils/dispatch-duration';
import { isDispatchLevel, type DispatchLevel } from '~shared/types/dispatch-visibility';
import type { Timestamp } from 'firebase-admin/firestore';

const _tsToIso = (ts: Timestamp | null | undefined): string | null =>
  ts ? ts.toDate().toISOString() : null;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('driver')) {
    return forbiddenError({ zh_tw: '需要司機身分', en: 'Driver role required', ja: 'ドライバー権限が必要です' });
  }
  if (!auth.approved) {
    return forbiddenError({ zh_tw: '司機尚未通過審核', en: 'Driver not approved', ja: 'ドライバー審査未完了' });
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
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '訂單不存在', en: 'Order not found', ja: '注文が見つかりません' });
    }
    const data = snap.data() ?? {};

    // 守 dispatchable
    if (data.orderStatus !== 'pending') {
      return forbiddenError({ zh_tw: '訂單已不在派發中', en: 'Order not dispatching', ja: '注文は派遣中ではありません' });
    }
    if (!data.dispatchAt) {
      return forbiddenError({ zh_tw: '訂單未派發', en: 'Order not dispatched', ja: '注文は未派遣' });
    }
    if (data.assignedDriverId) {
      return forbiddenError({ zh_tw: '訂單已指派其他司機', en: 'Order already assigned', ja: '注文は既に他のドライバーに割り当て済み' });
    }

    // Wave 2B+2C：等級守則 — 司機分級必須 >= order currentLevel
    const vis = (data.dispatchVisibility ?? null) as
      | { currentLevel?: unknown; openedAt?: Timestamp | null }
      | null;
    const currentLevel: DispatchLevel = isDispatchLevel(vis?.currentLevel) ? vis!.currentLevel : '0';
    const driverCategory = await loadDriverCategory(db, auth.lineUid);
    if (driverCategory < currentLevel) {
      return forbiddenError({
        zh_tw: '此訂單尚未開放給您的分級',
        en: 'This order is not yet open to your driver tier',
        ja: 'このご注文はあなたのランクではまだご利用いただけません',
      });
    }
    const openedAt = (vis?.openedAt ?? null) as Timestamp | null;
    const nextDowngradeAt = getNextDowngradeAt((data.orderType as string) ?? '', currentLevel, openedAt);

    const rawBids = (Array.isArray(data.bids) ? data.bids : []) as OrderBidEntry[];
    const myBid = rawBids.find((b) => b.driverId === auth.lineUid);
    let myBidStatus: 'none' | 'bid' | 'withdrawn' = 'none';
    if (myBid) myBidStatus = myBid.withdrawnAt ? 'withdrawn' : 'bid';
    const activeBidCount = rawBids.filter((b) => !b.withdrawnAt).length;

    return successResponse({
      orderId,
      orderType: (data.orderType as string) ?? '',
      orderStatus: (data.orderStatus as string) ?? 'pending',
      pickupDateTime: (data.pickupDateTime as string) ?? '',
      pickupLocation: data.pickupLocation ?? null,
      dropoffLocation: data.dropoffLocation ?? null,
      stopovers: (data.stopovers as unknown[] | undefined) ?? [],
      vehicleType: (data.vehicleType as string) ?? '',
      passengerCount: (data.passengerCount as number) ?? 1,
      // Booking v2 批次 2：fallback 舊單無 adult/child
      adultCount: (data.adultCount as number | undefined) ?? ((data.passengerCount as number | undefined) ?? 1),
      childCount: (data.childCount as number | undefined) ?? 0,
      luggageItems: (data.luggageItems as unknown[] | undefined) ?? [],
      extraServices: (data.extraServices as string[] | undefined) ?? [],
      estimatedFare: (data.estimatedFare as number) ?? 0,
      estimatedTime: (data.estimatedTime as number) ?? 0,
      distanceKm: (data.distanceKm as number) ?? 0,
      flightNumber: (data.flightNumber as string | null) ?? null,
      terminal: (data.terminal as string | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      preferences: serializeOrderPreferences(data.preferences),
      dispatchAt: _tsToIso(data.dispatchAt),
      activeBidCount,
      myBidStatus,
      // Wave 2B+2C
      dispatchCurrentLevel: currentLevel,
      dispatchOpenedAt: _tsToIso(openedAt),
      dispatchNextDowngradeAt: _tsToIso(nextDowngradeAt),
    });
  } catch (err) {
    console.error('[driver/dispatched-orders/:id] failed:', err);
    return serverError();
  }
});
