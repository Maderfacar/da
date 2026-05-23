/**
 * GET /nuxt-api/admin/notification-templates
 *
 * 列出所有 registry 已宣告的 template，merge Firestore doc 內容。
 *
 * 回傳：
 *   { items: Array<{
 *       meta: TemplateMeta（registry 來；W2 後含 outputType / audience / i18nMode / triggerType / requiresSuperLevel），
 *       content: TemplateContent | null（admin 編輯內容；無 doc / disabled / 缺欄位為 null），
 *       enabled: boolean,
 *       updatedBy?: string,
 *       updatedAt?: string (ISO),
 *     }>
 *   }
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
  type TemplateMeta,
  type TemplateOutputType,
} from '@@/utils/template-registry';

interface TemplateItem {
  meta: TemplateMeta;
  content: TemplateContent | null;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

/**
 * 從 doc 抽出 zh_tw content（admin UI 預設顯示語系）。
 * 1. 優先讀 content.zh_tw（W2 後 schema）
 * 2. 退回 root-level title/body/...（pre-W2 legacy）
 */
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

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    const keys = Object.keys(TEMPLATE_REGISTRY);
    const docs = await Promise.all(
      keys.map((k) => db.collection('notification_templates').doc(k).get()),
    );

    const items: TemplateItem[] = keys.map((k, idx) => {
      const meta = TEMPLATE_REGISTRY[k]!;
      const snap = docs[idx]!;
      const data = snap.exists ? snap.data() ?? {} : {};
      const content = _extractAdminContent(data, meta.outputType);
      const updatedAt = (data.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toISOString() ?? null;

      return {
        meta,
        content,
        enabled: data.enabled !== false,
        updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
        updatedAt,
      };
    });

    return successResponse({ items });
  } catch (err) {
    console.error('[admin/notification-templates GET] failed:', err);
    return serverError();
  }
});
