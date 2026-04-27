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
    return {
      data: {},
      status: { code: 400, message: { zh_tw: '缺少司機 ID', en: 'Missing driver ID', ja: 'ドライバー ID が不足しています' } },
    };
  }

  const body = await readBody<LocationBody>(event);

  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return {
      data: {},
      status: { code: 400, message: { zh_tw: '座標格式錯誤', en: 'Invalid coordinates', ja: '座標の形式が正しくありません' } },
    };
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return {
      data: {},
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
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

    return {
      data: { ok: true },
      status: { code: 200, message: { zh_tw: '位置已更新', en: 'Location updated', ja: '位置が更新されました' } },
    };
  } catch (err) {
    console.error('[drivers/location.put] Firestore write failed:', err);
    return {
      data: {},
      status: { code: 500, message: { zh_tw: '伺服器錯誤', en: 'Server error', ja: 'サーバーエラー' } },
    };
  }
});
