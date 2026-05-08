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
    // 注意：where('roles', 'array-contains') + orderBy('createdAt') 是複合查詢，
    // Firestore 需要建 composite index 才能跑（沒建會 throw FAILED_PRECONDITION）。
    // 這裡刻意省掉 orderBy，改在 map 後 in-memory 排序，避開使用者額外部署 index 的成本。
    // users 集合資料量上限約 100 筆級，記憶體排序成本可忽略。
    let q = db.collection('users').where('roles', 'array-contains', query.role);

    if (query.approved !== undefined) {
      q = q.where('approved', '==', query.approved === 'true') as typeof q;
    }

    const snapshot = await q.get();

    const users = snapshot.docs.map((doc) => {
      const d = doc.data();
      const rawRoles = Array.isArray(d.roles) ? (d.roles as string[]) : [];
      const app = d.driverApplication as Record<string, unknown> | undefined;
      const driverApplication = app
        ? {
            driverName: app.driverName as string | undefined,
            phone: app.phone as string | undefined,
            plateNumber: app.plateNumber as string | undefined,
            vehicleType: app.vehicleType as string | undefined,
            bankCode: app.bankCode as string | undefined,
            bankAccount: app.bankAccount as string | undefined,
            documents: app.documents as Record<string, string> | undefined,
            appliedAt: (app.appliedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (app.appliedAt as string | null) ?? null,
            reviewedAt: (app.reviewedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (app.reviewedAt as string | null) ?? null,
            reviewedBy: (app.reviewedBy as string | null) ?? null,
            rejectedAt: (app.rejectedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? (app.rejectedAt as string | null) ?? null,
            rejectReason: (app.rejectReason as string | null) ?? null,
          }
        : null;
      return {
        uid: doc.id,
        lineUserId: d.lineUserId as string ?? '',
        displayName: d.displayName as string ?? '',
        pictureUrl: d.pictureUrl as string ?? '',
        roles: rawRoles,
        approved: d.approved as boolean ?? false,
        driverCategory: d.driverCategory as string | undefined,
        driverApplication,
        createdAt: d.createdAt?.toDate?.()?.toISOString() ?? '',
      };
    });

    // in-memory sort by createdAt desc（取代 server side orderBy 避免 composite index）
    users.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    return successResponse(users);
  } catch (err) {
    console.error('[admin/users.get] Firestore query failed:', err);
    return serverError();
  }
});
