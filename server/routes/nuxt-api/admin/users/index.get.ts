/**
 * GET /nuxt-api/admin/users
 * 管理員查詢使用者清單（依 role 篩選 — array-contains）
 *
 * P27（2026-05-12 起）：driverApplication 已從 users 搬到 drivers/{uid}.application。
 * 本端點透過 batchReadDriverApplications helper 一次讀取（drivers 優先，users 舊位置 fallback）。
 *
 * Query params:
 *   role — 'admin' | 'driver' | 'passenger'（必填，使用 array-contains 比對）
 *   approved — 'true' | 'false'（可選，driver 審核狀態篩選）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { batchReadDriverApplications } from '@@/utils/driver-application';

export default defineEventHandler(async (event) => {
  // P14：admin only
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({ zh_tw: '需要管理員權限', en: 'Admin role required', ja: '管理者権限が必要です' });
  }

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
      return {
        uid: doc.id,
        lineUserId: d.lineUserId as string ?? '',
        displayName: d.displayName as string ?? '',
        pictureUrl: d.pictureUrl as string ?? '',
        roles: rawRoles,
        approved: d.approved as boolean ?? false,
        // P18：driverCategory 已搬到 drivers/{uid}；P27：application 同樣在 drivers/{uid}
        driverCategory: undefined as string | undefined,
        driverApplication: null as Record<string, unknown> | null,
        createdAt: d.createdAt?.toDate?.()?.toISOString() ?? '',
      };
    });

    // in-memory sort by createdAt desc（取代 server side orderBy 避免 composite index）
    users.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    // P18 + P27：batch 讀 drivers/{uid} 補 driverCategory + application（僅 driver role 才需要）
    // 100 筆級資料量批次 getAll 成本可忽略；admins SDK single batch 上限遠超 100。
    const driverUsers = users.filter((u) => u.roles.includes('driver'));
    if (driverUsers.length > 0) {
      const refs = driverUsers.map((u) => db.collection('drivers').doc(u.uid));
      try {
        const snaps = await db.getAll(...refs);
        const driverDataByUid = new Map<string, { category?: string; app?: Record<string, unknown> }>();
        snaps.forEach((s) => {
          if (s.exists) {
            const data = s.data();
            driverDataByUid.set(s.id, {
              category: data?.driverCategory as string | undefined,
              app: data?.application as Record<string, unknown> | undefined,
            });
          }
        });
        users.forEach((u) => {
          const entry = driverDataByUid.get(u.uid);
          if (entry) {
            u.driverCategory = entry.category;
            if (entry.app) u.driverApplication = _serializeApplication(entry.app);
          }
        });
      } catch (err) {
        console.error('[admin/users.get] drivers batch read failed:', err);
      }

      // P27 Stage A：對 drivers 沒找到 application 的 driver，fallback 讀 users.driverApplication 舊位置
      const driversMissingApp = driverUsers.filter((u) => !u.driverApplication);
      if (driversMissingApp.length > 0) {
        const fallbackMap = await batchReadDriverApplications(db, driversMissingApp.map((u) => u.uid));
        users.forEach((u) => {
          if (!u.driverApplication && fallbackMap.has(u.uid)) {
            u.driverApplication = _serializeApplication(fallbackMap.get(u.uid)!);
          }
        });
      }
    }

    return successResponse(users);
  } catch (err) {
    console.error('[admin/users.get] Firestore query failed:', err);
    return serverError();
  }
});

/**
 * Timestamp + null-safety 序列化：Firestore Timestamp → ISO string；string → 維持；
 * null/undefined → null。對齊原本 inline 寫法。
 */
function _serializeApplication(app: Record<string, unknown>): Record<string, unknown> {
  const toIso = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    const ts = v as { toDate?: () => Date };
    return ts.toDate?.()?.toISOString?.() ?? null;
  };
  return {
    driverName: app.driverName as string | undefined,
    phone: app.phone as string | undefined,
    plateNumber: app.plateNumber as string | undefined,
    vehicleType: app.vehicleType as string | undefined,
    bankCode: app.bankCode as string | undefined,
    bankAccount: app.bankAccount as string | undefined,
    documents: app.documents as Record<string, string> | undefined,
    appliedAt: toIso(app.appliedAt),
    reviewedAt: toIso(app.reviewedAt),
    reviewedBy: (app.reviewedBy as string | null) ?? null,
    rejectedAt: toIso(app.rejectedAt),
    rejectReason: (app.rejectReason as string | null) ?? null,
  };
}
