/**
 * GET /nuxt-api/admin/notification-templates/[key]
 *
 * 取單一 template 的 registry meta + Firestore 內容（三語各一）。
 *
 * 回傳：
 *   {
 *     meta,
 *     content,                        // legacy；指向 contentByLang.zh_tw（向後相容 W2-W6 caller）
 *     contentByLang: { zh_tw, en, ja }, // W7：i18nMode='multi' 時三語 tab 用
 *     enabled, updatedBy, updatedAt,
 *   }
 *   各 lang 的 content 為 null 時表示 admin 尚未編輯該語系（套 registry defaultContent fallback）
 *
 * 文件容錯：先讀新 schema content.{lang}；zh_tw 找不到時退回 legacy root-level（pre-W2 doc）。
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
  type TemplateLang,
  type TemplateOutputType,
} from '@@/utils/template-registry';

const LANGS: TemplateLang[] = ['zh_tw', 'en', 'ja'];

/**
 * 從 sub-doc（單一 lang 的 content）抽出 TemplateContent；缺欄位時回 null（fallback registry default）。
 * @param fallbackToRoot true 時允許退回 root-level（僅 zh_tw legacy doc 用）
 */
function _extractContentFromSubDoc(
  source: Record<string, unknown> | null,
  outputType: TemplateOutputType,
): TemplateContent | null {
  if (!source) return null;
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

function _buildContentByLang(
  data: Record<string, unknown>,
  outputType: TemplateOutputType,
): Record<TemplateLang, TemplateContent | null> {
  const contentMap = data.content as Record<string, unknown> | undefined;
  const out: Record<TemplateLang, TemplateContent | null> = { zh_tw: null, en: null, ja: null };
  for (const lang of LANGS) {
    const sub = contentMap && typeof contentMap === 'object'
      ? (contentMap[lang] as Record<string, unknown> | undefined)
      : undefined;
    out[lang] = _extractContentFromSubDoc(sub ?? null, outputType);
  }
  // zh_tw legacy fallback：若 content.zh_tw 不存在，退回 root-level（pre-W2 doc 形態）
  if (out.zh_tw === null) {
    out.zh_tw = _extractContentFromSubDoc(data, outputType);
  }
  return out;
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
    const contentByLang = _buildContentByLang(data, meta.outputType);
    const updatedAt = (data.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toISOString() ?? null;

    return successResponse({
      meta,
      content: contentByLang.zh_tw,  // legacy 欄位指向 zh_tw（W2-W6 caller 用）
      contentByLang,                  // W7：i18nMode='multi' 三語 tab 用
      enabled: data.enabled !== false,
      updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
      updatedAt,
    });
  } catch (err) {
    console.error('[admin/notification-templates/[key] GET] failed:', err);
    return serverError();
  }
});
