/**
 * PATCH /nuxt-api/admin/users/:uid
 * 管理員更新使用者 roles 或 approved 狀態
 *
 * Body 支援欄位：
 *   addRole?: 'admin' | 'driver' | 'passenger'   — 加入單一 role（arrayUnion）
 *   removeRole?: 'admin' | 'driver'              — 移除單一 role（arrayRemove，禁止移除 passenger）
 *   approved?: boolean                            — 設定 driver 核准狀態
 *   rejectedAt?: string | null                    — ISO timestamp 拒絕；null 解除冷卻
 *   rejectReason?: string                         — 配合 rejectedAt 寫入
 *   driverCategory?: string                       — 調整搶單排序權重
 *   displayName?: string                          — 同步顯示名稱（建立新使用者時使用）
 *
 * 用途範例：
 *   - 加入管理員白名單：{ addRole: 'admin' }
 *   - 移除管理員身分：{ removeRole: 'admin' }
 *   - 核准司機：{ approved: true }
 *   - 拒絕司機：{ removeRole: 'driver', rejectedAt: now ISO, rejectReason: '...' }
 *   - 解除冷卻：{ rejectedAt: null }
 *   - 停用司機（保留 driver role）：{ approved: false }
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';

type Role = 'passenger' | 'driver' | 'admin';

interface PatchBody {
  addRole?: Role;
  removeRole?: Role;
  approved?: boolean;
  rejectedAt?: string | null;
  rejectReason?: string;
  driverCategory?: string;
  displayName?: string;
}

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

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({ zh_tw: 'uid 缺失', en: 'uid is required', ja: 'uidが必要です' });
  }

  const body = await readBody<PatchBody>(event).catch(() => null);
  const hasAnyField = body && (
    body.addRole !== undefined
    || body.removeRole !== undefined
    || body.approved !== undefined
    || body.rejectedAt !== undefined
    || body.rejectReason !== undefined
    || body.driverCategory !== undefined
  );
  if (!hasAnyField) {
    return badRequestError({ zh_tw: '請提供至少一個更新欄位', en: 'Provide at least one update field', ja: '少なくとも 1 つの更新フィールドを指定してください' });
  }

  if (body!.removeRole === 'passenger') {
    return badRequestError({ zh_tw: '不可移除 passenger 身分', en: 'Cannot remove passenger role', ja: 'passenger権限は削除できません' });
  }

  try {
    const { db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      // 使用者不在 Firestore 中 → 允許新增（管理員手動加入白名單情境）
      // P18：driverCategory 不再寫 users（搬到 drivers）。新增使用者時帶 driverCategory 極罕見，
      // 且此時 driver 流程未啟動（無 drivers doc），略過此欄位即可。
      const initialRoles: Role[] = ['passenger'];
      if (body!.addRole && body!.addRole !== 'passenger') initialRoles.push(body!.addRole);

      const newData: Record<string, unknown> = {
        roles: initialRoles,
        approved: body!.approved ?? true,
        createdAt: new Date(),
      };
      if (body!.displayName) newData.displayName = body!.displayName;

      await ref.set(newData, { merge: true });
      return successResponse({ uid, ...newData });
    }

    // P18：removeRole='driver'（拒絕司機）不刪除 drivers doc，保留歷史統計
    const update: Record<string, unknown> = {};
    if (body!.addRole) update.roles = FieldValue.arrayUnion(body!.addRole);
    if (body!.removeRole) update.roles = FieldValue.arrayRemove(body!.removeRole);
    if (body!.approved !== undefined) update.approved = body!.approved;
    // P18：driverCategory 改寫 drivers/{uid}，不再寫 users

    // P8 司機審核：rejectedAt / rejectReason 寫入巢狀 driverApplication
    // null 代表解除冷卻（清空 rejectedAt + rejectReason），admin 端「解除冷卻」按鈕用
    if (body!.rejectedAt !== undefined) {
      update['driverApplication.rejectedAt'] = body!.rejectedAt === null ? null : new Date(body!.rejectedAt);
      if (body!.rejectedAt === null) {
        update['driverApplication.rejectReason'] = null;
      }
    }
    if (body!.rejectReason !== undefined) {
      update['driverApplication.rejectReason'] = body!.rejectReason;
    }
    if (body!.approved !== undefined && body!.approved === true) {
      // 核准司機時，順帶寫入審核時戳（不寫 reviewedBy，因為 admin uid 此處未取）
      update['driverApplication.reviewedAt'] = FieldValue.serverTimestamp();
    }

    await ref.update(update);

    // P18：driverCategory 寫到 drivers/{uid} doc（merge:true，doc 不存在會建一個僅含此欄位的 stub doc；
    // 正常流程下 drivers doc 由 driver/apply 建立，此處 merge 即可）
    if (body!.driverCategory !== undefined) {
      await db.collection('drivers').doc(uid).set({
        driverCategory: body!.driverCategory,
      }, { merge: true });
    }

    return successResponse({ uid, updated: true });
  } catch (err) {
    console.error('[admin/users.patch] Firestore update failed:', err);
    return serverError();
  }
});
