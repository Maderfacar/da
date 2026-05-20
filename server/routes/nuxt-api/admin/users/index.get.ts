/**
 * GET /nuxt-api/admin/users
 * 管理員查詢使用者清單（依 role 篩選 — array-contains）
 *
 * P27（2026-05-12 起）：driverApplication 已從 users 搬到 drivers/{uid}.application。
 * 本端點 batch read drivers/{uid} 補 driverCategory + application。
 *
 * Query params:
 *   role — 'admin' | 'driver' | 'passenger'（必填，使用 array-contains 比對）
 *   approved — 'true' | 'false'（可選，driver 審核狀態篩選）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { resignGcsUrl } from '@@/utils/signed-url';
import type { Storage } from 'firebase-admin/storage';

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
    const { db, storage } = useFirebaseAdmin(config.firebaseServiceAccountJson);
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
        // Phase 1B：driver doc top-level vehicleProfile / pending / tags / verifiedAt 等
        tags: [] as string[],
        vehicleProfile: null as Record<string, unknown> | null,
        vehicleProfilePending: null as Record<string, unknown> | null,
        verifiedAt: null as string | null,
        verifiedBy: null as string | null,
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
        // P31：documents 內 signed URL 重簽 4h（避免回傳 1 年舊 URL）
        // Phase 1B：driver doc top-level 加 4 欄位（vehicleProfile / pending / verifiedAt / verifiedBy / tags）
        const driverRawByUid = new Map<string, Record<string, unknown>>();
        snaps.forEach((s) => {
          if (s.exists) driverRawByUid.set(s.id, (s.data() ?? {}) as Record<string, unknown>);
        });
        await Promise.all(users.map(async (u) => {
          const entry = driverDataByUid.get(u.uid);
          if (!entry) return;
          u.driverCategory = entry.category;
          if (entry.app) u.driverApplication = await _serializeApplication(entry.app, storage);

          const raw = driverRawByUid.get(u.uid);
          if (raw) {
            u.tags = Array.isArray(raw.tags) ? (raw.tags as string[]) : [];
            u.vehicleProfile = _serializeVehicleProfile(raw.vehicleProfile);
            u.vehicleProfilePending = _serializeVehicleProfilePending(raw.vehicleProfilePending);
            u.verifiedAt = _toIso(raw.verifiedAt);
            u.verifiedBy = (raw.verifiedBy as string | null) ?? null;
          }
        }));
      } catch (err) {
        console.error('[admin/users.get] drivers batch read failed:', err);
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
async function _serializeApplication(app: Record<string, unknown>, storage: Storage): Promise<Record<string, unknown>> {
  const toIso = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    const ts = v as { toDate?: () => Date };
    return ts.toDate?.()?.toISOString?.() ?? null;
  };

  // P31：documents URL 重簽 4h（fallback 舊資料原 URL）
  const rawDocs = app.documents as Record<string, string> | undefined;
  let documents: Record<string, string> | undefined;
  if (rawDocs) {
    documents = {};
    await Promise.all(Object.entries(rawDocs).map(async ([k, v]) => {
      documents![k] = await resignGcsUrl(storage, v);
    }));
  }

  return {
    driverName: app.driverName as string | undefined,
    phone: app.phone as string | undefined,
    plateNumber: app.plateNumber as string | undefined,
    vehicleType: app.vehicleType as string | undefined,
    bankCode: app.bankCode as string | undefined,
    bankAccount: app.bankAccount as string | undefined,
    documents,
    appliedAt: toIso(app.appliedAt),
    reviewedAt: toIso(app.reviewedAt),
    reviewedBy: (app.reviewedBy as string | null) ?? null,
    rejectedAt: toIso(app.rejectedAt),
    rejectReason: (app.rejectReason as string | null) ?? null,
  };
}

/** Phase 1B：Timestamp → ISO string；string 維持；其他 → null */
function _toIso(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  const ts = v as { toDate?: () => Date };
  return ts.toDate?.()?.toISOString?.() ?? null;
}

function _serializeVehicleProfile(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    photos: Array.isArray(r.photos) ? r.photos : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    updatedAt: _toIso(r.updatedAt),
  };
}

function _serializeVehicleProfilePending(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    photos: Array.isArray(r.photos) ? r.photos : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    status: (r.status as string | undefined) ?? 'draft',
    submittedAt: _toIso(r.submittedAt),
    rejectedAt: _toIso(r.rejectedAt),
    rejectReason: (r.rejectReason as string | null) ?? null,
    reviewedBy: (r.reviewedBy as string | null) ?? null,
    updatedAt: _toIso(r.updatedAt),
  };
}
