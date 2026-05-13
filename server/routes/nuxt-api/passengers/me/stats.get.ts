/**
 * GET /nuxt-api/passengers/me/stats — P35 乘客累積統計
 *
 * 用途：profile 頁顯示「我的旅程」區塊
 *
 * 邏輯：
 *   - 撈 orders where userId == auth.lineUid AND orderStatus == 'completed'
 *   - aggregate：count + sum(distanceKm) + sum(estimatedFare)
 *   - cancelled / pending / in_transit 不算
 *
 * 認證：caller 必須登入；強制只能讀自己（不接受 query.userId）
 *
 * Response:
 *   {
 *     totalTrips: number,         // 已完成趟數
 *     totalDistanceKm: number,    // 累計里程
 *     totalSpent: number,         // 累計消費（NT$）
 *     firstTripAt: string | null, // 首次行程 ISO；空陣列回 null
 *   }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);

    // 強制 userId = caller lineUid（即使是 admin 也只能看自己；admin 看別人請走 admin/orders）
    const snapshot = await db.collection('orders')
      .where('userId', '==', auth.lineUid)
      .where('orderStatus', '==', 'completed')
      .get();

    let totalDistanceKm = 0;
    let totalSpent = 0;
    let firstTripMs = Number.POSITIVE_INFINITY;

    snapshot.forEach((doc) => {
      const d = doc.data();
      const distance = typeof d.distanceKm === 'number' ? d.distanceKm : 0;
      const fare = typeof d.estimatedFare === 'number' ? d.estimatedFare : 0;
      totalDistanceKm += distance;
      totalSpent += fare;
      // 用 pickupDateTime（user 預約時間）排序「首次行程」；fallback statusHistory.completedAt
      const pickupStr = d.pickupDateTime as string | undefined;
      const pickupMs = pickupStr ? Date.parse(pickupStr) : 0;
      if (pickupMs > 0 && pickupMs < firstTripMs) firstTripMs = pickupMs;
    });

    return successResponse({
      totalTrips: snapshot.size,
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10, // 一位小數
      totalSpent: Math.round(totalSpent),
      firstTripAt: Number.isFinite(firstTripMs) ? new Date(firstTripMs).toISOString() : null,
    });
  } catch (err) {
    console.error('[passengers/me/stats] Firestore query failed:', err);
    return serverError();
  }
});
