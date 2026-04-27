import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export default defineEventHandler(async (event) => {
  const { firebaseServiceAccountJson } = useRuntimeConfig();

  if (!firebaseServiceAccountJson) {
    return {
      data: [],
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snapshot = await db.collection('drivers')
      .where('status', 'in', ['online', 'busy'])
      .get();

    const drivers = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        driverId: d.driverId as string,
        displayName: (d.displayName as string) ?? '',
        status: d.status as 'online' | 'busy',
        lat: d.lat as number,
        lng: d.lng as number,
        heading: (d.heading as number | undefined) ?? null,
        updatedAt: d.updatedAt?.toMillis?.() ?? 0,
      };
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
