/**
 * PUT /nuxt-api/admin/config/theme(s)/active
 *
 * 切換乘客端生效主題。body `{ activeThemeId }`。
 *
 * Guard：
 *   - 目標主題須存在且 enabled=true，否則回 400（不更新指標）。
 *
 * 副作用：更新 site_config/theme.activeThemeId + 寫 audit `site_theme.switch`
 *         + invalidate in-memory 快取（乘客端下次請求即換色，最多 30s 各 instance）。
 *
 * 權限：canManageThemes（預設僅 super）。切換屬中低敏感（視覺、可逆），首發不強制 PIN。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  seedSiteThemesIfEmpty,
  getSiteThemeById,
  setActiveTheme,
  getActiveThemeId,
  invalidateSiteThemeCache,
} from '@@/utils/site-theme-config';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageThemes')) {
    return forbiddenError({ zh_tw: '需要主題管理權限', en: 'canManageThemes required', ja: 'テーマ管理権限が必要です' });
  }

  const body = await readBody<{ activeThemeId?: unknown }>(event).catch(() => null);
  const activeThemeId = typeof body?.activeThemeId === 'string' ? body.activeThemeId.trim() : '';
  if (!activeThemeId) {
    return badRequestError({ zh_tw: '缺少 activeThemeId', en: 'activeThemeId required', ja: 'activeThemeId が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await seedSiteThemesIfEmpty(db);

    const target = await getSiteThemeById(db, activeThemeId);
    if (!target) {
      return notFoundError({ zh_tw: '主題不存在', en: 'Theme not found', ja: 'テーマが見つかりません' });
    }
    if (!target.enabled) {
      return badRequestError({
        zh_tw: '無法切換到已停用的主題，請先啟用',
        en: 'Cannot switch to a disabled theme; enable it first',
        ja: '無効なテーマには切り替えできません。先に有効化してください',
      });
    }

    const before = await getActiveThemeId(db);
    await setActiveTheme(db, activeThemeId);
    invalidateSiteThemeCache();

    await writeAuditLog({
      event,
      auth,
      action: 'site_theme.switch',
      targetType: 'site_theme',
      targetId: activeThemeId,
      payload: { before, after: activeThemeId },
    });

    return successResponse({ activeThemeId });
  } catch (err) {
    console.error('[admin/config/themes active PUT] failed:', err);
    return serverError();
  }
});
