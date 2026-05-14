/**
 * PUT /nuxt-api/admin/notification-templates/[key]
 *
 * 編輯 template content（upsert）。
 *
 * Body：
 *   title:         string (1-60)
 *   body:          string (1-1000)
 *   coverImageUrl: null | string (https://...)
 *   ctaButton:     null | { label: 1-20, action: TemplateAction }
 *   enabled?:      boolean（default true）
 *
 * 副作用：
 *   - merge 寫 notification_templates/{key}
 *   - **A1 alias 雙寫**：key='order.pending' 時同時寫舊 collection admin_settings_notification_templates/order-pending
 *     （ctaButton 轉成 A1 舊 schema {label, url}；非 uri action 不寫 cta）
 *   - audit log `line.template.update`（含 `notification_template.update` legacy alias for order.pending）
 *
 * 權限：canBroadcast
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';
import { TEMPLATE_REGISTRY, type TemplateAction } from '@@/utils/template-registry';

const TITLE_MAX = 60;
const BODY_MAX = 1000;
const LABEL_MAX = 20;
const URL_MAX = 500;
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
  if (!TEMPLATE_REGISTRY[key]) {
    return notFoundError({ zh_tw: '未知的 template key', en: 'Unknown template key', ja: '未知の template key' });
  }

  const body = await readBody<PutBody>(event).catch(() => null);
  if (!body) {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid body', ja: 'リクエスト形式が不正' });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || title.length > TITLE_MAX) {
    return badRequestError({ zh_tw: `標題長度需 1-${TITLE_MAX} 字`, en: `Title 1-${TITLE_MAX}`, ja: `タイトル 1-${TITLE_MAX}` });
  }
  if (!messageBody || messageBody.length > BODY_MAX) {
    return badRequestError({ zh_tw: `內文長度需 1-${BODY_MAX} 字`, en: `Body 1-${BODY_MAX}`, ja: `本文 1-${BODY_MAX}` });
  }

  let coverImageUrl: string | null = null;
  if (body.coverImageUrl !== undefined && body.coverImageUrl !== null) {
    if (typeof body.coverImageUrl !== 'string' || !body.coverImageUrl.startsWith('https://') || body.coverImageUrl.length > URL_MAX) {
      return badRequestError({ zh_tw: '封面圖網址必須為 HTTPS', en: 'coverImageUrl must be HTTPS', ja: 'カバー画像 URL は HTTPS 必須' });
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

  const enabled = body.enabled !== false;

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    await db.collection('notification_templates').doc(key).set({
      templateKey: key,
      category: TEMPLATE_REGISTRY[key]!.category,
      enabled,
      title,
      body: messageBody,
      coverImageUrl,
      ctaButton,
      updatedBy: auth.lineUid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // ── A1 alias 雙寫（order.pending 同時寫舊 collection 維持 P37 admin UI 可繼續編輯） ──
    if (key === 'order.pending') {
      // 舊 schema ctaButton = {label, url}；非 uri action 不寫 cta（A1 admin UI 無法處理）
      const oldCta = ctaButton && ctaButton.action.type === 'uri'
        ? { label: ctaButton.label, url: ctaButton.action.url }
        : null;
      await db.collection('admin_settings_notification_templates').doc('order-pending').set({
        title,
        body: messageBody,
        coverImageUrl,
        ctaButton: oldCta,
        updatedBy: auth.lineUid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    await writeAuditLog({
      event,
      auth,
      action: 'line.template.update',
      targetType: 'notification_template',
      targetId: key,
      payload: {
        titleLen: title.length,
        bodyLen: messageBody.length,
        hasCover: coverImageUrl !== null,
        hasCta: ctaButton !== null,
        ctaType: ctaButton?.action.type ?? null,
        enabled,
      },
    });

    // legacy alias（A1 audit action）— order.pending 同時寫舊 action key，保持 audit-log 篩選相容
    if (key === 'order.pending') {
      await writeAuditLog({
        event,
        auth,
        action: 'notification_template.update',
        targetType: 'notification_template',
        targetId: 'order-pending',
        payload: { aliasOf: 'line.template.update', via: 'new-endpoint' },
      });
    }

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[admin/notification-templates/[key] PUT] failed:', err);
    return serverError();
  }
});
