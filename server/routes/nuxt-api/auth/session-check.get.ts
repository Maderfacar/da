// 認證根治：開機權威登入判斷 + 三端 gate 欄位一把載齊（P2 A 方案）。
// client 開機打一次，以 server 回的 signedIn 為準，取代前端等 Firebase hydration（最多 12s）的 race。
//
// P2（2026-08-15）：除 roles/approved/level 外，額外回 permissions / admin2faEnrolled /
// driverApplication。使「localStorage/IndexedDB 被清、僅 httpOnly cookie 在」的 admin/driver
// 裝置開機即可正確 gate —— 不再依賴 client Firestore SDK + Firebase user（cookie-only 時
// user=null，lazy loader 讀不到 level/2fa/driverApplication，會誤導 admin 去 setup、誤判 driver 未核准）。
//
// 無 cookie / 無效一律回 signedIn:false（不洩 detection）。
import { getSessionFromEvent } from '@@/utils/session-auth';
import { useFirebaseAdmin } from '@@/utils/firebase-admin';

interface DriverApplication {
  appliedAt: string | null;
  reviewedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
}

/** admin SDK Timestamp / ISO string / null → ISO string | null（與 store _LoadDriverDoc 對齊）。 */
const toIso = (v: unknown): string | null => {
  if (!v) return null;
  const d = (v as { toDate?: () => Date }).toDate?.();
  if (d) return d.toISOString();
  return typeof v === 'string' ? v : null;
};

export default defineEventHandler(async (event) => {
  const result = await getSessionFromEvent(event);
  if (!result.ok) {
    return successResponse({ signedIn: false });
  }

  // driverApplication：僅 driver 身分才讀 drivers doc（省一次 read）。
  // resolveIdentity 不讀 drivers（保持每 request 的 hot path 精簡），故在此 boot 端點補讀。
  let driverApplication: DriverApplication | null = null;
  if (result.roles.includes('driver')) {
    const config = useRuntimeConfig();
    if (config.firebaseServiceAccountJson) {
      try {
        const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
        const snap = await db.collection('drivers').doc(result.lineUid).get();
        const candidate = snap.exists ? snap.data()?.application : null;
        if (candidate && typeof candidate === 'object') {
          const appData = candidate as Record<string, unknown>;
          driverApplication = {
            appliedAt: toIso(appData.appliedAt),
            reviewedAt: toIso(appData.reviewedAt),
            rejectedAt: toIso(appData.rejectedAt),
            rejectReason: (appData.rejectReason as string | null) ?? null,
          };
        }
      } catch (err) {
        // 讀失敗 → driverApplication 保持 null；不阻斷 bootstrap（gate 由 roles/approved 兜底）
        console.error('[session-check] drivers doc read failed:', err);
      }
    }
  }

  return successResponse({
    signedIn: true,
    lineUid: result.lineUid,
    roles: result.roles,
    approved: result.approved,
    level: result.level ?? null,
    permissions: result.permissions ?? {},
    admin2faEnrolled: result.admin2faEnrolled ?? false,
    // LINE 顯示名稱與頭像：cookie-only 裝置（server OAuth 後 client user=null）的 client
    // Firestore SDK 讀不到 users doc，本端點是唯一權威來源。缺這兩欄會讓三端登入後
    // 頭像與名稱空白（2026-08-20 實測；無痕視窗因無 localStorage 快取而特別明顯）。
    displayName: result.displayName ?? '',
    pictureUrl: result.pictureUrl ?? '',
    driverApplication,
  });
});
