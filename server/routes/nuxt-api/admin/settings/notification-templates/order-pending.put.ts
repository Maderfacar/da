/**
 * PUT /nuxt-api/admin/settings/notification-templates/order-pending
 *
 * 編輯訂單建立通知模板（Wave 3-A1）— upsert 單一 doc。
 *
 * 權限：canBroadcast
 *
 * Body validation：
 *   - title: string, 1..60
 *   - body: string, 1..1000
 *   - coverImageUrl: null | string (https://...)
 *   - ctaButton: null | { label: 1..20, url: https://... }
 *
 * 副作用：
 *   - merge 寫入 admin_settings_notification_templates/order-pending
 *   - audit log `notification_template.update`
 */
import { useFirebaseAdmin } from '@@/utils/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { successResponse, badRequestError, serverError, forbiddenError } from '@@/utils/response';
import { getAuthFromEvent, authFailResponse } from '@@/utils/require-auth';
import { hasPermission } from '@@/utils/require-permission';
import { writeAuditLog } from '@@/utils/audit-log';

interface PutBody {
  title?: string;
  body?: string;
  coverImageUrl?: string | null;
  ctaButton?: { label: string; url: string } | null;
}

const TITLE_MAX = 60;
const BODY_MAX = 1000;
const LABEL_MAX = 20;

const _isHttpsUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('https://') && v.length <= 500;

export default defineEventHandler(async (event) => {
  const auth = await getAuthFromEvent(event);
  if (!auth.ok) return authFailResponse(auth);
  if (!hasPermission(auth, 'canBroadcast')) {
    return forbiddenError({ zh_tw: '需要廣播權限', en: 'canBroadcast required', ja: 'ブロードキャスト権限が必要です' });
  }

  let body: PutBody;
  try {
    body = await readBody<PutBody>(event);
  } catch {
    return badRequestError({ zh_tw: '請求格式錯誤', en: 'Invalid request body', ja: 'リクエスト形式が不正です' });
  }

  // ── title / body 必填 + 長度限制 ─────────────────────────
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || title.length > TITLE_MAX) {
    return badRequestError({
      zh_tw: `標題長度需 1-${TITLE_MAX} 字`,
      en: `Title must be 1-${TITLE_MAX} chars`,
      ja: `タイトルは 1-${TITLE_MAX} 文字`,
    });
  }
  if (!messageBody || messageBody.length > BODY_MAX) {
    return badRequestError({
      zh_tw: `內文長度需 1-${BODY_MAX} 字`,
      en: `Body must be 1-${BODY_MAX} chars`,
      ja: `本文は 1-${BODY_MAX} 文字`,
    });
  }

  // ── coverImageUrl：null 或 https URL ─────────────────────
  let coverImageUrl: string | null = null;
  if (body.coverImageUrl !== undefined && body.coverImageUrl !== null) {
    if (!_isHttpsUrl(body.coverImageUrl)) {
      return badRequestError({
        zh_tw: '封面圖網址必須是 HTTPS',
        en: 'coverImageUrl must be HTTPS',
        ja: 'カバー画像 URL は HTTPS 必須',
      });
    }
    coverImageUrl = body.coverImageUrl;
  }

  // ── ctaButton：null 或 { label 1-20, url https } ─────────
  let ctaButton: { label: string; url: string } | null = null;
  if (body.ctaButton !== undefined && body.ctaButton !== null) {
    const label = typeof body.ctaButton.label === 'string' ? body.ctaButton.label.trim() : '';
    const url = body.ctaButton.url;
    if (!label || label.length > LABEL_MAX) {
      return badRequestError({
        zh_tw: `按鈕標籤需 1-${LABEL_MAX} 字`,
        en: `Button label must be 1-${LABEL_MAX} chars`,
        ja: `ボタンラベルは 1-${LABEL_MAX} 文字`,
      });
    }
    if (!_isHttpsUrl(url)) {
      return badRequestError({
        zh_tw: '按鈕網址必須是 HTTPS',
        en: 'Button URL must be HTTPS',
        ja: 'ボタン URL は HTTPS 必須',
      });
    }
    ctaButton = { label, url };
  }

  const { firebaseServiceAccountJson } = useRuntimeConfig();
  if (!firebaseServiceAccountJson) return serverError();

  try {
    const { db } = useFirebaseAdmin(firebaseServiceAccountJson);
    // 寫舊 collection（A1 既有）
    await db
      .collection('admin_settings_notification_templates')
      .doc('order-pending')
      .set({
        title,
        body: messageBody,
        coverImageUrl,
        ctaButton,
        updatedBy: auth.lineUid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

    // P38 Phase 3：dual-write 新 collection（ctaButton schema 自動轉換 {label,url} → {label,action:{type:'uri',url}}）
    // 確保新 endpoint / runtime loader 看到一致內容
    await db
      .collection('notification_templates')
      .doc('order.pending')
      .set({
        templateKey: 'order.pending',
        category: 'order',
        enabled: true,
        title,
        body: messageBody,
        coverImageUrl,
        ctaButton: ctaButton ? { label: ctaButton.label, action: { type: 'uri', url: ctaButton.url } } : null,
        updatedBy: auth.lineUid,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

    await writeAuditLog({
      event,
      auth,
      action: 'notification_template.update',
      targetType: 'notification_template',
      targetId: 'order-pending',
      payload: {
        titleLen: title.length,
        bodyLen: messageBody.length,
        hasCover: coverImageUrl !== null,
        hasCta: ctaButton !== null,
        dualWritten: 'notification_templates/order.pending',
      },
    });

    return successResponse({ ok: true });
  } catch (err) {
    console.error('[admin/settings/notification-templates/order-pending.put] failed:', err);
    return serverError();
  }
});
