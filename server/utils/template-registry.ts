/**
 * Flex Template Registry（P38 Phase 3）
 *
 * 對應 spec design.md §3 + Brain AI 拍板 Q4=4a（server hard-coded registry）/ Q6=6b（5 個 order template）。
 * P40 Phase 4 A1 cleanup 後：loadTemplate 僅讀新 collection（A1 fallback 已移除）。
 *
 * 設計：
 *   - registry 在 server code 寫死；新增 template key 必須改本檔 + 部署
 *   - 每個 template 宣告 placeholder schema（admin UI hint 用）+ defaultContent + fallbackI18nKey
 *   - placeholder 缺值時保留 `{key}` 原字串（避免 admin 看到空白）
 *   - `loadTemplate` 讀 `notification_templates/{key}`；缺值 / disabled → null，caller fallback i18n text
 *   - `buildTemplateFlex` 通用 Flex builder；ctaButton.action 三型別（uri / message / postback）與
 *     richmenu area action 對齊（Q7=7a）；公告也透過此 builder 共用（P40 Phase 3）
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { LineMessage } from '@@/utils/line-push';
import type { OrderMessageKey } from '@@/utils/i18n-message';

// ── Types ─────────────────────────────────────────────────────────

export type TemplateCategory = 'order' | 'announcement' | 'bot' | 'broadcast';

export interface PlaceholderDef {
  key: string;
  label: string;
  example: string;
  required: boolean;
}

export interface TemplateMeta {
  templateKey: string;
  category: TemplateCategory;
  displayName: string;
  description: string;
  placeholders: PlaceholderDef[];
  defaultContent: {
    title: string;
    body: string;
  };
  /** 模板缺失 / disabled 時呼叫端 fallback 的 i18n-message key（沿用 A1 邏輯） */
  fallbackI18nKey?: OrderMessageKey;
}

export type TemplateAction =
  | { type: 'uri'; url: string }
  | { type: 'message'; text: string }
  | { type: 'postback'; data: string; displayText?: string };

export interface TemplateCtaButton {
  label: string;
  action: TemplateAction;
}

export interface TemplateContent {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: TemplateCtaButton | null;
}

// ── Registry（5 個 order template — Q6=6b） ────────────────────────

export const TEMPLATE_REGISTRY: Record<string, TemplateMeta> = {
  'order.pending': {
    templateKey: 'order.pending',
    category: 'order',
    displayName: '訂單建立通知',
    description: '乘客建單成功瞬間推播。最高頻 push，行銷觸達關鍵點。',
    placeholders: [
      { key: 'date', label: '搭乘時間', example: '2026-05-15 14:30', required: true },
      { key: 'pickup', label: '上車點', example: '桃園機場第一航廈', required: true },
      { key: 'vehicle', label: '車型', example: '豪華轎車', required: true },
      { key: 'fare', label: '預估車資', example: '1,800', required: true },
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
    ],
    defaultContent: {
      title: '📝 訂單已建立',
      body: '您的訂單已送出，正在媒合司機。\n\n📅 {date}\n📍 {pickup}\n🚗 {vehicle}\n💰 NT$ {fare}\n🔖 {orderId}',
    },
    fallbackI18nKey: 'order.pending',
  },
  'order.confirmed': {
    templateKey: 'order.confirmed',
    category: 'order',
    displayName: '司機接單通知',
    description: 'driver 自行接單瞬間推播（admin 指派時改用「通知乘客」按鈕手動推）。',
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'driverName', label: '司機姓名', example: '王先生', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
    ],
    defaultContent: {
      title: '✅ 司機已接單',
      body: '司機 {driverName} 已接受您的訂單 {orderId}，準備前往接您。\n車牌：{vehiclePlate}',
    },
    fallbackI18nKey: 'order.confirmed',
  },
  'order.en_route': {
    templateKey: 'order.en_route',
    category: 'order',
    displayName: '司機出發通知',
    description: 'driver 切 en_route 時推播。',
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'driverName', label: '司機姓名', example: '王先生', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
    ],
    defaultContent: {
      title: '🚗 司機已出發',
      body: '司機 {driverName} 正在前往上車點，請至約定地點等候。\n車牌：{vehiclePlate}',
    },
    fallbackI18nKey: 'order.en_route',
  },
  'order.completed': {
    templateKey: 'order.completed',
    category: 'order',
    displayName: '行程完成通知',
    description: 'driver 切 completed 時推播；行銷觸達點（再次預訂 CTA）。',
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'fare', label: '車資', example: '1,800', required: false },
    ],
    defaultContent: {
      title: '🎉 行程已完成',
      body: '感謝您搭乘 Destination Anywhere！\n本次車資：NT$ {fare}\n訂單編號：{orderId}\n\n期待再次為您服務。',
    },
    fallbackI18nKey: 'order.completed',
  },
  'order.cancelled': {
    templateKey: 'order.cancelled',
    category: 'order',
    displayName: '訂單取消通知',
    description: 'admin / driver 切 cancelled 時推播；含取消原因（如有）。',
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'cancelReason', label: '取消原因', example: '司機無法配合時段', required: false },
    ],
    defaultContent: {
      title: '⚠️ 訂單已取消',
      body: '您的訂單 {orderId} 已取消。\n原因：{cancelReason}\n\n如需協助請聯絡客服。',
    },
    fallbackI18nKey: 'order.cancelled',
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_REGISTRY);

export function getTemplateMeta(templateKey: string): TemplateMeta | null {
  return TEMPLATE_REGISTRY[templateKey] ?? null;
}

// ── Flex Builder（取代 A1 hard-coded buildOrderPendingFlex） ────────

