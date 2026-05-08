import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { serverError } from '@@/utils/response';

export default defineEventHandler(async (event) => {
  const { firebaseServiceAccountJson } = useRuntimeConfig();

  if (!firebaseServiceAccountJson) {
    // P15：Firebase 未設不再 silent 回 200 + []，避免戰情室地圖「沒司機」假成功
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db.collection('drivers')
      .where('status', 'in', ['online', 'busy'])
      .get();

    // P18：drivers schema 改為 nested location；保持對外 flat response 不變（戰情室相容）
    // driverId 改用 doc.id（即 lineUid，去 prefix 後）；過濾掉 location 缺失的 doc（剛申請尚未開工）
    const drivers = snapshot.docs.flatMap((doc) => {
      const d = doc.data();
      const loc = d.location as { lat?: number; lng?: number; heading?: number; updatedAt?: { toMillis?: () => number } } | null | undefined;
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return [];
      return [{
        driverId: doc.id,
        displayName: (d.displayName as string) ?? '',
        status: d.status as 'online' | 'busy',
        lat: loc.lat,
        lng: loc.lng,
        heading: typeof loc.heading === 'number' ? loc.heading : null,
        updatedAt: loc.updatedAt?.toMillis?.() ?? 0,
      }];
    });

    return {
      data: drivers,
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
