/**
 * GET /nuxt-api/admin/notification-templates/[key]
 *
 * 取單一 template 的 registry meta + Firestore 內容。
 *
 * 回傳：
 *   { meta, content, enabled, updatedBy, updatedAt }
 *   content 為 null 時表示 admin 尚未編輯（套 registry defaultContent fallback）
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { TEMPLATE_REGISTRY, type TemplateContent } from '@@/utils/template-registry';

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  const key = getRouterParam(event, 'key');
  if (!key) {
    return badRequestError({ zh_tw: 'key 缺失', en: 'key required', ja: 'key が必要' });
  }
  const meta = TEMPLATE_REGISTRY[key];
  if (!meta) {
    return notFoundError({ zh_tw: '未知的 template key', en: 'Unknown template key', ja: '未知の template key' });
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const snap = await db.collection('notification_templates').doc(key).get();
    const data = snap.exists ? snap.data() ?? {} : {};
    const hasContent = typeof data.title === 'string' && typeof data.body === 'string' && data.title && data.body;
    const content: TemplateContent | null = hasContent ? {
      title: data.title as string,
      body: data.body as string,
      coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl : null,
      ctaButton: (data.ctaButton as TemplateContent['ctaButton']) ?? null,
    } : null;
    const updatedAt = (data.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toISOString() ?? null;

    return successResponse({
      meta,
      content,
      enabled: data.enabled !== false,
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
      updatedAt,
    });
  } catch (err) {
    console.error('[admin/notification-templates/[key] GET] failed:', err);
    return serverError();
  }
});
