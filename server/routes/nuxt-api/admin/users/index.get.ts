/**
 * GET /nuxt-api/admin/users
 * 管理員查詢使用者清單（依 role 篩選 — array-contains）
 *
 * Query params:
 *   role — 'admin' | 'driver' | 'passenger'（必填，使用 array-contains 比對）
 *   approved — 'true' | 'false'（可選，driver 審核狀態篩選）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const query = getQuery(event) as { role?: string; approved?: string };
  if (!query.role) {
    return badRequestError({ zh_tw: 'role 參數必填', en: 'role param is required', ja: 'roleパラメータが必要です' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    let q = db.collection('users').where('roles', 'array-contains', query.role);

    if (query.approved !== undefined) {
      q = q.where('approved', '==', query.approved === 'true') as typeof q;
    }

    const snapshot = await q.orderBy('createdAt', 'desc').get();

    const users = snapshot.docs.map((doc) => {
      const d = doc.data();
      const rawRoles = Array.isArray(d.roles) ? (d.roles as string[]) : [];
      return {
        uid: doc.id,
        lineUserId: d.lineUserId as string ?? '',
        displayName: d.displayName as string ?? '',
        pictureUrl: d.pictureUrl as string ?? '',
        roles: rawRoles,
        approved: d.approved as boolean ?? false,
        createdAt: d.createdAt?.toDate?.()?.toISOString() ?? '',
      };
    });

    return successResponse(users);
  } catch (err) {
    console.error('[admin/users.get] Firestore query failed:', err);
    return serverError();
  }
});
