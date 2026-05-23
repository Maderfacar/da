/**
 * GET /nuxt-api/admin/notification-templates/[key]
 *
 * 取單一 template 的 registry meta + Firestore 內容（zh_tw）。
 *
 * 回傳：
 *   { meta, content, enabled, updatedBy, updatedAt }
 *   content 為 null 時表示 admin 尚未編輯（套 registry defaultContent fallback）
 *
 * 文件容錯：先讀新 schema content.zh_tw；找不到時退回 legacy root-level（pre-W2 doc）。
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import {
  TEMPLATE_REGISTRY,
  type TemplateContent,
  type TemplateContentFlex,
  type TemplateContentText,
  type TemplateOutputType,
} from '@@/utils/template-registry';

function _extractAdminContent(
  data: Record<string, unknown>,
  outputType: TemplateOutputType,
): TemplateContent | null {
  const contentMap = data.content as Record<string, unknown> | undefined;
  const zh = contentMap && typeof contentMap === 'object' ? contentMap.zh_tw : null;
  const source = (zh && typeof zh === 'object' ? zh : data) as Record<string, unknown>;

  if (outputType === 'text') {
    const body = typeof source.body === 'string' ? source.body : '';
    if (!body) return null;
    return { body } satisfies TemplateContentText;
  }

  const title = typeof source.title === 'string' ? source.title : '';
  const body = typeof source.body === 'string' ? source.body : '';
  if (!title || !body) return null;
  return {
    title,
    body,
    coverImageUrl: typeof source.coverImageUrl === 'string' ? source.coverImageUrl : null,
    ctaButton: (source.ctaButton as TemplateContentFlex['ctaButton']) ?? null,
  } satisfies TemplateContentFlex;
}

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
    const content = _extractAdminContent(data, meta.outputType);
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
