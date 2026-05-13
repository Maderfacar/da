/**
 * POST /nuxt-api/admin/announcements
 *
 * 建立公告（草稿）。
 *
 * Body（必填 title / body / targetType / channels）：
 *   title: string (1-60)
 *   body: string (1-10000 chars, HTML)
 *   coverImageUrl?: string | null
 *   ctaButton?: { label: string (1-20), url: 'https://...' } | null
 *   targetType: 'all' | 'passenger' | 'driver' | 'order'
 *   targetOrderId?: string | null（targetType=order 時必填）
 *   channels: { line: boolean, inApp: boolean }（兩者擇一）
 *
 * 回傳：
 *   { id, status: 'draft' }
 *
 * 副作用：
 *   - audit log `announcement.create`
 *
 * **注意**：publish 動作走 PATCH（status='published'），不在此端點。
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  validateAnnouncementBody,
  sanitizeBody,
  type AnnouncementWriteInput,
  type AnnouncementDoc,
} from '@@/utils/announcement';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  const body = await readBody<AnnouncementWriteInput>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const validateErr = validateAnnouncementBody(body, /* requireAll */ true);
  if (validateErr) {
    return badRequestError({ zh_tw: validateErr, en: validateErr, ja: validateErr });
  }

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('announcements').doc();

    const docData: Partial<AnnouncementDoc> = {
      status: 'draft',
      title: body.title!.trim(),
      body: sanitizeBody(body.body!),
      coverImageUrl: body.coverImageUrl ?? null,
      ctaButton: body.ctaButton ?? null,
      targetType: body.targetType!,
      targetOrderId: body.targetType === 'order' ? (body.targetOrderId ?? null) : null,
      channels: body.channels!,
      createdBy: auth.lineUid,
      createdAt: FieldValue.serverTimestamp(),
      publishedAt: null,
      archivedAt: null,
      pushStats: null,
    };

    await ref.set(docData);

    await writeAuditLog({
      event,
      auth,
      action: 'announcement.create',
      targetType: 'announcement',
      targetId: ref.id,
      payload: {
        title: body.title,
        targetType: body.targetType,
        channels: body.channels,
      },
    });

    return successResponse({ id: ref.id, status: 'draft' });
  } catch (err) {
    console.error('[admin/announcements POST] failed:', err);
    return serverError();
  }
});
