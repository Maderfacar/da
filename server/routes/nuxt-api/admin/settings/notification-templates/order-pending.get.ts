/**
 * GET /nuxt-api/admin/settings/notification-templates/order-pending
 *
 * 讀取訂單建立通知模板（Wave 3-A1）。
 *
 * 權限：canBroadcast（admin / assistant 預設都有）
 *
 * 回傳：
 *   - OrderPendingTemplate（template 存在）
 *   - null（doc 不存在；前端顯示「使用預設文案 fallback」）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { successResponse, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { loadOrderPendingTemplate } from '@@/utils/order-pending-flex';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const template = await loadOrderPendingTemplate(db);
    return successResponse(template);
  } catch (err) {
    console.error('[admin/settings/notification-templates/order-pending.get] failed:', err);
    return serverError();
  }
});
