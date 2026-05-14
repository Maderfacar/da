/**
 * POST /nuxt-api/admin/line-richmenus/[id]/test-bind
 *
 * 把 richmenu 綁定到特定 LINE user（admin 自己預覽測試用）。
 *
 * Body：{ lineUid: string }
 *
 * 限制：
 *   - 本 menu 需已 push 到 LINE（lineRichMenuId 非 null）
 *   - 不變動 doc.status（仍可 draft 測試）
 *
 * 副作用：audit log `line.richmenu.sync`（payload.kind='test-bind'，避免另闢 action）
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  createRichmenu,
  uploadRichmenuImage,
  linkRichmenuToUser,
  LineApiError,
} from '@@/utils/line-richmenu';
import { FieldValue } from 'firebase-admin/firestore';
import { isPublishReady, type LineRichmenuDoc } from '@@/utils/line-richmenu-doc';

interface PostBody {
  lineUid?: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: 'id 缺失', en: 'id is required', ja: 'id が必要です' });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  if (!body || typeof body.lineUid !== 'string' || body.lineUid.length === 0) {
    return badRequestError({ zh_tw: 'lineUid 缺失', en: 'lineUid required', ja: 'lineUid が必要' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db, storage } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('line_richmenus').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: 'richmenu 不存在', en: 'Richmenu not found', ja: 'richmenu が見つかりません' });
    }
    const existing = snap.data() as LineRichmenuDoc;
    const ready = isPublishReady(existing);
    if (!ready.ok) {
      return badRequestError({
        zh_tw: `尚未準備好可測試綁定，缺少：${ready.missing.join(', ')}`,
        en: `Not ready: ${ready.missing.join(', ')}`,
        ja: `準備未完了: ${ready.missing.join(', ')}`,
      });
    }

    // 確保 LINE 端有對應 richmenu（若 lineRichMenuId 為 null，先建立 + 上傳圖；不設預設）
    let lineRichMenuId = existing.lineRichMenuId;
    try {
      if (!lineRichMenuId) {
        const created = await createRichmenu(existing.channel, {
          size: existing.imageSize!,
          selected: existing.selected,
          name: existing.name.slice(0, 100),
          chatBarText: existing.chatBarText,
          areas: existing.areas,
        });
        lineRichMenuId = created.richMenuId;
        const [imgBuf] = await storage.bucket().file(existing.imageObjectPath!).download();
        await uploadRichmenuImage(
          existing.channel,
          lineRichMenuId,
          imgBuf,
          existing.imageMime!,
        );
        // 寫回 doc：lineRichMenuId 已建立（不變動 status）
        await ref.update({
          lineRichMenuId,
          updatedBy: auth.lineUid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      // 綁到測試 user
      await linkRichmenuToUser(existing.channel, body.lineUid, lineRichMenuId);
    } catch (err) {
      const detail = err instanceof LineApiError
        ? `[${err.statusCode}] ${err.message}`
        : ((err as Error).message ?? 'Unknown');
      console.error('[admin/line-richmenus/[id]/test-bind] failed:', err);
      return serverError({
        zh_tw: `LINE 綁定失敗：${detail}`,
        en: `LINE bind failed: ${detail}`,
        ja: `LINE バインド失敗: ${detail}`,
      });
    }

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.sync',
      targetType: 'line_richmenu',
      targetId: id,
      payload: { kind: 'test-bind', targetLineUid: body.lineUid, lineRichMenuId },
    });

    return successResponse({ id, lineRichMenuId, boundTo: body.lineUid });
  } catch (err) {
    console.error('[admin/line-richmenus/[id]/test-bind] failed:', err);
    return serverError();
  }
});
