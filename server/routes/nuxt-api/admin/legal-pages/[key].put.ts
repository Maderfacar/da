/**
 * PUT /nuxt-api/admin/legal-pages/[key]
 *
 * 更新 'terms' / 'privacy' 兩 doc 之一。
 *
 * Body: { title: string; bodyHtml: string }
 *
 * 行為：
 *   - upsert：doc 不存在則建（version=1），存在則 version+1
 *   - validate title 1-200 字，bodyHtml ≤ 100 KB
 *   - audit log: legal_page.update with { key, version, titleLen, bodyHtmlLen }
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  validateLegalKey,
  validateTitle,
  validateBodyHtml,
  type LegalPageDoc,
} from '@@/utils/legal-pages';

interface PutBody {
  title?: unknown;
  bodyHtml?: unknown;
}

interface PutRes {
  key: string;
  version: number;
  updatedAt: string;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const rawKey = getRouterParam(event, 'key');
  const keyCheck = validateLegalKey(rawKey);
  if (!keyCheck.ok) return badRequestError({ zh_tw: keyCheck.error, en: keyCheck.error, ja: keyCheck.error });

  const body = await readBody<PutBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  const titleCheck = validateTitle(body.title);
  if (!titleCheck.ok) return badRequestError({ zh_tw: titleCheck.error, en: titleCheck.error, ja: titleCheck.error });

  const bodyCheck = validateBodyHtml(body.bodyHtml);
  if (!bodyCheck.ok) return badRequestError({ zh_tw: bodyCheck.error, en: bodyCheck.error, ja: bodyCheck.error });

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const ref = db.collection('legal_pages').doc(keyCheck.value);
    const snap = await ref.get();
    const prevVersion = snap.exists ? Number((snap.data() as Partial<LegalPageDoc>)?.version ?? 0) : 0;
    const nextVersion = (Number.isFinite(prevVersion) ? prevVersion : 0) + 1;

    const update: Partial<LegalPageDoc> & { updatedAt: FirebaseFirestore.FieldValue } = {
      key: keyCheck.value,
      title: titleCheck.value,
      bodyHtml: bodyCheck.value,
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
      version: nextVersion,
    };

    await ref.set(update, { merge: true });

    // 取最新 updatedAt（client 端可立刻顯示而不用再 GET）
    const after = await ref.get();
    const updatedAt = (after.data() as Partial<LegalPageDoc>)?.updatedAt;
    const isoTs = (updatedAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toISOString() ?? new Date().toISOString();

    await writeAuditLog({
      event,
      auth,
      action: 'legal_page.update',
      targetType: 'legal_page',
      targetId: keyCheck.value,
      payload: {
        key: keyCheck.value,
        version: nextVersion,
        titleLen: titleCheck.value.length,
        bodyHtmlLen: bodyCheck.value.length,
      },
    });

    return successResponse<PutRes>({
      key: keyCheck.value,
      version: nextVersion,
      updatedAt: isoTs,
    });
  } catch (err) {
    console.error('[admin/legal-pages [key] PUT] failed:', err);
    return serverError();
  }
});
