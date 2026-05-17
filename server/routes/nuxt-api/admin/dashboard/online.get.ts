/**
 * GET /nuxt-api/admin/dashboard/online
 *
 * Admin Dashboard 第一版「線上名單」（admin-auto-notify-dashboard 變更）。
 *
 * 線上判定：lastSeenAt / lastActiveAt 在 5 分鐘內。
 *   - 乘客 users.lastSeenAt 目前僅由 LINE 登入交換時寫入（D2：陽春版接受此限制，
 *     語意實為「5 分鐘內曾登入」；前端以「資料時間」標註）
 *   - 司機 drivers.lastActiveAt 由 status 變更 / GPS 上報持續更新，較接近真實在線
 *
 * 權限：D4 — 任何 admin role 即可（read-only 維運總覽，不收斂至 canManageOrders）。
 *
 * 回 { passengers:{count,list}, drivers:{count,list}, generatedAt } — 統一響應格式。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { Timestamp } from 'firebase-admin/firestore';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

interface OnlineUserDoc {
  displayName?: string;
  pictureUrl?: string;
  lastSeenAt?: Timestamp;
}

interface OnlineDriverDoc {
  displayName?: string;
  pictureUrl?: string;
  lastActiveAt?: Timestamp;
  status?: string;
}

const _toIso = (ts: Timestamp | undefined): string => ts?.toDate().toISOString() ?? '';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const cutoff = Timestamp.fromMillis(Date.now() - ONLINE_WINDOW_MS);

    const [passengersSnap, driversSnap] = await Promise.all([
      db.collection('users').where('lastSeenAt', '>=', cutoff).get(),
      db.collection('drivers').where('lastActiveAt', '>=', cutoff).get(),
    ]);

    const passengers = passengersSnap.docs
      .map((d) => {
        const data = d.data() as OnlineUserDoc;
        return {
          uid: d.id,
          displayName: data.displayName ?? '',
          pictureUrl: data.pictureUrl ?? '',
          lastSeenAt: _toIso(data.lastSeenAt),
        };
      })
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0));

    const drivers = driversSnap.docs
      .map((d) => {
        const data = d.data() as OnlineDriverDoc;
        return {
          uid: d.id,
          displayName: data.displayName ?? '',
          pictureUrl: data.pictureUrl ?? '',
          lastActiveAt: _toIso(data.lastActiveAt),
          driverStatus: data.status ?? '',
        };
      })
      .sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : a.lastActiveAt > b.lastActiveAt ? -1 : 0));

    return successResponse({
      passengers: { count: passengers.length, list: passengers },
      drivers: { count: drivers.length, list: drivers },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin/dashboard/online GET] failed:', err);
    return serverError();
  }
});
