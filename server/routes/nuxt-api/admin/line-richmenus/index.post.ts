/**
 * POST /nuxt-api/admin/line-richmenus
 *
 * 建立 richmenu 草稿（content + LINE 端都未 push）。
 *
 * Body：
 *   channel: 'passenger' | 'driver'
 *   lang:    'zh_tw' | 'en' | 'ja'（P42 必填）
 *   name:    string（1-100）
 *   chatBarText?: string（1-14，可後續編輯）
 *   selected?:    boolean（default true，可後續編輯）
 *
 * 回傳：
 *   { id, status: 'draft' }
 *
 * 副作用：audit log `line.richmenu.create`
 *
 * 權限：canBroadcast
 *
 * **注意**：areas / image 在後續 PATCH / upload-image 補；publish 走 .../publish endpoint。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  validateChannel,
  validateLang,
  validateName,
  validateChatBarText,
  CHAT_BAR_TEXT_MAX,
  type LineRichmenuDoc,
} from '@@/utils/line-richmenu-doc';

interface PostBody {
  channel?: string;
  lang?: string;
  name?: string;
  chatBarText?: string;
  selected?: boolean;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const body = await readBody<PostBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const channelRes = validateChannel(body.channel);
  if (!channelRes.ok) {
    return badRequestError({ zh_tw: channelRes.error, en: 'Invalid channel', ja: 'channel が無効' });
  }
  // P42：lang 必填（draft 建立時必選；後續編輯不允許改）
  const langRes = validateLang(body.lang);
  if (!langRes.ok) {
    return badRequestError({ zh_tw: langRes.error, en: 'Invalid lang', ja: 'lang が無効' });
  }
  const nameRes = validateName(body.name);
  if (!nameRes.ok) {
    return badRequestError({ zh_tw: nameRes.error, en: nameRes.error, ja: nameRes.error });
  }

  // chatBarText 可選；空字串視為未設（後續 PATCH 補）
  let chatBarText = '';
  if (body.chatBarText !== undefined && body.chatBarText !== '') {
    const r = validateChatBarText(body.chatBarText);
    if (!r.ok) {
      return badRequestError({ zh_tw: r.error, en: `chatBarText must be 1-${CHAT_BAR_TEXT_MAX} chars`, ja: `chatBarText は 1-${CHAT_BAR_TEXT_MAX} 文字` });
    }
    chatBarText = r.value;
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('line_richmenus').doc();

    const docData: Partial<LineRichmenuDoc> = {
      channel: channelRes.value,
      lang: langRes.value,
      status: 'draft',
      name: nameRes.value,
      lineRichMenuId: null,
      syncStatus: 'not_synced',
      syncError: null,
      lastSyncedAt: null,
      imageUrl: null,
      imageObjectPath: null,
      imageSize: null,
      imageBytes: null,
      imageMime: null,
      chatBarText,
      selected: body.selected ?? true,
      areas: [],
      createdBy: auth.lineUid,
      createdAt: FieldValue.serverTimestamp() as unknown as LineRichmenuDoc['createdAt'],
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp() as unknown as LineRichmenuDoc['updatedAt'],
      publishedAt: null,
      archivedAt: null,
    };

    await ref.set(docData);

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.create',
      targetType: 'line_richmenu',
      targetId: ref.id,
      payload: { channel: channelRes.value, lang: langRes.value, name: nameRes.value },
    });

    return successResponse({ id: ref.id, status: 'draft' });
  } catch (err) {
    console.error('[admin/line-richmenus POST] failed:', err);
    return serverError();
  }
});
