import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { serverError } from '@@/utils/response';
import { settleOnlineSessionPatch, type DriverStatsDoc } from '@@/utils/driver-stats';

// P19：撈所有 location 不為 null 的 drivers（不限 status='online'/'busy'），讓 war-room
// 能切「全部 / 上線 / 任務中 / 離線」filter；offline 由 client-side 比對 lastActiveAt 推導
// （> 600 秒沒更新 → derivedStatus='offline'）。
//
// busy driver 額外回傳 activeOrder（取一張執行中訂單的 orderId + orderStatus）讓 war-room
// 側邊面板顯示「任務中：訂單 #XXXXXX」。
const EXECUTING_STATUSES = ['en_route', 'arrived_pickup', 'in_transit'];

export default defineEventHandler(async (_event) => {
  const { firebaseServiceAccountJson } = useRuntimeConfig();

  if (!firebaseServiceAccountJson) {
    // P15：Firebase 未設不再 silent 回 200 + []，避免戰情室地圖「沒司機」假成功
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    // P19：撈所有 drivers（不再 where status in [online, busy]），只過濾掉沒位置資料的
    const snapshot = await db.collection('drivers').get();

    // P25-1：fallback — driver online 但 lastActiveAt > 5 分鐘前 → 視為 offline + lazy 結算 online 段
    // 涵蓋 driver 關 app 沒按下線的情境（避免 online hours 一直累加假時數）
    const STALE_THRESHOLD_MS = 5 * 60 * 1000;
    const nowMs = Date.now();
    const settleTasks: Promise<unknown>[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data() as DriverStatsDoc;
      if (data.status !== 'online') continue;
      const lastActiveMs = data.lastActiveAt?.toMillis?.() ?? 0;
      if (lastActiveMs === 0 || nowMs - lastActiveMs < STALE_THRESHOLD_MS) continue;

      const patch = settleOnlineSessionPatch(data, lastActiveMs); // 用 lastActiveAt 結算，不算「離線後」時數
      if (patch) {
        settleTasks.push(
          db.collection('drivers').doc(doc.id).set({
            ...patch,
            status: 'offline',
          }, { merge: true }).catch((err) => {
            console.warn('[drivers/available.get] stale settle failed:', doc.id, err);
          }),
        );
      } else {
        // 沒有 currentOnlineSessionStartAt 也要切 offline
        settleTasks.push(
          db.collection('drivers').doc(doc.id).set({ status: 'offline' }, { merge: true }).catch(() => null),
        );
      }
    }
    if (settleTasks.length > 0) await Promise.all(settleTasks);

    // P18：drivers schema 改為 nested location；保持對外 flat response 不變（戰情室相容）
    // P19：filter 改在 application 層，過濾掉 location 缺失的 doc
    const driversWithLocation = snapshot.docs.flatMap((doc) => {
      const d = doc.data();
      const loc = d.location as {
        lat?: number;
        lng?: number;
        heading?: number;
        accuracy?: number;
        updatedAt?: { toMillis?: () => number };
      } | null | undefined;
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return [];

      // P19 過渡期容錯：P18 既有資料可能仍有 status='offline'（migration 未做或剛申請的 driver 預設值）；
      // war-room 不再依賴 'offline' 寫入值，但仍要把 P18 既有 'offline' / 'pending' 等 normalize 為 'online'，
      // 讓 client derivedStatus（基於 lastActiveAt）正確判定
      const rawStatus = d.status;
      const status: 'online' | 'busy' = rawStatus === 'busy' ? 'busy' : 'online';
      const lastActiveAt = (d.lastActiveAt as { toMillis?: () => number } | undefined)?.toMillis?.()
        ?? loc.updatedAt?.toMillis?.()
        ?? 0;

      return [{
        driverId: doc.id,
        displayName: (d.displayName as string) ?? '',
        status,
        lat: loc.lat,
        lng: loc.lng,
        heading: typeof loc.heading === 'number' ? loc.heading : null,
        accuracy: typeof loc.accuracy === 'number' ? loc.accuracy : null,
        updatedAt: loc.updatedAt?.toMillis?.() ?? 0,
        lastActiveAt,
      }];
    });

    // P19：busy driver 補 activeOrder（取一張執行中訂單），並行 query 提升效能
    // P19 hotfix：兼容雙格式（既有資料可能無 prefix；新資料統一帶 prefix）
    const busyDrivers = driversWithLocation.filter((d) => d.status === 'busy');
    const activeOrderMap = new Map<string, { orderId: string; orderStatus: string }>();
    await Promise.all(
      busyDrivers.map(async (d) => {
        try {
          const orderSnap = await db.collection('orders')
            .where('assignedDriverId', 'in', [`line:${d.driverId}`, d.driverId])
            .where('orderStatus', 'in', EXECUTING_STATUSES)
            .limit(1)
            .get();
          if (!orderSnap.empty) {
            const orderDoc = orderSnap.docs[0];
            if (!orderDoc) return;
            const orderData = orderDoc.data();
            activeOrderMap.set(d.driverId, {
              orderId: orderData.orderId as string,
              orderStatus: orderData.orderStatus as string,
            });
          }
        } catch (err) {
          console.error(`[drivers/available.get] active order query failed for ${d.driverId}:`, err);
        }
      })
    );

    const result = driversWithLocation.map((d) => ({
      ...d,
      activeOrder: activeOrderMap.get(d.driverId) ?? null,
    }));

    return {
      data: result,
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  } catch (err) {
    console.error('[drivers/available.get] Firestore query failed:', err);
    return {
      data: [],
      status: { code: 500, message: { zh_tw: '伺服器錯誤', en: 'Server error', ja: 'サーバーエラー' } },
    };
  }
});
