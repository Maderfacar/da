/**
 * PUT /nuxt-api/admin/notification-templates/[key]
 *
 * 編輯 template content（upsert）。
 *
 * Body：
 *   title?:         string (1-60)，outputType='flex' 必填
 *   body:           string (1-1000)
 *   coverImageUrl?: null | string (https://...)
 *   ctaButton?:     null | { label: 1-20, action: TemplateAction }
 *   enabled?:       boolean（default true）
 *   lang?:          'zh_tw' | 'en' | 'ja'（W6 多語 editor 用；不傳預設 zh_tw）
 *
 * 副作用：
 *   - merge 寫 notification_templates/{key}.content.{lang}
 *   - audit log `line.template.update`
 *
 * W2 schema 變更：
 *   - 之前 PUT 寫 root-level title/body/...；改為寫 content.{lang}.{...} 以支援多語
 *   - i18nMode='single' 模板強制 lang='zh_tw'
 *   - outputType='text' 模板只接受 body / enabled，忽略 title / coverImageUrl / ctaButton
 *
 * 權限：canBroadcast；W2 暫不導入 super 級別校驗（W8 audit + permission enforcement 階段加）
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import {
  TEMPLATE_REGISTRY,
  isValidLang,
  type TemplateAction,
  type TemplateLang,
} from '@@/utils/template-registry';

const TITLE_MAX = 60;
const BODY_MAX = 1000;
const LABEL_MAX = 20;
const URL_MAX = 500;
/**
 * 封面圖 URL 上限放寬到 2048：Firebase Storage V4 signed URL 含 X-Goog-Signature
 * 等 query params 通常 600-800 chars，原本 URL_MAX=500 不夠。瀏覽器一般 URL 安全上限
 * 約 2048-8192，2048 是 RFC 7230 推薦上限。
 */
const COVER_URL_MAX = 2048;
const TEXT_MAX = 300;
const DATA_MAX = 300;

interface PutBody {
  title?: string;
  body?: string;
  coverImageUrl?: string | null;
  ctaButton?: {
    label?: string;
    action?: { type?: string; url?: string; text?: string; data?: string; displayText?: string };
  } | null;
  enabled?: boolean;
  lang?: string;
}

const _validAction = (raw: unknown): { ok: true; value: TemplateAction } | { ok: false; error: string } => {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'action 缺失' };
  const a = raw as Record<string, unknown>;
  if (a.type === 'uri') {
    if (typeof a.url !== 'string' || !a.url.startsWith('https://') || a.url.length > URL_MAX) {
      return { ok: false, error: `uri action 的 url 必須為 https://，長度 ≤ ${URL_MAX}` };
    }
    return { ok: true, value: { type: 'uri', url: a.url } };
  }
  if (a.type === 'message') {
    if (typeof a.text !== 'string' || a.text.length === 0 || a.text.length > TEXT_MAX) {
      return { ok: false, error: `message action 的 text 必須為 1-${TEXT_MAX} 字` };
    }
    return { ok: true, value: { type: 'message', text: a.text } };
  }
  if (a.type === 'postback') {
    if (typeof a.data !== 'string' || a.data.length === 0 || a.data.length > DATA_MAX) {
      return { ok: false, error: `postback action 的 data 必須為 1-${DATA_MAX} 字` };
    }
    return {
      ok: true,
      value: {
        type: 'postback',
        data: a.data,
        ...(typeof a.displayText === 'string' ? { displayText: a.displayText.slice(0, 300) } : {}),
      },
    };
  }
  return { ok: false, error: 'action.type 必須為 uri / message / postback' };
};

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

  const body = await readBody<PutBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid body', ja: 'リクエスト形式が不正' });
  }

  // 語系：i18nMode='single' 強制 zh_tw
  const requestedLang = typeof body.lang === 'string' && isValidLang(body.lang) ? body.lang : 'zh_tw';
  const lang: TemplateLang = meta.i18nMode === 'single' ? 'zh_tw' : requestedLang;

  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!messageBody || messageBody.length > BODY_MAX) {
    return badRequestError({ zh_tw: `內文長度需 1-${BODY_MAX} 字`, en: `Body 1-${BODY_MAX}`, ja: `本文 1-${BODY_MAX}` });
  }

  // 視 outputType 組 sub-doc
  let subDoc: Record<string, unknown>;
  let auditPayload: Record<string, unknown>;

  if (meta.outputType === 'text') {
    // text 模板：只接受 body
    subDoc = { body: messageBody };
    auditPayload = { lang, bodyLen: messageBody.length, outputType: 'text' as const };
  } else {
    // flex 模板：title 必填 + 可選 cover / cta
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > TITLE_MAX) {
      return badRequestError({ zh_tw: `標題長度需 1-${TITLE_MAX} 字`, en: `Title 1-${TITLE_MAX}`, ja: `タイトル 1-${TITLE_MAX}` });
    }

    let coverImageUrl: string | null = null;
    if (body.coverImageUrl !== undefined && body.coverImageUrl !== null) {
      if (typeof body.coverImageUrl !== 'string') {
        return badRequestError({ zh_tw: '封面圖網址必須為字串', en: 'coverImageUrl must be a string', ja: 'カバー画像 URL は文字列' });
      }
      if (!body.coverImageUrl.startsWith('https://')) {
        return badRequestError({ zh_tw: '封面圖網址必須為 HTTPS', en: 'coverImageUrl must be HTTPS', ja: 'カバー画像 URL は HTTPS 必須' });
      }
      if (body.coverImageUrl.length > COVER_URL_MAX) {
        return badRequestError({
          zh_tw: `封面圖網址過長（最多 ${COVER_URL_MAX} 字元，實際 ${body.coverImageUrl.length}）`,
          en: `coverImageUrl too long (max ${COVER_URL_MAX} chars, got ${body.coverImageUrl.length})`,
          ja: `カバー画像 URL が長すぎる（最大 ${COVER_URL_MAX} 文字、実際 ${body.coverImageUrl.length}）`,
        });
      }
      coverImageUrl = body.coverImageUrl;
    }

    let ctaButton: { label: string; action: TemplateAction } | null = null;
    if (body.ctaButton !== undefined && body.ctaButton !== null) {
      const label = typeof body.ctaButton.label === 'string' ? body.ctaButton.label.trim() : '';
      if (!label || label.length > LABEL_MAX) {
        return badRequestError({ zh_tw: `按鈕標籤需 1-${LABEL_MAX} 字`, en: `Label 1-${LABEL_MAX}`, ja: `ラベル 1-${LABEL_MAX}` });
      }
      const ar = _validAction(body.ctaButton.action);
      if (!ar.ok) {
        return badRequestError({ zh_tw: ar.error, en: ar.error, ja: ar.error });
      }
      ctaButton = { label, action: ar.value };
    }

    subDoc = {
      title,
      body: messageBody,
      coverImageUrl,
      ctaButton,
    };
    auditPayload = {
      lang,
      titleLen: title.length,
      bodyLen: messageBody.length,
      hasCover: coverImageUrl !== null,
      hasCta: ctaButton !== null,
      ctaType: ctaButton?.action.type ?? null,
      outputType: 'flex' as const,
    };
  }

  const enabled = body.enabled !== false;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await db.collection('notification_templates').doc(key).set({
      templateKey: key,
      category: meta.category,
      enabled,
      content: { [lang]: subDoc },
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await writeAuditLog({
      event,
      auth,
      action: 'line.template.update',
      targetType: 'notification_template',
      targetId: key,
      payload: { ...auditPayload, enabled },
    });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[admin/notification-templates/[key] PUT] failed:', err);
    return serverError();
  }
});
