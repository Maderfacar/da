/**
 * PATCH /nuxt-api/admin/line-richmenus/[id]
 *
 * 編輯 richmenu 內容（name / chatBarText / selected / areas）。
 *
 * Body（任意子集；不含 status / channel / image / publish-related — 那些走專屬 endpoint）：
 *   name?:        string (1-100)
 *   chatBarText?: string (1-14)
 *   selected?:    boolean
 *   areas?:       RichmenuArea[]（驗 bounds 在 image size 內 + action 合法）
 *
 * **限制**：
 *   - status='active' 不允許編輯 areas（avoid 線上 menu 不一致）；需先 unpublish 才能改
 *   - status='archived' 編輯 OK（preserve rollback 用，但通常 admin 不會編 archived 的）
 *
 * 副作用：audit log `line.richmenu.update`（記 patched fields）
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  validateName,
  validateChatBarText,
  validateAreas,
  CHAT_BAR_TEXT_MAX,
  type LineRichmenuDoc,
} from '@@/utils/line-richmenu-doc';

interface PatchBody {
  name?: string;
  chatBarText?: string;
  selected?: boolean;
  areas?: unknown;
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

  const body = await readBody<PatchBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('line_richmenus').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: 'richmenu 不存在', en: 'Richmenu not found', ja: 'richmenu が見つかりません' });
    }
    const existing = snap.data() as LineRichmenuDoc;

    const update: Record<string, unknown> = {};
    const patchedFields: string[] = [];

    if (body.name !== undefined) {
      const r = validateName(body.name);
      if (!r.ok) return badRequestError({ zh_tw: r.error, en: r.error, ja: r.error });
      update.name = r.value;
      patchedFields.push('name');
    }

    if (body.chatBarText !== undefined) {
      const r = validateChatBarText(body.chatBarText);
      if (!r.ok) {
        return badRequestError({ zh_tw: r.error, en: `chatBarText must be 1-${CHAT_BAR_TEXT_MAX}`, ja: `chatBarText は 1-${CHAT_BAR_TEXT_MAX} 文字` });
      }
      update.chatBarText = r.value;
      patchedFields.push('chatBarText');
    }

    if (body.selected !== undefined) {
      if (typeof body.selected !== 'boolean') {
        return badRequestError({ zh_tw: 'selected 必須為 boolean', en: 'selected must be boolean', ja: 'selected は boolean' });
      }
      update.selected = body.selected;
      patchedFields.push('selected');
    }

    if (body.areas !== undefined) {
      // active 不允許改 areas（避免 LINE 線上 menu 與 doc 不一致）
      if (existing.status === 'active') {
        return badRequestError({
          zh_tw: 'active 狀態不允許改 areas，請先 unpublish',
          en: 'Cannot edit areas while active; unpublish first',
          ja: 'active の間は areas を編集できません。先に unpublish してください',
        });
      }
      if (!existing.imageSize) {
        return badRequestError({
          zh_tw: '尚未上傳圖片，無法設定 areas',
          en: 'Upload image first',
          ja: '先に画像をアップロードしてください',
        });
      }
      const r = validateAreas(body.areas, existing.imageSize);
      if (!r.ok) return badRequestError({ zh_tw: r.error, en: r.error, ja: r.error });
      update.areas = r.value;
      patchedFields.push('areas');
    }

    if (patchedFields.length === 0) {
      return badRequestError({ zh_tw: '沒有可更新的欄位', en: 'No fields to update', ja: '更新するフィールドがありません' });
    }

    update.updatedBy = auth.lineUid;
    update.updatedAt = FieldValue.serverTimestamp();

    await ref.update(update);

    await writeAuditLog({
      event,
      auth,
      action: 'line.richmenu.update',
      targetType: 'line_richmenu',
      targetId: id,
      payload: { fields: patchedFields, areasCount: body.areas ? (update.areas as unknown[]).length : undefined },
    });

    return successResponse({ id, updated: true, fields: patchedFields });
  } catch (err) {
    console.error('[admin/line-richmenus/[id] PATCH] failed:', err);
    return serverError();
  }
});
