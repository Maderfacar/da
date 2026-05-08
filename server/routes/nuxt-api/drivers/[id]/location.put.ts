import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

interface LocationBody {
  lat: number;
  lng: number;
  heading?: number;
  status?: 'online' | 'offline' | 'busy';
  displayName?: string;
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: '缺少司機 ID', en: 'Missing driver ID', ja: 'ドライバー ID が不足しています' });
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
