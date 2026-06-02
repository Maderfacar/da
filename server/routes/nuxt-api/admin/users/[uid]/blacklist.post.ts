/**
 * POST /nuxt-api/admin/users/:uid/blacklist — A2 醜點系統 Phase 1
 *
 * Admin 手動拉黑 / 解黑乘客：
 *   - body: { action: 'add' | 'remove', reason?: string }
 *   - add：users.{uid}.blacklisted=true + blacklistedAt + blacklistedReason；推 penalty.suspended
 *   - remove：blacklisted=false + 清 At/Reason；不推播
 *   - audit log：user.blacklist_add / user.blacklist_remove
 *
 * 認證：admin + canManageOrders（與 no-show 同權限，避免再加新 perm 鍵）
 *
 * Note：accumulate (uglyCount) 與 blacklist 為**獨立**機制 — 累計達 3 醜會推 suspended
 * 但不會自動拉黑。admin 看到後在 UI 上判斷是否拉黑。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { successResponse, badRequestError, forbiddenError, notFoundError, serverError } from '@@/utils/response';
import { pushPenaltyNotification } from '@@/utils/penalty';

interface PostBody {
  action?: 'add' | 'remove';
  reason?: string;
}

const REASON_MAX_LENGTH = 200;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!auth.roles.includes('admin')) {
    return forbiddenError({
      zh_tw: '需要管理員權限',
      en: 'Admin role required',
      ja: '管理者権限が必要です',
    });
  }
  if (!hasPermission(auth, 'canManageOrders')) {
    return forbiddenError({
      zh_tw: '需要訂單管理權限',
      en: 'canManageOrders required',
      ja: '注文管理権限が必要です',
    });
  }

  const uid = getRouterParam(event, 'uid');
  if (!uid) {
    return badRequestError({
      zh_tw: '缺少使用者 ID',
      en: 'Missing uid',
      ja: 'uid が必要です',
    });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  const action = body?.action;
  if (action !== 'add' && action !== 'remove') {
    return badRequestError({
      zh_tw: 'action 必須為 "add" 或 "remove"',
      en: 'action must be "add" or "remove"',
      ja: 'action は "add" または "remove"',
    });
  }
  const rawReason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (rawReason.length > REASON_MAX_LENGTH) {
    return badRequestError({
      zh_tw: `原因長度不可超過 ${REASON_MAX_LENGTH} 字`,
      en: `reason ≤ ${REASON_MAX_LENGTH} chars`,
      ja: `理由は${REASON_MAX_LENGTH}文字以内`,
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) {
    return serverError({
      zh_tw: 'Firebase 未設定',
      en: 'Firebase not configured',
      ja: 'Firebase未設定',
    });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return notFoundError({
        zh_tw: '使用者不存在',
        en: 'User not found',
        ja: 'ユーザーが見つかりません',
      });
    }
    const prevData = snap.data() ?? {};
    const prevBlacklisted = prevData.blacklisted === true;
    const prevUglyCount = typeof prevData.uglyCount === 'number' ? prevData.uglyCount : 0;

    if (action === 'add') {
      await userRef.set({
        blacklisted: true,
        blacklistedAt: FieldValue.serverTimestamp(),
        blacklistedReason: rawReason || null,
        blacklistedBy: auth.lineUid,
      }, { merge: true });

      // 推 penalty.suspended（fire-and-forget；失敗 silent）
      void pushPenaltyNotification(db, {
        ownerUid: uid,
        pushType: 'suspended',
        uglyCount: prevUglyCount,
        reason: rawReason || null,
      });

      await writeAuditLog({
        event,
        auth,
        action: 'user.blacklist_add',
        targetType: 'user',
        targetId: uid,
        payload: {
          prevBlacklisted,
          reason: rawReason || null,
          uglyCountAtBlacklist: prevUglyCount,
        },
      });

      return successResponse({ uid, blacklisted: true });
    }

    // action === 'remove'
    await userRef.set({
      blacklisted: false,
      blacklistedAt: FieldValue.delete(),
      blacklistedReason: FieldValue.delete(),
      blacklistedBy: FieldValue.delete(),
    }, { merge: true });

    await writeAuditLog({
      event,
      auth,
      action: 'user.blacklist_remove',
      targetType: 'user',
      targetId: uid,
      payload: { prevBlacklisted },
    });

    return successResponse({ uid, blacklisted: false });
  } catch (err) {
    console.error('[admin/users/blacklist] failed:', err);
    return serverError();
  }
});
