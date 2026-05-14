/**
 * POST /nuxt-api/admin/migrations/a1-template
 *
 * 一次性 migration：把 A1 舊 collection `admin_settings_notification_templates/order-pending` doc
 * 搬到新 collection `notification_templates/order.pending`（ctaButton schema 轉換）。
 *
 * - 冪等：若新 collection 已有 doc，預設不覆蓋；body.overwrite=true 才覆蓋
 * - 若舊 collection 無 doc → no-op，回 { migrated: false, reason: 'no source' }
 * - 舊 doc 不刪（保留 P40 cleanup 階段才一併處理）
 *
 * 權限：**super only**（一次性 ops 任務，非日常 admin 操作）
 *
 * 副作用：audit log `line.template.update`（with payload.via='migration-a1'）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { writeAuditLog } from '@@/utils/audit-log';
import { TEMPLATE_REGISTRY } from '@@/utils/template-registry';

const OLD_COLLECTION = 'admin_settings_notification_templates';
const OLD_DOC_ID = 'order-pending';
const NEW_COLLECTION = 'notification_templates';
const NEW_DOC_ID = 'order.pending';

interface PostBody {
  overwrite?: boolean;
}

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (auth.level !== 'super') {
    return forbiddenError({ zh_tw: '需要 super 管理員權限', en: 'super only', ja: 'super 権限が必要' });
  }

  const body = await readBody<PostBody>(event).catch(() => ({} as PostBody));
  const overwrite = body?.overwrite === true;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);

    const oldSnap = await db.collection(OLD_COLLECTION).doc(OLD_DOC_ID).get();
    if (!oldSnap.exists) {
      return successResponse({ migrated: false, reason: 'A1 source doc not found' });
    }

    const newSnap = await db.collection(NEW_COLLECTION).doc(NEW_DOC_ID).get();
    if (newSnap.exists && !overwrite) {
      return successResponse({
        migrated: false,
        reason: 'New doc already exists. Pass { overwrite: true } to force.',
      });
    }

    const old = oldSnap.data() ?? {};
    const title = typeof old.title === 'string' ? old.title : '';
    const messageBody = typeof old.body === 'string' ? old.body : '';
    if (!title || !messageBody) {
      return successResponse({ migrated: false, reason: 'A1 doc missing title/body' });
    }

    // ctaButton schema 轉換：A1 {label, url} → 新 {label, action: {type: 'uri', url}}
    const oldCta = old.ctaButton as { label?: string; url?: string } | undefined | null;
    const ctaButton = oldCta && typeof oldCta === 'object' && typeof oldCta.label === 'string' && typeof oldCta.url === 'string'
      ? { label: oldCta.label, action: { type: 'uri', url: oldCta.url } }
      : null;

    await db.collection(NEW_COLLECTION).doc(NEW_DOC_ID).set({
      templateKey: NEW_DOC_ID,
      category: TEMPLATE_REGISTRY[NEW_DOC_ID]?.category ?? 'order',
      enabled: true,
      title,
      body: messageBody,
      coverImageUrl: typeof old.coverImageUrl === 'string' ? old.coverImageUrl : null,
      ctaButton,
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await writeAuditLog({
      event,
      auth,
      action: 'line.template.update',
      targetType: 'notification_template',
      targetId: NEW_DOC_ID,
      payload: {
        via: 'migration-a1',
        hadCta: ctaButton !== null,
        overwrote: newSnap.exists,
      },
    });

    return successResponse({
      migrated: true,
      from: `${OLD_COLLECTION}/${OLD_DOC_ID}`,
      to: `${NEW_COLLECTION}/${NEW_DOC_ID}`,
      ctaConverted: ctaButton !== null,
    });
  } catch (err) {
    console.error('[admin/migrations/a1-template] failed:', err);
    return serverError();
  }
});
