/**
 * GET /nuxt-api/admin/notification-templates
 *
 * 列出所有 registry 已宣告的 template，merge Firestore doc 內容。
 *
 * 回傳：
 *   { items: Array<{
 *       meta: TemplateMeta（registry 來）,
 *       content: TemplateContent | null（doc 來；無 doc 或 enabled=false 為 null），
 *       enabled: boolean,
 *       updatedBy?: string,
 *       updatedAt?: string (ISO),
 *     }>
 *   }
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { TEMPLATE_REGISTRY, type TemplateContent, type TemplateMeta } from '@@/utils/template-registry';

interface TemplateItem {
  meta: TemplateMeta;
  content: TemplateContent | null;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
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
      const hasContent = typeof data.title === 'string' && typeof data.body === 'string' && data.title && data.body;
      const content: TemplateContent | null = hasContent ? {
        title: data.title as string,
        body: data.body as string,
        coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl : null,
        ctaButton: (data.ctaButton as TemplateContent['ctaButton']) ?? null,
      } : null;
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