const MAX_ALT_TEXT = 400;
const MAX_LABEL = 20;
const FLEX_AMBER = '#D4860A';

/** 把 `{placeholder}` 替換為 params[key]；缺值保留原字串供 admin 排錯 */
const _applyPlaceholders = (text: string, params: Record<string, string>): string => {
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const v = params[key];
    return typeof v === 'string' && v.length > 0 ? v : `{${key}}`;
  });
};

const _buildActionPayload = (action: TemplateAction, params: Record<string, string>): object | null => {
  if (action.type === 'uri') {
    const uri = _applyPlaceholders(action.url, params);
    if (!uri.startsWith('https://') && !uri.startsWith('line://')) return null;
    return { type: 'uri', uri };
  }
  if (action.type === 'message') {
    const text = _applyPlaceholders(action.text, params);
    if (!text || text.length === 0) return null;
    return { type: 'message', text };
  }
  // postback
  const data = _applyPlaceholders(action.data, params);
  if (!data || data.length === 0) return null;
  const out: Record<string, unknown> = { type: 'postback', data };
  if (action.displayText) out.displayText = _applyPlaceholders(action.displayText, params);
  return out;
};

/**
 * 套用 placeholder 並組 LINE Flex Bubble。
 *
 * @returns null 當 template 為 null 或缺 title/body（呼叫端 fallback i18n text）
 */
export function buildTemplateFlex(
  template: TemplateContent | null,
  params: Record<string, string>,
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
    const actionPayload = _buildActionPayload(template.ctaButton.action, params);
    if (actionPayload) {
      bubble.footer = {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          action: { ...actionPayload, label: template.ctaButton.label.slice(0, MAX_LABEL) },
          style: 'primary',
          color: FLEX_AMBER,
        }],
      };
    }
  }

  return { type: 'flex', altText, contents: bubble };
}

// ── Loader（單路徑 — P40 Phase 4 cleanup 後僅讀新 collection） ────────

const NEW_COLLECTION = 'notification_templates';

/** Doc → TemplateContent，含 ctaButton schema 正規化 */
function _normalizeContent(data: Record<string, unknown>): TemplateContent | null {
  const title = typeof data.title === 'string' ? data.title : '';
  const body = typeof data.body === 'string' ? data.body : '';
  if (!title || !body) return null;
  if (data.enabled === false) return null;

  const cta = data.ctaButton;
  let ctaButton: TemplateCtaButton | null = null;
  if (cta && typeof cta === 'object') {
    const c = cta as Record<string, unknown>;
    const label = typeof c.label === 'string' ? c.label : '';
    if (label) {
      // 新 schema：{ label, action: { type, ... } }
      const action = c.action as Record<string, unknown> | undefined;
      if (action && typeof action.type === 'string') {
        if (action.type === 'uri' && typeof action.url === 'string') {
          ctaButton = { label, action: { type: 'uri', url: action.url } };
        } else if (action.type === 'message' && typeof action.text === 'string') {
          ctaButton = { label, action: { type: 'message', text: action.text } };
        } else if (action.type === 'postback' && typeof action.data === 'string') {
          ctaButton = {
            label,
            action: {
              type: 'postback',
              data: action.data,
              ...(typeof action.displayText === 'string' ? { displayText: action.displayText } : {}),
            },
          };
        }
      } else if (typeof c.url === 'string') {
        // A1 舊 schema：{ label, url } → 自動轉成 { label, action: { type: 'uri', url } }
        ctaButton = { label, action: { type: 'uri', url: c.url } };
      }
    }
  }

  return {
    title,
    body,
    coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl : null,
    ctaButton,
  };
}

/**
 * 讀 template（P40 Phase 4 cleanup 後：僅讀新 collection；A1 fallback 邏輯已移除）。
 *
 * 缺值情境（回 null，呼叫端 fallback i18n text）：
 *   - doc 不存在
 *   - title 或 body 為空
 *   - enabled=false（admin 暫停用）
 */
export async function loadTemplate(
  db: Firestore,
  templateKey: string,
): Promise<TemplateContent | null> {
  try {
    const snap = await db.collection(NEW_COLLECTION).doc(templateKey).get();
    if (!snap.exists) return null;
    return _normalizeContent(snap.data() ?? {});
  } catch (err) {
    console.error(`[template-registry] loadTemplate(${templateKey}) failed:`, err);
    return null;
  }
}

/**
 * 寫入 template（upsert）。
 *
 * @param data 已過 endpoint validation 的 TemplateContent
 * @param writerLineUid 寫入者 lineUid（給 updatedBy）
 */
export async function saveTemplate(
  db: Firestore,
  templateKey: string,
  data: TemplateContent & { enabled?: boolean },
  writerLineUid: string,
): Promise<void> {
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection(NEW_COLLECTION).doc(templateKey).set({
    templateKey,
    category: TEMPLATE_REGISTRY[templateKey]?.category ?? 'order',
    enabled: data.enabled ?? true,
    title: data.title,
    body: data.body,
    coverImageUrl: data.coverImageUrl,
    ctaButton: data.ctaButton,
    updatedBy: writerLineUid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/** 清掉 doc（admin reset 用，回到 registry defaultContent） */
export async function resetTemplate(db: Firestore, templateKey: string, writerLineUid: string): Promise<void> {
  const meta = TEMPLATE_REGISTRY[templateKey];
  if (!meta) throw new Error(`Unknown template key: ${templateKey}`);
  await saveTemplate(db, templateKey, {
    title: meta.defaultContent.title,
    body: meta.defaultContent.body,
    coverImageUrl: null,
    ctaButton: null,
    enabled: true,
  }, writerLineUid);
}
