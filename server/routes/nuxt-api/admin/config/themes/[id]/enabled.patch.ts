/**
 * PATCH /nuxt-api/admin/config/themes/{id}/enabled
 *
 * 啟用 / 停用主題。body `{ enabled: boolean }`。
 *
 * Guard：
 *   - default 主題（isDefault）不可停用（作為合併底層與 fallback 目標）。
 *   - 停用「目前生效」主題本身允許（乘客端經 resolveTheme 會自動 fallback default），
 *     但為避免困惑，前端建議先切走；此處不強制。
 *
 * 副作用：更新 enabled + audit `site_theme.enabled` + invalidate 快取。
 * 權限：canManageThemes（預設僅 super）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  seedSiteThemesIfEmpty,
  getSiteThemeById,
  setThemeEnabled,
  invalidateSiteThemeCache,
} from '@@/utils/site-theme-config';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageThemes')) {
    return forbiddenError({ zh_tw: '需要主題管理權限', en: 'canManageThemes required', ja: 'テーマ管理権限が必要です' });
  }

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: '缺少主題 id', en: 'Theme id required', ja: 'テーマ id が必要です' });
  }

  const body = await readBody<{ enabled?: unknown }>(event).catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    return badRequestError({ zh_tw: 'enabled 必須為布林值', en: 'enabled must be boolean', ja: 'enabled は真偽値である必要があります' });
  }
  const enabled = body.enabled;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await seedSiteThemesIfEmpty(db);

    const target = await getSiteThemeById(db, id);
    if (!target) {
      return notFoundError({ zh_tw: '主題不存在', en: 'Theme not found', ja: 'テーマが見つかりません' });
    }
    if (target.isDefault && !enabled) {
      return badRequestError({
        zh_tw: '預設主題不可停用',
        en: 'The default theme cannot be disabled',
        ja: '既定テーマは無効化できません',
      });
    }

    await setThemeEnabled(db, id, enabled);
    invalidateSiteThemeCache();

    await writeAuditLog({
      event,
      auth,
      action: 'site_theme.enabled',
      targetType: 'site_theme',
      targetId: id,
      payload: { before: target.enabled, after: enabled },
    });

    return successResponse({ id, enabled });
  } catch (err) {
    console.error('[admin/config/themes enabled PATCH] failed:', err);
    return serverError();
  }
});
