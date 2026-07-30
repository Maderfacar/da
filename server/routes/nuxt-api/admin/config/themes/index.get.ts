/**
 * GET /nuxt-api/admin/config/themes
 *
 * 列出全部季節主題包（含 disabled）+ 目前生效指標，供 admin 換季 UI。
 * 首次呼叫若集合為空自動 seed（與公開端點共用 helper）。
 *
 * 權限：canManageThemes（預設僅 super）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  seedSiteThemesIfEmpty,
  listSiteThemes,
  getActiveThemeId,
} from '@@/utils/site-theme-config';
import type { SiteTheme } from '~shared/site-theme';

export interface AdminThemesRes {
  themes: SiteTheme[];
  activeThemeId: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageThemes')) {
    return forbiddenError({ zh_tw: '需要主題管理權限', en: 'canManageThemes required', ja: 'テーマ管理権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await seedSiteThemesIfEmpty(db);
    const [themes, activeThemeId] = await Promise.all([
      listSiteThemes(db),
      getActiveThemeId(db),
    ]);
    return successResponse<AdminThemesRes>({ themes, activeThemeId });
  } catch (err) {
    console.error('[admin/config/themes GET] failed:', err);
    return serverError();
  }
});
