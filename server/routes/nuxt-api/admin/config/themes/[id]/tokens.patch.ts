/**
 * PATCH /nuxt-api/admin/config/themes/{id}/tokens
 *
 * 覆寫主題的 --da-* 色票。body `{ tokens: Record<DaTokenKey, string> }`。
 *
 * 這是「後台色票編輯」的落地端點 —— 在此之前換色只能改
 * `scripts/migrate-site-themes.mjs` 重跑，或手動改 Firestore。
 *
 * 驗證兩道，缺一不可：
 *   1. key 必須在 DA_THEME_TOKEN_KEYS 白名單內（12 個）
 *   2. 值必須通過 isHexColor（3 或 6 碼 hex）
 * 理由：tokens 會被 buildThemeCss() 直接串成 `--da-x:值;` 塞進 <style>，
 * 放行任意字串等於開一個 CSS 注入口。glass 那三個 rgba token 當年就是為此
 * 刻意不列入白名單 —— 它們已於階段 2 下架，白名單維持 12 個不變。
 *
 * 副作用：audit `site_theme.tokens_update`（記 before/after 逐 key）+ invalidate 快取。
 * 權限：canManageThemes（預設僅 super）。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  seedSiteThemesIfEmpty,
  getSiteThemeById,
  setThemeTokens,
  invalidateSiteThemeCache,
} from '@@/utils/site-theme-config';
import { DA_THEME_TOKEN_KEYS, isHexColor, type DaTokenKey } from '~shared/site-theme';

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

  const body = await readBody<{ tokens?: unknown }>(event).catch(() => null);
  const raw = body?.tokens;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return badRequestError({ zh_tw: '缺少 tokens', en: 'tokens required', ja: 'tokens が必要です' });
  }

  const allowed = new Set<string>(DA_THEME_TOKEN_KEYS);
  const tokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(k)) {
      return badRequestError({
        zh_tw: `不支援的色票 key：${k}`,
        en: `Unsupported token key: ${k}`,
        ja: `対応していないトークンキー：${k}`,
      });
    }
    if (!isHexColor(v)) {
      return badRequestError({
        zh_tw: `色票 ${k} 必須是 hex 色（例 #7E6330）`,
        en: `Token ${k} must be a hex color (e.g. #7E6330)`,
        ja: `トークン ${k} は hex カラーである必要があります（例 #7E6330）`,
      });
    }
    tokens[k] = v.toUpperCase();
  }
  if (Object.keys(tokens).length === 0) {
    return badRequestError({ zh_tw: 'tokens 不得為空', en: 'tokens must not be empty', ja: 'tokens を空にできません' });
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

    const before: Record<string, string | null> = {};
    for (const k of Object.keys(tokens)) {
      before[k] = target.tokens?.[k as DaTokenKey] ?? null;
    }

    await setThemeTokens(db, id, tokens);
    invalidateSiteThemeCache();

    await writeAuditLog({
      event,
      auth,
      action: 'site_theme.tokens_update',
      targetType: 'site_theme',
      targetId: id,
      payload: { before, after: tokens, isDefault: target.isDefault === true },
    });

    return successResponse({ id, tokens });
  } catch (err) {
    console.error('[admin/config/themes tokens PATCH] failed:', err);
    return serverError();
  }
});
