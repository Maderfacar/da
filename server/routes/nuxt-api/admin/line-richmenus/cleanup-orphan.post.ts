/**
 * POST /nuxt-api/admin/line-richmenus/cleanup-orphan
 *
 * P40 Phase 3：清理 LINE 端的孤兒 richmenu（本地無對應 doc）。
 *
 * Body:
 *   channel: 'passenger' | 'driver'
 *   lineRichMenuId: string（從 sync-overview orphans 來）
 *
 * 行為：
 *   - 安全檢查：再撈一次本地 line_richmenus，若有任一 doc 的 lineRichMenuId 對應本 id，
 *     回 409 拒絕清理（避免誤刪非孤兒）
 *   - call deleteRichmenu(channel, lineRichMenuId)
 *   - 寫 audit log `line.richmenu.delete`
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { deleteRichmenu, LineApiError } from '@@/utils/line-richmenu';
import { validateChannel, type LineRichmenuDoc } from '@@/utils/line-richmenu-doc';

interface PostBody {
  channel?: unknown;
  lineRichMenuId?: unknown;
}

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

  const body = await readBody<PostBody>(event);
  const channelRes = validateChannel(body?.channel);
  if (!channelRes.ok) {
    return badRequestError({
      zh_tw: channelRes.error,
      en: 'channel must be passenger or driver',
      ja: 'channel は passenger または driver',
    });
  }
  const channel = channelRes.value;

  const lineRichMenuId = typeof body?.lineRichMenuId === 'string' ? body.lineRichMenuId.trim() : '';
  if (!lineRichMenuId) {
    return badRequestError({
      zh_tw: 'lineRichMenuId 必填',
      en: 'lineRichMenuId is required',
      ja: 'lineRichMenuId は必須',
    });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    // 安全檢查：本地有 doc 對應此 lineRichMenuId 則拒絕（避免誤刪非孤兒）
    const localSnap = await db
      .collection('line_richmenus')
      .where('channel', '==', channel)
      .where('lineRichMenuId', '==', lineRichMenuId)
      .limit(1)
      .get();
    if (!localSnap.empty) {
      const doc = localSnap.docs[0]!;
      const data = doc.data() as LineRichmenuDoc;
      return {
        data: {},
        status: {
          code: 409,
          message: {
            zh_tw: `本地仍有 doc「${data.name}」對應此 lineRichMenuId，不是孤兒；如需刪除請走 richmenu 列表的「刪除」`,
            en: 'Local doc still references this lineRichMenuId; not an orphan',
            ja: 'ローカル doc が参照中、孤児ではない',
          },
        },
      };
    }

    // 真的孤兒 → 對 LINE 端 DELETE
    try {
      await deleteRichmenu(channel, lineRichMenuId);
    } catch (err) {
      if (err instanceof LineApiError && err.statusCode === 404) {
        // 已不存在 → 視同清理成功
      } else {
        const msg = err instanceof LineApiError ? `[${err.statusCode}] ${err.message}` : (err as Error).message;
        console.error('[admin/line-richmenus/cleanup-orphan] LINE delete failed:', err);
        return {
          data: {},
          status: {
            code: 502,
            message: {
              zh_tw: `LINE 端刪除失敗：${msg}`,
              en: `LINE delete failed: ${msg}`,
              ja: `LINE 削除失敗：${msg}`,
            },
          },
        };
      }
    }

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.delete',
      targetType: 'line_richmenu',
      targetId: lineRichMenuId,
      payload: { cleanupOrphan: true, channel },
    });

    return successResponse({ channel, lineRichMenuId, deleted: true });
  } catch (err) {
    console.error('[admin/line-richmenus/cleanup-orphan] failed:', err);
    return serverError();
  }
});
