/**
 * PATCH /nuxt-api/admin/config/themes/{id}/hero
 *
 * 設定 / 清除主題 Hero 主圖。body `{ bgImage: string | null }`。
 *   - string → 必須通過 isSafeThemeImageUrl（站內 /themes 或 https 影像；擋 CSS 注入），寫入 hero.bgImage
 *   - null   → 清除 hero.bgImage（回退純色 hero）
 *
 * 圖檔本身由 `upload-hero-image.post.ts` 上傳到 Storage 後取得 URL，前端再呼叫本端點持久化，
 * 沿用車型圖「上傳取 URL → 寫回 doc」的兩段式流程。
 *
 * 副作用：audit `site_theme.hero_update` + invalidate 快取。
 * 權限：canManageThemes（預設僅 super）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  seedSiteThemesIfEmpty,
  getSiteThemeById,
  setThemeHeroImage,
  invalidateSiteThemeCache,
} from '@@/utils/site-theme-config';
import { isSafeThemeImageUrl } from '~shared/site-theme';

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

  const body = await readBody<{ bgImage?: unknown }>(event).catch(() => null);
  if (!body || !('bgImage' in body)) {
    return badRequestError({ zh_tw: '缺少 bgImage', en: 'bgImage required', ja: 'bgImage が必要です' });
  }
  const raw = body.bgImage;
  let bgImage: string | null;
  if (raw === null) {
    bgImage = null;
  } else if (isSafeThemeImageUrl(raw)) {
    bgImage = raw; // 型別守衛已收斂為 string
  } else {
    return badRequestError({
      zh_tw: 'bgImage 網址不合法（僅接受站內 /themes 或 https 影像）',
      en: 'Invalid bgImage URL (only /themes or https image allowed)',
      ja: 'bgImage の URL が不正です（/themes または https 画像のみ）',
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await seedSiteThemesIfEmpty(db);

    const target = await getSiteThemeById(db, id);
    if (!target) {
      return notFoundError({ zh_tw: '主題不存在', en: 'Theme not found', ja: 'テーマが見つかりません' });
    }

    await setThemeHeroImage(db, id, bgImage);
    invalidateSiteThemeCache();

    await writeAuditLog({
      event,
      auth,
      action: 'site_theme.hero_update',
      targetType: 'site_theme',
      targetId: id,
      payload: { before: target.hero?.bgImage ?? null, after: bgImage },
    });

    return successResponse({ id, bgImage });
  } catch (err) {
    console.error('[admin/config/themes hero PATCH] failed:', err);
    return serverError();
  }
});
