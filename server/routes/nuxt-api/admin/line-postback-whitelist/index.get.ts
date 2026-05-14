/**
 * GET /nuxt-api/admin/line-postback-whitelist
 *
 * 列出 admin 可選的 postback whitelist（P40 Phase 1）。
 *
 * Query：
 *   channel?: 'passenger' | 'driver'（選填；不傳則回全部含 'both'）
 *
 * 回傳：
 *   { items: Array<{ data: string; label: string; channel: 'passenger' | 'driver' | 'both' }> }
 *
 * 用途：
 *   - richmenu Edit dialog postback action input 改 select
 *   - TemplateEditor.vue postback action input 改 select
 *
 * 權限：canBroadcast（與 richmenu / template admin 對齊）
 */
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { POSTBACK_WHITELIST } from '@@/utils/line-postback-handlers';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({
      zh_tw: '需要廣播權限',
      en: 'canBroadcast required',
      ja: 'ブロードキャスト権限が必要です',
    });
  }

  const query = getQuery(event);
  const channelRaw = (query.channel as string | undefined) ?? '';
  const channel = channelRaw === 'passenger' || channelRaw === 'driver' ? channelRaw : null;

  const items = POSTBACK_WHITELIST
    .filter((e) => {
      if (channel === null) return true;
      return e.channel === 'both' || e.channel === channel;
    })
    .map((e) => ({
      data: e.data,
      label: e.label,
      channel: e.channel,
    }));

  return successResponse({ items });
});
