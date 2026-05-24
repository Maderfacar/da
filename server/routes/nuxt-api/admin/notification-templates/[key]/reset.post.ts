/**
 * POST /nuxt-api/admin/notification-templates/[key]/reset
 *
 * 還原 template 為 registry defaultContent（清掉 cover / cta，title/body 填預設）。
 *
 * 副作用：audit log `notification_template.reset`
 *
 * 權限：
 *   1. canBroadcast（admin / super level）
 *   2. W8：meta.requiresSuperLevel=true 的模板（dispatch / driver-notify）額外要求 level=super
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { TEMPLATE_REGISTRY, resetTemplate } from '@@/utils/template-registry';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const key = getRouterParam(event, 'key');
  if (!key) {
    return badRequestError({ zh_tw: 'key 缺失', en: 'key required', ja: 'key が必要' });
  }
  const meta = TEMPLATE_REGISTRY[key];
  if (!meta) {
    return notFoundError({ zh_tw: '未知的 template key', en: 'Unknown template key', ja: '未知の template key' });
  }

  // W8：requiresSuperLevel 模板只有 super 可重置
  if (meta.requiresSuperLevel && auth.level !== 'super') {
    return forbiddenError({
      zh_tw: '此模板需 super 級別才能重置',
      en: 'Super level required to reset this template',
      ja: 'このテンプレートをリセットするには super 権限が必要です',
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await resetTemplate(db, key, auth.lineUid);

    await writeAuditLog({
      event,
      auth,
      action: 'notification_template.reset',
      targetType: 'notification_template',
      targetId: key,
      payload: { defaultsFrom: 'registry' },
    });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[admin/notification-templates/[key]/reset] failed:', err);
    return serverError();
  }
});
