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
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog, type AuditAction } from '@@/utils/audit-log';
import { sendLinePush } from '@@/utils/line-push';
import { requirePinSession } from '@@/utils/require-pin-session';
import { isDriverCategory } from '~shared/types/driver-category';

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
  // P14：必須登入；P18：依 body 內容套 require-permission
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);

  const config = useRuntimeConfig();

  if (!config.firebaseServiceAccountJson) {
    return serverError({ zh_tw: 'Firebase 未設定', en: 'Firebase not configured', ja: 'Firebase未設定' });
  }

  const rawUid = getRouterParam(event, 'uid');
  if (!rawUid) {
    return badRequestError({ zh_tw: 'uid 缺失', en: 'uid is required', ja: 'uidが必要です' });
  }
  // 正規化：Firestore 文件 key 為「不帶 line: 前綴」的 LINE userId；
  // 容錯呼叫端誤帶 line: 前綴，避免寫入錯誤的幽靈文件
  const uid = rawUid.startsWith('line:') ? rawUid.slice(5) : rawUid;

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

  // Wave 2A：driverCategory 必須是合法值 '0' | '1' | '2'
  if (body!.driverCategory !== undefined && !isDriverCategory(body!.driverCategory)) {
    return badRequestError({
      zh_tw: '司機分級值不合法（限 0 / 1 / 2）',
      en: 'Invalid driverCategory (allowed: 0 / 1 / 2)',
      ja: 'driverCategory が不正です（0 / 1 / 2 のみ）',
    });
  }

  // P18：依 body 內容判斷需要哪些權限
  // - admin 操作（addRole/removeRole='admin'）→ canManageAdmins
  // - driver 管理（approved / rejectedAt / rejectReason / driverCategory / displayName / addRole/removeRole='driver' or 'passenger'）→ canManageDrivers
  const requiresManageAdmins = body!.addRole === 'admin' || body!.removeRole === 'admin';
  const requiresManageDrivers = (
    body!.addRole === 'driver' || body!.removeRole === 'driver' || body!.addRole === 'passenger'
    || body!.approved !== undefined
    || body!.rejectedAt !== undefined
    || body!.rejectReason !== undefined
    || body!.driverCategory !== undefined
    || body!.displayName !== undefined
  );

  if (requiresManageAdmins && !hasPermission(auth, 'canManageAdmins')) {
    return forbiddenError({ zh_tw: '需要管理員管理權限', en: 'canManageAdmins required', ja: '管理者管理権限が必要です' });
  }
  if (requiresManageDrivers && !hasPermission(auth, 'canManageDrivers')) {
    return forbiddenError({ zh_tw: '需要司機管理權限', en: 'canManageDrivers required', ja: 'ドライバー管理権限が必要です' });
  }

  // W2：admin role 加減屬高敏感，需 PIN 二次確認；driver approve/reject 等不擋
  if (requiresManageAdmins) {
    const pinOk = await requirePinSession(event, auth);
    if (pinOk !== true) return authFailResponse(pinOk);
  }

  try {
    const { auth: adminAuth, db } = useFirebaseAdmin(config.firebaseServiceAccountJson);
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();

    // Wave 2A：driverCategory 變動需在寫入前讀取既有值，audit log 才能記 before/after
    let beforeDriverCategory: string | null = null;
    if (body!.driverCategory !== undefined) {
      try {
        const driverSnap = await db.collection('drivers').doc(uid).get();
        const raw = driverSnap.exists ? (driverSnap.data()?.driverCategory as string | undefined) : undefined;
        beforeDriverCategory = typeof raw === 'string' && raw.length > 0 ? raw : null;
      } catch (err) {
        // 讀失敗不阻擋主流程；audit log 內 before 標記為 unknown
        console.warn('[admin/users.patch] read driver before driverCategory failed:', err);
      }
    }

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

      // P18：addRole='admin' 時同步建 admins/{uid} doc，預設 level='admin'
      // 由 super admin 後續透過 admin/admins.patch 調整為 super / admin / assistant
      if (body!.addRole === 'admin') {
        await db.collection('admins').doc(uid).set({
          lineUserId: uid,
          displayName: (newData.displayName as string) ?? '',
          pictureUrl: '',
          level: 'admin',
          createdBy: auth.lineUid,
          createdAt: FieldValue.serverTimestamp(),
        });
        // P25-2 audit log
        await writeAuditLog({
          event,
          auth,
          action: 'admin.add',
          targetType: 'admin',
          targetId: uid,
          payload: { addedBy: auth.lineUid, newUser: true, displayName: newData.displayName ?? '' },
        });
      }

      return successResponse({ uid, ...newData });
    }

    // P18：removeRole='admin' 前先 guard — super admin 不可被撤銷（保護管理員失能）
    if (body!.removeRole === 'admin') {
      const adminSnap = await db.collection('admins').doc(uid).get();
      if (adminSnap.exists && adminSnap.data()?.level === 'super') {
        return forbiddenError({
          zh_tw: '無法撤銷最高管理員',
          en: 'Cannot remove super admin',
          ja: 'スーパー管理者は削除できません',
        });
      }
    }

    // P18：removeRole='driver'（拒絕司機）不刪除 drivers doc，保留歷史統計
    // P27：driverApplication.* 改寫 drivers/{uid}.application.*（不再寫 users）
    const update: Record<string, unknown> = {};
    if (body!.addRole) update.roles = FieldValue.arrayUnion(body!.addRole);
    if (body!.removeRole) update.roles = FieldValue.arrayRemove(body!.removeRole);
    if (body!.approved !== undefined) update.approved = body!.approved;

    if (Object.keys(update).length > 0) {
      await ref.update(update);
    }

    // P27：rejectedAt / rejectReason / reviewedAt 寫到 drivers/{uid}.application.*（dot-path nested）
    // null rejectedAt 代表解除冷卻（清空 rejectedAt + rejectReason）
    const driverUpdate: Record<string, unknown> = {};
    if (body!.rejectedAt !== undefined) {
      driverUpdate['application.rejectedAt'] = body!.rejectedAt === null ? null : new Date(body!.rejectedAt);
      if (body!.rejectedAt === null) {
        driverUpdate['application.rejectReason'] = null;
      }
    }
    if (body!.rejectReason !== undefined) {
      driverUpdate['application.rejectReason'] = body!.rejectReason;
    }
    if (body!.approved !== undefined && body!.approved === true) {
      // 核准司機時，順帶寫入審核時戳（不寫 reviewedBy，因為 admin uid 此處未取）
      driverUpdate['application.reviewedAt'] = FieldValue.serverTimestamp();
    }
    // P18：driverCategory 寫到 drivers/{uid} 頂層
    if (body!.driverCategory !== undefined) {
      driverUpdate.driverCategory = body!.driverCategory;
    }

    if (Object.keys(driverUpdate).length > 0) {
      // merge:true：drivers doc 不存在會建一個僅含這幾個欄位的 stub doc；
      // 正常流程下 drivers doc 由 driver/apply 建立，此處 set + merge 等價於 update + safety
      await db.collection('drivers').doc(uid).set(driverUpdate, { merge: true });
    }

    // P18：addRole='admin' 同步建 admins/{uid} doc（首次預設 level='admin'，重複 addRole 不覆寫 level）
    if (body!.addRole === 'admin') {
      const userData = snap.data() ?? {};
      const adminRef = db.collection('admins').doc(uid);
      const adminSnap = await adminRef.get();
      const baseFields = {
        lineUserId: uid,
        displayName: (userData.displayName as string) ?? '',
        pictureUrl: (userData.pictureUrl as string) ?? '',
      };
      if (!adminSnap.exists) {
        await adminRef.set({
          ...baseFields,
          level: 'admin',
          createdBy: auth.lineUid,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        // admins doc 已存在（極罕見：重複 addRole）→ 只更新身分欄位，保留 level / createdAt
        await adminRef.set(baseFields, { merge: true });
      }
    }

    // P18：removeRole='admin' 同步刪 admins/{uid} doc（super 已在前面 guard 擋住）
    //
    // 2026-06-15 MEDIUM 1：撤 admin role 時呼叫 revokeRefreshTokens，把該帳號既有 idToken
    // 強制失效（1h TTL → 立即）。
    //
    // 為何需要：Firestore Rules 信 `request.auth.token.roles`（custom claims snapshot），
    // 撤銷 admin role 後 client 仍能用舊 idToken 讀 admin-only collection（templates / richmenu /
    // audit_logs 等）長達 1 小時。revoke 後 client 下次 getIdToken 會被 Firebase 強制 sign-in，
    // claims 不再含 admin role，Rules 即時生效。
    // server-side `require-auth` 因為即時讀 Firestore 不受影響（永遠拿最新 roles）。
    if (body!.removeRole === 'admin') {
      await db.collection('admins').doc(uid).delete();
      try {
        await adminAuth.revokeRefreshTokens(`line:${uid}`);
      } catch (err) {
        // 撤 token 失敗不阻擋主流程（Firestore role 已撤，server-side 已生效）；
        // 僅 client-side Firestore Rules 的 admin-only read 會延後到 idToken 自然過期才失效
        console.warn('[admin/users.patch] revokeRefreshTokens failed (non-fatal):', err);
      }
    }

    // P25-2 audit log：依 body 推算 action（一次 PATCH 可能對應多種 action，逐筆寫）
    const auditActions: Array<{ action: AuditAction; targetType: 'driver' | 'admin'; payload: Record<string, unknown> }> = [];
    if (body!.addRole === 'admin') {
      auditActions.push({ action: 'admin.add', targetType: 'admin', payload: { addedBy: auth.lineUid } });
    }
    if (body!.removeRole === 'admin') {
      auditActions.push({ action: 'admin.remove', targetType: 'admin', payload: {} });
    }
    if (body!.addRole === 'driver') {
      auditActions.push({ action: 'driver.role_add', targetType: 'driver', payload: {} });
    }
    if (body!.removeRole === 'driver') {
      auditActions.push({ action: 'driver.role_remove', targetType: 'driver', payload: { reason: body!.rejectReason ?? '' } });
    }
    if (body!.approved === true) {
      auditActions.push({ action: 'driver.approve', targetType: 'driver', payload: {} });
    }
    if (body!.approved === false) {
      auditActions.push({ action: 'driver.reject', targetType: 'driver', payload: { reason: body!.rejectReason ?? '' } });
    }
    if (body!.rejectedAt === null) {
      auditActions.push({ action: 'driver.unblock_cooldown', targetType: 'driver', payload: {} });
    }
    if (body!.driverCategory !== undefined) {
      // Wave 2A：補 before/after（actorUid 已由 writeAuditLog 自動寫 audit_logs.actorUid，等同 adminId）
      auditActions.push({
        action: 'driver.category_change',
        targetType: 'driver',
        payload: {
          before: { driverCategory: beforeDriverCategory },
          after: { driverCategory: body!.driverCategory },
        },
      });
    }
    for (const a of auditActions) {
      await writeAuditLog({ event, auth, action: a.action, targetType: a.targetType, targetId: uid, payload: a.payload });
    }

    // 司機核准通過時通知司機（fire-and-forget；line-push 內部 catch）
    if (body!.approved === true) {
      await sendLinePush('driver', uid, [{
        type: 'text',
        text: '🎉 司機申請已通過審核\n恭喜！您已成為核准司機，可開始接單。\n請至司機端 /driver/dashboard 開始服務。',
      }]);
    }

    return successResponse({ uid, updated: true });
  } catch (err) {
    console.error('[admin/users.patch] Firestore update failed:', err);
    return serverError();
  }
});
