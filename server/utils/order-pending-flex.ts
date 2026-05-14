/**
 * 訂單建立通知模板 Flex builder（Wave 3-A1）
 *
 * 沿用 P37 announcement-flex.ts 結構：hero / body / footer button。
 *
 * 與 announcement 差異：
 *   - template 由 admin 在 /admin/settings 編輯 → 寫入
 *     admin_settings_notification_templates/order-pending 單一 doc
 *   - title / body / ctaButton.url 支援 5 個 placeholder：
 *     {date} / {pickup} / {vehicle} / {fare} / {orderId}
 *   - coverImageUrl 不支援 placeholder（純靜態圖）
 *   - template 缺失（doc 不存在或 title/body 為空） → builder 回 null
 *     → 呼叫端 fallback P37 i18n-message.ts 三語 text
 *
 * 三語策略：模板只存繁中（依 design.md §5 拍板），LINE 推播時不依 users.lang 切換
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { LineMessage } from '@@/utils/line-push';

export interface OrderPendingTemplate {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: { label: string; url: string } | null;
}

export interface OrderPendingParams {
  date: string;
  pickup: string;
  vehicle: string;
  fare: string;
  orderId: string;
}

const MAX_ALT_TEXT = 400;
const MAX_LABEL = 20;

const _applyPlaceholders = (text: string, params: OrderPendingParams): string =>
  text
    .replaceAll('{date}', params.date)
    .replaceAll('{pickup}', params.pickup)
    .replaceAll('{vehicle}', params.vehicle)
    .replaceAll('{fare}', params.fare)
    .replaceAll('{orderId}', params.orderId);

/**
 * 套用 placeholder 並組 LINE Flex Bubble。
 *
 * @returns null 當 template 為 null 或缺 title/body（呼叫端 fallback 既有 i18n text）
 */
export function buildOrderPendingFlex(
  template: OrderPendingTemplate | null,
  params: OrderPendingParams,
): LineMessage | null {
  if (!template || !template.title || !template.body) return null;

  const title = _applyPlaceholders(template.title, params);
  const body = _applyPlaceholders(template.body, params);
  const altText = title.slice(0, MAX_ALT_TEXT);

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true, color: '#222222' },
        { type: 'text', text: body, wrap: true, size: 'sm', color: '#666666', margin: 'md' },
      ],
    },
  };

  if (template.coverImageUrl && template.coverImageUrl.startsWith('https://')) {
    bubble.hero = {
      type: 'image',
      url: template.coverImageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  if (template.ctaButton && template.ctaButton.label) {
    const ctaUrl = _applyPlaceholders(template.ctaButton.url, params);
    if (ctaUrl.startsWith('https://')) {
      bubble.footer = {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          action: {
            type: 'uri',
            label: template.ctaButton.label.slice(0, MAX_LABEL),
            uri: ctaUrl,
          },
          style: 'primary',
          color: '#D4860A',
        }],
      };
    }
  }

  return {
    type: 'flex',
    altText,
    contents: bubble,
  };
}

/**
 * 讀 admin_settings_notification_templates/order-pending doc。
 *
 * 不存在 / title / body 任一為空 / Firestore 失敗 → 回 null（呼叫端 fallback）
 */
export async function loadOrderPendingTemplate(
  db: Firestore,
): Promise<OrderPendingTemplate | null> {
  try {
    const snap = await db
      .collection('admin_settings_notification_templates')
      .doc('order-pending')
      .get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data?.title || !data?.body) return null;

    const cta = data.ctaButton;
    const ctaButton = cta && typeof cta === 'object' && typeof cta.label === 'string' && typeof cta.url === 'string'
      ? { label: cta.label, url: cta.url }
      : null;

    return {
      title: String(data.title),
      body: String(data.body),
      coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl : null,
      ctaButton,
    };
  } catch (err) {
    console.error('[order-pending-flex] loadOrderPendingTemplate failed:', err);
    return null;
  }
}
