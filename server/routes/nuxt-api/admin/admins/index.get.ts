/**
 * GET /nuxt-api/admin/admins
 * 列出所有管理員（含 level + displayName）
 *
 * 權限：canManageAdmins（spec：僅 super 可呼叫；admin / assistant 一律 403）
 *
 * 對應 openspec/changes/2026-05-09-collection-split P18 Stage 6.2
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  if (!hasPermission(auth, 'canManageAdmins')) {
    return forbiddenError({
      zh_tw: '需要管理員管理權限',
      en: 'canManageAdmins required',
      ja: '管理者管理権限が必要です',
    });
  }

  const config = useRuntimeConfig();
  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const snapshot = await db.collection('admins').get();

    const admins = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        uid: doc.id,
        lineUserId: (d.lineUserId as string) ?? doc.id,
        displayName: (d.displayName as string) ?? '',
        pictureUrl: (d.pictureUrl as string) ?? '',
        level: (d.level as 'super' | 'admin' | 'assistant'),
        // P34：細粒度 override（null = 走 LEVEL_TABLE 預設）
        permissions: (d.permissions as Record<string, boolean> | null | undefined) ?? null,
        createdBy: (d.createdBy as string | undefined) ?? null,
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? '',
        lastLoginAt: d.lastLoginAt?.toDate?.()?.toISOString?.() ?? null,
      };
    });

    // in-memory sort：super 在最前，其次 admin、assistant；同 level 依 createdAt desc
    const levelOrder: Record<string, number> = { super: 0, admin: 1, assistant: 2 };
    admins.sort((a, b) => {
      const la = levelOrder[a.level] ?? 99;
      const lb = levelOrder[b.level] ?? 99;
      if (la !== lb) return la - lb;
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    });

    return successResponse(admins);
  } catch (err) {
    console.error('[admin/admins.get] Firestore query failed:', err);
    return serverError();
  }
});
