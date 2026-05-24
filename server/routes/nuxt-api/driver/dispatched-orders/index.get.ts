/**
 * GET /nuxt-api/driver/dispatched-orders — Phase 1E
 *
 * 司機接單看板：列所有「pending && dispatchAt != null && !assignedDriverId」訂單。
 * 不過濾必要條件（B1 拍版：全部 driver 都能看，自己判斷）。
 *
 * Response 每筆含 myBidStatus = 'none' | 'bid' | 'withdrawn'（依當前 driver 在 bids 內狀態）
 *
 * 認證：必須 driver role + approved（與 driver/apply 相同）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { successResponse, forbiddenError, serverError } from '@@/utils/response';
import { serializeOrderPreferences } from '@@/utils/order-preferences';
import { type OrderBidEntry, loadDriverCategory } from '@@/utils/order-dispatch';
import { getNextDowngradeAt } from '@@/utils/dispatch-duration';
import { isDispatchLevel, type DispatchLevel } from '~shared/types/dispatch-visibility';
import type { Timestamp } from 'firebase-admin/firestore';

type GooglePlaceLite = { address: string; lat: number; lng: number; placeId?: string; displayName?: string };

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

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    // Wave 2B+2C：先拉司機分級（缺 driver doc fallback '0' NOVICE）
    const driverCategory = await loadDriverCategory(db, auth.lineUid);

    // 只用單欄位 orderBy('createdAt')（Firestore 自動建單欄位 index，零 composite index 需求），
    // orderStatus / dispatchAt / assignedDriverId 全部改 in-memory filter。
    //
    // 為何不用 where('orderStatus','==','pending') + orderBy('createdAt')：
    //   那會需要 orders 的 `orderStatus + createdAt` composite index，prod 上不一定存在
    //   → query throw failed-precondition → 500 → 司機端列表永遠空白（本 bug 主因）。
    // limit 拉到 300：in-memory filter 後才篩 pending，多撈一些避免被非 pending 訂單擠掉。
    const snap = await db.collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(300)
      .get();

    const myUid = auth.lineUid;

    const dispatched = snap.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .filter(({ data }) =>
        data.orderStatus === 'pending' && !!data.dispatchAt && !data.assignedDriverId,
      )
      // Wave 2B+2C：driver category 必須 >= order currentLevel 才看得到
      // 舊單無 dispatchVisibility → fallback currentLevel='0'（全開），等同無變化
      .filter(({ data }) => {
        const vis = (data.dispatchVisibility ?? null) as { currentLevel?: unknown } | null;
        const currentLevel: DispatchLevel = isDispatchLevel(vis?.currentLevel) ? vis!.currentLevel : '0';
        return driverCategory >= currentLevel; // 字串字典序比 '0'<'1'<'2'
      })
      .map(({ id, data }) => {
        const rawBids = (Array.isArray(data.bids) ? data.bids : []) as OrderBidEntry[];
        const myBid = rawBids.find((b) => b.driverId === myUid);
        let myBidStatus: 'none' | 'bid' | 'withdrawn' = 'none';
        if (myBid) myBidStatus = myBid.withdrawnAt ? 'withdrawn' : 'bid';

        const activeBidCount = rawBids.filter((b) => !b.withdrawnAt).length;

        // Wave 2B+2C：給 UI 倒數用
        const vis = (data.dispatchVisibility ?? null) as
          | { currentLevel?: unknown; openedAt?: Timestamp | null }
          | null;
        const currentLevel: DispatchLevel = isDispatchLevel(vis?.currentLevel) ? vis!.currentLevel : '0';
        const openedAt = (vis?.openedAt ?? null) as Timestamp | null;
        const nextDowngradeAt = getNextDowngradeAt(
          (data.orderType as string) ?? '',
          currentLevel,
          openedAt,
        );

        return {
          orderId: id,
          orderType: (data.orderType as string) ?? '',
          pickupDateTime: (data.pickupDateTime as string) ?? '',
          pickupLocation: data.pickupLocation as GooglePlaceLite,
          dropoffLocation: data.dropoffLocation as GooglePlaceLite,
          stopovers: ((data.stopovers as GooglePlaceLite[] | undefined) ?? []),
          vehicleType: (data.vehicleType as string) ?? '',
          passengerCount: (data.passengerCount as number) ?? 1,
          // Booking v2 批次 2：fallback 舊單無 adult/child
          adultCount: (data.adultCount as number | undefined) ?? ((data.passengerCount as number | undefined) ?? 1),
          childCount: (data.childCount as number | undefined) ?? 0,
          estimatedFare: (data.estimatedFare as number) ?? 0,
          distanceKm: (data.distanceKm as number) ?? 0,
          notes: (data.notes as string | undefined) ?? null,
          flightNumber: (data.flightNumber as string | undefined) ?? null,
          terminal: (data.terminal as string | undefined) ?? null,
          preferences: serializeOrderPreferences(data.preferences),
          dispatchAt: _tsToIso(data.dispatchAt),
          activeBidCount,
          myBidStatus,
          // Wave 2B+2C
          dispatchCurrentLevel: currentLevel,
          dispatchOpenedAt: _tsToIso(openedAt),
          dispatchNextDowngradeAt: _tsToIso(nextDowngradeAt),
        };
      });

    return successResponse(dispatched);
  } catch (err) {
    console.error('[driver/dispatched-orders] failed:', err);
    return serverError();
  }
});
