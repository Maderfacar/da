/**
 * PATCH /nuxt-api/admin/admins/:uid
 * 修改某管理員的 level（僅限 super → admin / assistant 之間切換）+ permissions override
 *
 * 權限：canManageAdmins
 *
 * 限制（第一版保護機制）：
 *   - 不允許改成 super：避免任意提權
 *   - target 若已是 super：不允許被改 level（避免管理員失能；super 撤銷需手動 Firestore 操作）
 *
 * Body：
 *   level?: 'admin' | 'assistant'
 *   permissions?: Partial<Record<Permission, boolean>> | null
 *     - null → 清除 override（走 LEVEL_TABLE 預設）
 *     - { [perm]: bool } → 細粒度 override（P34）
 *
 * 對應 openspec/changes/2026-05-09-collection-split P18 Stage 6.3
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission, type Permission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

const VALID_PERMISSIONS: Permission[] = [
  'canManageAdmins',
  'canManageDrivers',
  'canManageOrders',
  'canBroadcast',
  'canViewFinance',
  'canManageFleet',
];

interface PatchAdminBody {
  level?: 'admin' | 'assistant';
  permissions?: Partial<Record<Permission, boolean>> | null;
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
  if (!body || (body.level === undefined && body.permissions === undefined)) {
    return badRequestError({ zh_tw: '至少需提供 level 或 permissions', en: 'level or permissions required', ja: 'levelまたはpermissionsが必要です' });
  }

  // 只允許切換到 admin / assistant；改成 super 屬危險操作，需手動 Firestore（保留入口）
  if (body.level !== undefined && body.level !== 'admin' && body.level !== 'assistant') {
    return badRequestError({
      zh_tw: 'level 僅接受 admin 或 assistant',
      en: 'level must be admin or assistant',
      ja: 'levelはadminまたはassistantのみ',
    });
  }

  // P34：permissions 驗證 — null（清除 override）或 partial record
  if (body.permissions !== undefined && body.permissions !== null) {
    if (typeof body.permissions !== 'object') {
      return badRequestError({ zh_tw: 'permissions 必須為物件或 null', en: 'permissions must be object or null', ja: 'permissionsはオブジェクトまたはnull' });
    }
    for (const [key, val] of Object.entries(body.permissions)) {
      if (!VALID_PERMISSIONS.includes(key as Permission)) {
        return badRequestError({ zh_tw: `未知權限：${key}`, en: `Unknown permission: ${key}`, ja: `不明な権限: ${key}` });
      }
      if (typeof val !== 'boolean') {
        return badRequestError({ zh_tw: `permissions.${key} 必須為 boolean`, en: `permissions.${key} must be boolean`, ja: `permissions.${key}はbooleanのみ` });
      }
    }
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('admins').doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      return notFoundError({ zh_tw: '管理員不存在', en: 'Admin not found', ja: '管理者が見つかりません' });
    }

    const data = snap.data() ?? {};
    const previousLevel = (data.level as string) ?? 'unknown';
    const previousPermissions = (data.permissions as Record<string, boolean> | null | undefined) ?? null;

    // 保護機制：super 不可被改 level / permissions
    // （permissions 也擋掉：避免自降權後跟 level_change 同樣 lock-out）
    if (previousLevel === 'super') {
      return forbiddenError({
        zh_tw: '無法變更最高管理員',
        en: 'Cannot modify super admin',
        ja: 'スーパー管理者は変更できません',
      });
    }

    // 組裝更新 payload
    const updates: Record<string, unknown> = {};
    if (body.level !== undefined) updates.level = body.level;
    if (body.permissions !== undefined) {
      // null → 用 FieldValue.delete() 清掉欄位（caller 改回走 LEVEL_TABLE 預設）
      updates.permissions = body.permissions === null ? FieldValue.delete() : body.permissions;
    }

    await ref.update(updates);

    // P25-2 audit log — level / permissions 變更各寫一筆
    if (body.level !== undefined && body.level !== previousLevel) {
      await writeAuditLog({
        event,
        auth,
        action: 'admin.level_change',
        targetType: 'admin',
        targetId: uid,
        payload: { before: { level: previousLevel }, after: { level: body.level } },
      });
    }
    if (body.permissions !== undefined) {
      await writeAuditLog({
        event,
        auth,
        action: 'admin.permissions_override',
        targetType: 'admin',
        targetId: uid,
        payload: { before: previousPermissions, after: body.permissions },
      });
    }
    return successResponse({ uid, level: body.level ?? previousLevel });
  } catch (err) {
    console.error('[admin/admins.patch] Firestore update failed:', err);
    return serverError();
  }
});
