/**
 * GET /nuxt-api/admin/line-richmenus
 *
 * 列出 richmenu（依 channel + lang + status 過濾）。
 *
 * Query：
 *   channel?: 'passenger' | 'driver'（必填）
 *   lang?:    'zh_tw' | 'en' | 'ja' | 'all'（default='all'，P42 新增）
 *   status?:  'draft' | 'active' | 'archived' | 'all'（default='all'）
 *   limit?:   1-100（default=50）
 *
 * 回傳：
 *   { items: LineRichmenuDto[] }
 *
 * 排序：updatedAt desc（最近編輯在前）。
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  validateChannel,
  validateLang,
  toRichmenuDto,
  type LineRichmenuDoc,
  type RichmenuStatus,
} from '@@/utils/line-richmenu-doc';

const VALID_STATUS = new Set<RichmenuStatus | 'all'>(['draft', 'active', 'archived', 'all']);

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const query = getQuery(event);
  const channelRes = validateChannel(query.channel);
  if (!channelRes.ok) {
    return badRequestError({ zh_tw: channelRes.error, en: 'channel must be passenger or driver', ja: 'channel は passenger または driver' });
  }

  const statusRaw = (query.status as string | undefined) ?? 'all';
  if (!VALID_STATUS.has(statusRaw as RichmenuStatus | 'all')) {
    return badRequestError({ zh_tw: 'status 參數錯誤', en: 'Invalid status', ja: 'status が無効' });
  }
  const status = statusRaw as RichmenuStatus | 'all';

  // P42：lang query filter（optional，'all' 跳過）
  const langRaw = (query.lang as string | undefined) ?? 'all';
  let langFilter: ReturnType<typeof validateLang> | null = null;
  if (langRaw !== 'all') {
    langFilter = validateLang(langRaw);
    if (!langFilter.ok) {
      return badRequestError({ zh_tw: langFilter.error, en: 'Invalid lang', ja: 'lang が無効' });
    }
  }

  let limit = Number(query.limit ?? 50);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    let q: FirebaseFirestore.Query = db
      .collection('line_richmenus')
      .where('channel', '==', channelRes.value);
    if (langFilter && langFilter.ok) {
      q = q.where('lang', '==', langFilter.value);
    }
    if (status !== 'all') {
      q = q.where('status', '==', status);
    }
    q = q.orderBy('updatedAt', 'desc').limit(limit);

    const snap = await q.get();
    const items = snap.docs.map((doc) => toRichmenuDto(doc.id, doc.data() as LineRichmenuDoc));
    return successResponse({ items });
  } catch (err) {
    console.error('[admin/line-richmenus GET] failed:', err);
    const isDev = process.env.NODE_ENV === 'development';
    const detail = isDev && err instanceof Error ? err.message : '';
    return serverError({
      zh_tw: detail ? `伺服器錯誤：${detail}` : '伺服器錯誤',
      en: detail ? `Server error: ${detail}` : 'Server error',
      ja: detail ? `サーバーエラー: ${detail}` : 'サーバーエラー',
    });
  }
});
