/**
 * PATCH /nuxt-api/admin/admins/:uid
 * 修改某管理員的 level（僅限 super → admin / assistant 之間切換）
 *
 * 權限：canManageAdmins
 *
 * 限制（第一版保護機制）：
 *   - 不允許改成 super：避免任意提權
 *   - target 若已是 super：不允許被改 level（避免管理員失能；super 撤銷需手動 Firestore 操作）
 *
 * Body：
 *   level: 'admin' | 'assistant'
 *
 * 對應 openspec/changes/2026-05-09-collection-split P18 Stage 6.3
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

interface PatchAdminBody {
  level?: 'admin' | 'assistant';
}

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

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: 'uid 缺失', en: 'uid is required', ja: 'uidが必要です' });
  }

  const body = await readBody<PatchAdminBody>(event).catch(() => null);
  if (!body || !body.level) {
    return badRequestError({ zh_tw: '缺少 level 欄位', en: 'level is required', ja: 'levelが必要です' });
  }

  // 只允許切換到 admin / assistant；改成 super 屬危險操作，需手動 Firestore（保留入口）
  if (body.level !== 'admin' && body.level !== 'assistant') {
    return badRequestError({
      zh_tw: 'level 僅接受 admin 或 assistant',
      en: 'level must be admin or assistant',
      ja: 'levelはadminまたはassistantのみ',
    });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('admins').doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      return notFoundError({ zh_tw: '管理員不存在', en: 'Admin not found', ja: '管理者が見つかりません' });
    }

    // 保護機制：super 不可被改 level（避免最高管理員被自降後沒人能管理）
    if (snap.data()?.level === 'super') {
      return forbiddenError({
        zh_tw: '無法變更最高管理員 level',
        en: 'Cannot change super admin level',
        ja: 'スーパー管理者のlevelは変更できません',
      });
    }

    const previousLevel = snap.data()?.level ?? 'unknown';
    await ref.update({ level: body.level });
    // P25-2 audit log
    await writeAuditLog({
      event,
      auth,
      action: 'admin.level_change',
      targetType: 'admin',
      targetId: uid,
      payload: { before: { level: previousLevel }, after: { level: body.level } },
    });
    return successResponse({ uid, level: body.level });
  } catch (err) {
    console.error('[admin/admins.patch] Firestore update failed:', err);
    return serverError();
  }
});
