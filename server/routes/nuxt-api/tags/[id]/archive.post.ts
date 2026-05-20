/**
 * POST /nuxt-api/tags/[id]/archive
 *
 * 軟刪 / 還原。Body: { archive: boolean }（true=archive, false=restore）。
 * 權限：canManageFleet
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeTagAuditLog, type TagDoc, type TagStatus } from '@@/utils/tag';

interface ArchiveRes {
  id: string;
  status: TagStatus;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canManageFleet')) {
    return forbiddenError({ zh_tw: '需要車隊管理權限', en: 'canManageFleet required', ja: 'フリート管理権限が必要です' });
  }

  const id = getRouterParam(event, 'id');
  if (!id) {
    return badRequestError({ zh_tw: '缺少標籤 ID', en: 'Tag id required', ja: 'タグ ID が必要です' });
  }

  const body = await readBody<Record<string, unknown>>(event).catch(() => null);
  if (!body || typeof body.archive !== 'boolean') {
    return badRequestError({
      zh_tw: '請求格式錯誤（archive 必須為 boolean）',
      en: 'Invalid request body (archive must be boolean)',
      ja: 'リクエスト形式が不正です',
    });
  }
  const wantArchive = body.archive;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('tags').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return notFoundError({ zh_tw: '標籤不存在', en: 'Tag not found', ja: 'タグが見つかりません' });
    }

    const before = snap.data() as Partial<TagDoc>;
    const beforeStatus: TagStatus = before.status ?? 'active';
    const nextStatus: TagStatus = wantArchive ? 'archived' : 'active';

    if (beforeStatus === nextStatus) {
      return successResponse<ArchiveRes>({ id, status: nextStatus });
    }

    await ref.set({
      status: nextStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: auth.lineUid,
    }, { merge: true });

    await writeTagAuditLog({
      db,
      tagId: id,
      action: wantArchive ? 'archive' : 'restore',
      before: { status: beforeStatus },
      after: { status: nextStatus },
      performedBy: auth.lineUid,
    });

    return successResponse<ArchiveRes>({ id, status: nextStatus });
  } catch (err) {
    console.error('[tags archive] failed:', err);
    return serverError();
  }
});
