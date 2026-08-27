/**
 * PATCH /nuxt-api/admin/config/themes/{id}/tokens
 *
 * 覆寫主題的 --da-* 色票。body `{ tokens?, tokensDark? }`，兩者至少擇一。
 * `tokensDark` 是深色模式下的那一組 —— 深色不是從淺色推導的：
 * `--da-dark` 在兩個模式下語意都是「主文字色」，值卻要反過來（深 ↔ 淺）。
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

  const body = await readBody<{ tokens?: unknown; tokensDark?: unknown }>(event).catch(() => null);
  const allowed = new Set<string>(DA_THEME_TOKEN_KEYS);

  /** 白名單 + hex 兩道驗證；回傳 [已正規化的 map, 錯誤訊息] */
  const sanitize = (raw: unknown, field: string): [Record<string, string>, string | null] => {
    if (raw === undefined) return [{}, null];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [{}, `${field} 格式不正確`];
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!allowed.has(k)) return [{}, `不支援的色票 key：${field}.${k}`];
      if (!isHexColor(v)) return [{}, `色票 ${field}.${k} 必須是 hex 色（例 #7E6330）`];
      out[k] = v.toUpperCase();
    }
    return [out, null];
  };

  const [tokens, tErr] = sanitize(body?.tokens, 'tokens');
  if (tErr) return badRequestError({ zh_tw: tErr, en: tErr, ja: tErr });
  const [tokensDark, dErr] = sanitize(body?.tokensDark, 'tokensDark');
  if (dErr) return badRequestError({ zh_tw: dErr, en: dErr, ja: dErr });

  if (Object.keys(tokens).length === 0 && Object.keys(tokensDark).length === 0) {
    return badRequestError({
      zh_tw: 'tokens 與 tokensDark 不得同時為空',
      en: 'tokens and tokensDark must not both be empty',
      ja: 'tokens と tokensDark を同時に空にできません',
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

    const before: Record<string, string | null> = {};
    for (const k of Object.keys(tokens)) {
      before[k] = target.tokens?.[k as DaTokenKey] ?? null;
    }
    const beforeDark: Record<string, string | null> = {};
    for (const k of Object.keys(tokensDark)) {
      beforeDark[k] = target.tokensDark?.[k as DaTokenKey] ?? null;
    }

    await setThemeTokens(db, id, tokens, tokensDark);
    invalidateSiteThemeCache();

    await writeAuditLog({
      event,
      auth,
      action: 'site_theme.tokens_update',
      targetType: 'site_theme',
      targetId: id,
      payload: { before, after: tokens, beforeDark, afterDark: tokensDark, isDefault: target.isDefault === true },
    });

    return successResponse({ id, tokens, tokensDark });
  } catch (err) {
    console.error('[admin/config/themes tokens PATCH] failed:', err);
    return serverError();
  }
});
