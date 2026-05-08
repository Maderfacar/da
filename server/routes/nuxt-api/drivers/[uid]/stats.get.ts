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

    // P18：改從 drivers/{lineUid} 累積欄位讀取，取代原 orders aggregate query
    // 容錯：drivers doc 不存在（歷史 admin 帳號 / 未走 apply）→ 全部回 0
    const snap = await db.collection('drivers').doc(uidAsLineUid).get();
    const data = snap.exists ? (snap.data() ?? {}) : {};

    const todayTrips = (data.todayTrips as number) ?? 0;
    const todayEarnings = (data.todayEarnings as number) ?? 0;
    const totalTrips = (data.totalTrips as number) ?? 0;
    const totalEarnings = (data.totalEarnings as number) ?? 0;
    const totalDistanceKm = (data.totalDistanceKm as number) ?? 0;

    // 舊欄位 (tripsToday/earningsToday) 保留供既有 client 相容；新欄位（totalTrips 等）併同回傳
    return successResponse({
      tripsToday: todayTrips,
      earningsToday: todayEarnings,
      todayTrips,
      todayEarnings,
      totalTrips,
      totalEarnings,
      totalDistanceKm,
    });
  } catch (err) {
    console.error('[drivers/stats] Firestore read failed:', err);
    return serverError();
  }
});
