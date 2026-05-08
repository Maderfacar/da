import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

interface LocationBody {
  lat: number;
  lng: number;
  heading?: number;
  status?: 'online' | 'offline' | 'busy';
  displayName?: string;
}

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

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({ zh_tw: '伺服器設定不完整', en: 'Server configuration incomplete', ja: 'サーバー設定が不完全です' });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const payload: Record<string, unknown> = {
      driverId: id,
      lat: body.lat,
      lng: body.lng,
      updatedAt: FieldValue.serverTimestamp(),
      status: body.status ?? 'online',
    };
    if (typeof body.heading === 'number') payload.heading = body.heading;
    if (body.displayName) payload.displayName = body.displayName;

    await db.collection('drivers').doc(id).set(payload, { merge: true });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[drivers/location.put] Firestore write failed:', err);
    return serverError({ zh_tw: '位置更新失敗', en: 'Failed to update location', ja: '位置の更新に失敗しました' });
  }
});
