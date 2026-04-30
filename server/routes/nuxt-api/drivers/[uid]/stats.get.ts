import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, badRequestError, serverError } from '@@/utils/response';

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: '缺少司機 ID', en: 'Missing uid', ja: 'ドライバー ID が不足しています' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return successResponse({ tripsToday: 0, earningsToday: 0 });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayIsoStart = todayStart.toISOString().slice(0, 10);
    const todayIsoEnd = todayEnd.toISOString().slice(0, 10) + 'T23:59:59';

    const snapshot = await db
      .collection('orders')
      .where('assignedDriverId', '==', uid)
      .where('orderStatus', '==', 'completed')
      .where('pickupDateTime', '>=', todayIsoStart)
      .where('pickupDateTime', '<=', todayIsoEnd)
      .get();

    let earningsToday = 0;
    snapshot.docs.forEach((doc) => {
      earningsToday += (doc.data().estimatedFare as number) ?? 0;
    });

    return successResponse({ tripsToday: snapshot.size, earningsToday });
  } catch (err) {
    console.error('[drivers/stats] Firestore query failed:', err);
    return serverError();
  }
});
