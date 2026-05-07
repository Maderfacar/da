/**
 * PATCH /nuxt-api/admin/users/:uid
 * 管理員更新使用者 roles 或 approved 狀態
 *
 * Body 支援欄位：
 *   addRole?: 'admin' | 'driver' | 'passenger'   — 加入單一 role（arrayUnion）
 *   removeRole?: 'admin' | 'driver'              — 移除單一 role（arrayRemove，禁止移除 passenger）
 *   approved?: boolean                            — 設定 driver 核准狀態
 *   displayName?: string                          — 同步顯示名稱（建立新使用者時使用）
 *
 * 用途範例：
 *   - 加入管理員白名單：{ addRole: 'admin' }
 *   - 移除管理員身分：{ removeRole: 'admin' }
 *   - 核准司機：{ approved: true }
 *   - 拒絕司機：{ removeRole: 'driver' }
 *   - 停用司機（保留 driver role）：{ approved: false }
 *
 * 注意：使用者文件不存在時會建立新文件並寫入 roles: ['passenger', addRole]
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

type Role = 'passenger' | 'driver' | 'admin';

interface PatchBody {
  addRole?: Role;
  removeRole?: Role;
  approved?: boolean;
  displayName?: string;
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: 'uid 缺失', en: 'uid is required', ja: 'uidが必要です' });
  }

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body || (body.addRole === undefined && body.removeRole === undefined && body.approved === undefined)) {
    return badRequestError({ zh_tw: '請提供 addRole / removeRole / approved', en: 'Provide addRole / removeRole / approved', ja: 'addRole / removeRole / approvedを指定してください' });
  }

  // 禁止移除 passenger（passenger 是所有使用者的基礎身分）
  if (body.removeRole === 'passenger') {
    return badRequestError({ zh_tw: '不可移除 passenger 身分', en: 'Cannot remove passenger role', ja: 'passenger権限は削除できません' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      // 使用者不在 Firestore 中 → 允許新增（管理員手動加入白名單情境）
      // 預設帶上 passenger，再加上 addRole 指定的身分
      const initialRoles: Role[] = ['passenger'];
      if (body.addRole && body.addRole !== 'passenger') initialRoles.push(body.addRole);

      const newData: Record<string, unknown> = {
        roles: initialRoles,
        approved: body.approved ?? true,
        createdAt: new Date(),
      };
      if (body.displayName) newData.displayName = body.displayName;

      await ref.set(newData, { merge: true });
      return successResponse({ uid, ...newData });
    }

    const update: Record<string, unknown> = {};
    if (body.addRole) update.roles = FieldValue.arrayUnion(body.addRole);
    if (body.removeRole) update.roles = FieldValue.arrayRemove(body.removeRole);
    if (body.approved !== undefined) update.approved = body.approved;

    await ref.update(update);
    return successResponse({ uid, updated: true });
  } catch (err) {
    console.error('[admin/users.patch] Firestore update failed:', err);
    return serverError();
  }
});
