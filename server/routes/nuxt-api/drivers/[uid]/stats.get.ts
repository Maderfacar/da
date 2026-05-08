import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, badRequestError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

export default defineEventHandler(async (event) => {
  // P14：必須登入；只能讀自己（除非 admin）
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: '缺少司機 ID', en: 'Missing uid', ja: 'ドライバー ID が不足しています' });
  }

  // P14：caller 必須是 driver 本人或 admin（uid 兩種格式都比對）
  const isAdmin = auth.roles.includes('admin');
  const uidAsLineUid = uid.startsWith('line:') ? uid.slice(5) : uid;
  const isSelf = auth.uid === uid || auth.lineUid === uidAsLineUid;
  if (!isAdmin && !isSelf) {
    return forbiddenError({ zh_tw: '無權讀取他人統計', en: 'Cannot read other driver stats', ja: '他人の統計は読めません' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    // P15：Firebase 未設不再 silent 回 200 + 0，避免 dashboard 顯示假數據
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
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
