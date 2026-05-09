import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

interface LocationBody {
  lat: number;
  lng: number;
  heading?: number;
  accuracy?: number;
  status?: 'online' | 'busy'; // P19：不接受 'offline'
  displayName?: string;
}

// P19：driver 「執行中」訂單狀態（決定 status 缺省時的推導）
const EXECUTING_STATUSES = ['en_route', 'arrived_pickup', 'in_transit'];

export default defineEventHandler(async (event) => {
  // P14：必須登入；只能更新自己（除非 admin）
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: '缺少司機 ID', en: 'Missing driver ID', ja: 'ドライバー ID が不足しています' });
  }

  // P14：caller 必須是 driver 本人或 admin
  // id 可能是 'line:Uxxxx' 或 'Uxxxx' 兩種格式（client 帶法不一致），雙比對
  const isAdmin = auth.roles.includes('admin');
  const idAsLineUid = id.startsWith('line:') ? id.slice(5) : id;
  const isSelf = auth.uid === id || auth.lineUid === idAsLineUid;
  if (!isAdmin && !isSelf) {
    return forbiddenError({ zh_tw: '無權更新他人位置', en: 'Cannot update other driver location', ja: '他人の位置は更新できません' });
  }

  const body = await readBody<LocationBody>(event);

  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return badRequestError({ zh_tw: '座標格式錯誤', en: 'Invalid coordinates', ja: '座標の形式が正しくありません' });
  }

  // P19：driver 端不應主動寫 'offline'（offline 由 war-room client-side 依 lastActiveAt 推導）
  if ((body.status as string) === 'offline') {
    return badRequestError({
      zh_tw: 'offline 狀態由系統推導，不接受 client 寫入',
      en: 'offline status is derived by system; client write rejected',
      ja: 'offline ステータスはシステムで推測されます',
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    // P19：status 缺省 → query 該 driver 是否有「執行中」訂單；有則 'busy'，無則 'online'
    let resolvedStatus: 'online' | 'busy' = body.status ?? 'online';
    if (body.status === undefined) {
      try {
        const exec = await db.collection('orders')
          .where('assignedDriverId', '==', `line:${idAsLineUid}`)
          .where('orderStatus', 'in', EXECUTING_STATUSES)
          .limit(1)
          .get();
        resolvedStatus = exec.empty ? 'online' : 'busy';
      } catch (err) {
        console.error('[drivers/location.put] active order query failed:', err);
        // query 失敗時保守取 'online'（避免錯認 busy）
        resolvedStatus = 'online';
      }
    }

    // P18：drivers doc key 改為 lineUid（去 prefix），寫入路徑與位置都對齊
    const location: Record<string, unknown> = {
      lat: body.lat,
      lng: body.lng,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (typeof body.heading === 'number') location.heading = body.heading;
    if (typeof body.accuracy === 'number') location.accuracy = body.accuracy;

    const payload: Record<string, unknown> = {
      status: resolvedStatus,
      location,
      lastActiveAt: FieldValue.serverTimestamp(),
    };
    // displayName 由 driver/apply 寫入；若 client 仍帶來則 merge 更新（容錯既有資料）
    if (body.displayName) payload.displayName = body.displayName;

    await db.collection('drivers').doc(idAsLineUid).set(payload, { merge: true });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[drivers/location.put] Firestore write failed:', err);
    return serverError({ zh_tw: '位置更新失敗', en: 'Failed to update location', ja: '位置の更新に失敗しました' });
  }
});
