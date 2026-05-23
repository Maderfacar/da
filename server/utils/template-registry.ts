/**
 * Flex / Text Template Registry（P38 → 2026-05-23 line-template-expansion W2）
 *
 * 本檔同時負責：
 *   - server 寫死的 registry meta（admin UI 顯示 / placeholder hint / 預設內容）
 *   - 從 Firestore `notification_templates/{key}` 讀使用者編輯內容（loadTemplate）
 *   - 通用 Flex / Text Bubble builder（buildTemplate*）
 *
 * W2 schema 擴充（line-template-expansion）：
 *   - 加 dispatch / softmatch / driver-notify 三個 category
 *   - 加 outputType（flex / text）/ audience / i18nMode / triggerType / triggerEvent / requiresSuperLevel
 *   - 拔除 fallbackI18nKey（i18n-message.ts 走向 deprecate；W4 全部觸發點遷移完才 delete）
 *   - 文件 schema 從 root-level title/body 改 nested content.{lang}.{title|body|...}；
 *     loadTemplate 同時容錯舊 root-level 格式（避免 W2 推 prod 後既有資料失效）
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { LineMessage } from '@@/utils/line-push';

// ── Types ─────────────────────────────────────────────────────────

export type TemplateCategory =
  | 'order'
  | 'announcement'
  | 'bot'
  | 'broadcast'
  | 'dispatch'        // F1 / F3 / F4 派發 / 配對
  | 'softmatch'       // F5 / F6 軟性配對
  | 'driver-notify';  // T3-T9 司機通知

export type TemplateOutputType = 'flex' | 'text';
export type TemplateAudience = 'passenger' | 'driver' | 'admin' | 'both';
export type TemplateI18nMode = 'multi' | 'single';
export type TemplateTriggerType = 'auto' | 'manual';
export type TemplateLang = 'zh_tw' | 'en' | 'ja';

const VALID_LANGS: readonly TemplateLang[] = ['zh_tw', 'en', 'ja'] as const;

export const isValidLang = (v: unknown): v is TemplateLang =>
  typeof v === 'string' && (VALID_LANGS as readonly string[]).includes(v);

export interface PlaceholderDef {
  key: string;
  label: string;
  example: string;
  required: boolean;
}

export type TemplateAction =
  | { type: 'uri'; url: string }
  | { type: 'message'; text: string }
  | { type: 'postback'; data: string; displayText?: string };

export interface TemplateCtaButton {
  label: string;
  action: TemplateAction;
}

/** Flex 模板內容（title + body + 可選封面圖 + 可選 CTA 按鈕） */
export interface TemplateContentFlex {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: TemplateCtaButton | null;
}

/** Text 模板內容（純文字 LINE message） */
export interface TemplateContentText {
  body: string;
}

/** Union：實際型別視 TemplateMeta.outputType 而定 */
export type TemplateContent = TemplateContentFlex | TemplateContentText;

export interface TemplateMeta {
  templateKey: string;
  category: TemplateCategory;
  displayName: string;
  description: string;
  /** 觸發事件描述（admin UI hint，如「乘客成功建單瞬間」） */
  triggerEvent: string;
  outputType: TemplateOutputType;
  audience: TemplateAudience;
  i18nMode: TemplateI18nMode;
  triggerType: TemplateTriggerType;
  /** dispatch / driver-notify 類限 super only；order / softmatch / bot 類 admin+ 可改 */
  requiresSuperLevel: boolean;
  placeholders: PlaceholderDef[];
  /** 結構視 outputType 而定（flex → TemplateContentFlex；text → TemplateContentText） */
  defaultContent: TemplateContent;
}

// ── Registry（5 個 order template；W3 將擴 12 個新 entry） ─────────────

export const TEMPLATE_REGISTRY: Record<string, TemplateMeta> = {
  'order.pending': {
    templateKey: 'order.pending',
    category: 'order',
    displayName: '訂單建立通知',
    description: '乘客建單成功瞬間推播。最高頻 push，行銷觸達關鍵點。',
    triggerEvent: '乘客成功建單瞬間（passenger order created）',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
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
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'order.confirmed': {
    templateKey: 'order.confirmed',
    category: 'order',
    displayName: '司機接單通知',
    description: 'driver 自行接單瞬間推播（admin 指派時改用「通知乘客」按鈕手動推）。',
    triggerEvent: '訂單狀態切 confirmed 時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'driverName', label: '司機姓名', example: '王先生', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
    ],
    defaultContent: {
      title: '✅ 司機已接單',
      body: '司機 {driverName} 已接受您的訂單 {orderId}，準備前往接您。\n車牌：{vehiclePlate}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'order.en_route': {
    templateKey: 'order.en_route',
    category: 'order',
    displayName: '司機出發通知',
    description: 'driver 切 en_route 時推播。',
    triggerEvent: '訂單狀態切 en_route 時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'driverName', label: '司機姓名', example: '王先生', required: false },
      { key: 'vehiclePlate', label: '車牌', example: 'ABC-1234', required: false },
    ],
    defaultContent: {
      title: '🚗 司機已出發',
      body: '司機 {driverName} 正在前往上車點，請至約定地點等候。\n車牌：{vehiclePlate}',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'order.completed': {
    templateKey: 'order.completed',
    category: 'order',
    displayName: '行程完成通知',
    description: 'driver 切 completed 時推播；行銷觸達點（再次預訂 CTA）。',
    triggerEvent: '訂單狀態切 completed 時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'fare', label: '車資', example: '1,800', required: false },
    ],
    defaultContent: {
      title: '🎉 行程已完成',
      body: '感謝您搭乘 Destination Anywhere！\n本次車資：NT$ {fare}\n訂單編號：{orderId}\n\n期待再次為您服務。',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
  'order.cancelled': {
    templateKey: 'order.cancelled',
    category: 'order',
    displayName: '訂單取消通知',
    description: 'admin / driver 切 cancelled 時推播；含取消原因（如有）。',
    triggerEvent: '訂單狀態切 cancelled 時推給乘客',
    outputType: 'flex',
    audience: 'passenger',
    i18nMode: 'multi',
    triggerType: 'auto',
    requiresSuperLevel: false,
    placeholders: [
      { key: 'orderId', label: '訂單編號', example: 'ABCD1234', required: true },
      { key: 'cancelReason', label: '取消原因', example: '司機無法配合時段', required: false },
    ],
    defaultContent: {
      title: '⚠️ 訂單已取消',
      body: '您的訂單 {orderId} 已取消。\n原因：{cancelReason}\n\n如需協助請聯絡客服。',
      coverImageUrl: null,
      ctaButton: null,
    },
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_REGISTRY);

export function getTemplateMeta(templateKey: string): TemplateMeta | null {
  return TEMPLATE_REGISTRY[templateKey] ?? null;
}

// ── Flex / Text Builder ─────────────────────────────────────────────

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
  template: TemplateContentFlex | null,
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

/**
 * 套用 placeholder 組純文字 LINE message。
 *
 * @returns null 當 template 為 null / body 為空 / 套完 placeholder 後仍為空字串
 */
export function buildTemplateText(
  template: TemplateContentText | null,
  params: Record<string, string>,
): LineMessage | null {
  if (!template || !template.body) return null;
  const text = _applyPlaceholders(template.body, params);
  if (!text || text.length === 0) return null;
  return { type: 'text', text };
}

/**
 * 通用 build：依 outputType 分派到 Flex 或 Text builder。
 *
 * caller 在 W4 後將統一走此函式（trigger 點不再各自挑 builder）。
 */
export function buildTemplate(
  template: TemplateContent | null,
  params: Record<string, string>,
  outputType: TemplateOutputType,
): LineMessage | null {
  if (outputType === 'text') {
    return buildTemplateText((template as TemplateContentText | null) ?? null, params);
  }
  return buildTemplateFlex((template as TemplateContentFlex | null) ?? null, params);
}

// ── Loader ──────────────────────────────────────────────────────────

const NEW_COLLECTION = 'notification_templates';

/**
 * Doc 子物件（content.{lang} 或 root-level legacy）→ TemplateContent。
 * 視 outputType 而定，做最小欄位驗證；不符回 null。
 */
function _normalizeContent(
  data: Record<string, unknown>,
  outputType: TemplateOutputType,
): TemplateContent | null {
  if (outputType === 'text') {
    const body = typeof data.body === 'string' ? data.body : '';
    if (!body) return null;
    return { body };
  }

  // flex
  const title = typeof data.title === 'string' ? data.title : '';
  const body = typeof data.body === 'string' ? data.body : '';
  if (!title || !body) return null;

  const cta = data.ctaButton;
  let ctaButton: TemplateCtaButton | null = null;
  if (cta && typeof cta === 'object') {
    const c = cta as Record<string, unknown>;
    const label = typeof c.label === 'string' ? c.label : '';
    if (label) {
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
        // 更舊的 A1 schema：{ label, url }
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
 * 讀 admin 編輯內容；缺值 / disabled / 找不到 → null（呼叫端 fallback 用 registry.defaultContent）。
 *
 * 新 schema：
 *   { templateKey, enabled, content: { zh_tw: {...}, en?: {...}, ja?: {...} }, ... }
 *
 * Legacy schema（pre-W2，root-level）：
 *   { templateKey, enabled, title, body, coverImageUrl, ctaButton }
 *   → loadTemplate 自動容錯，避免 W2 推 prod 後既有 admin 編輯內容失效。
 *
 * @param lang i18nMode='single' 時無視；i18nMode='multi' 時找不到指定 lang 退回 zh_tw。
 */
export async function loadTemplate(
  db: Firestore,
  templateKey: string,
  lang: TemplateLang = 'zh_tw',
): Promise<TemplateContent | null> {
  const meta = TEMPLATE_REGISTRY[templateKey];
  if (!meta) return null;

  const effectiveLang: TemplateLang = meta.i18nMode === 'single' ? 'zh_tw' : lang;

  try {
    const snap = await db.collection(NEW_COLLECTION).doc(templateKey).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if (data.enabled === false) return null;

    // 1) 新 schema：content.{lang}
    const contentMap = data.content as Record<string, unknown> | undefined;
    if (contentMap && typeof contentMap === 'object') {
      const langData = contentMap[effectiveLang];
      if (langData && typeof langData === 'object') {
        const c = _normalizeContent(langData as Record<string, unknown>, meta.outputType);
        if (c) return c;
      }
      // 多語模板找不到指定 lang → 退回 zh_tw
      if (meta.i18nMode === 'multi' && effectiveLang !== 'zh_tw') {
        const zh = contentMap.zh_tw;
        if (zh && typeof zh === 'object') {
          const c = _normalizeContent(zh as Record<string, unknown>, meta.outputType);
          if (c) return c;
        }
      }
    }

    // 2) Legacy root-level fallback（pre-W2 doc）
    return _normalizeContent(data, meta.outputType);
  } catch (err) {
    console.error(`[template-registry] loadTemplate(${templateKey}) failed:`, err);
    return null;
  }
}

/**
 * 寫入單一語系的 template content（upsert，merge=true）。
 *
 * 寫入結構：
 *   notification_templates/{key} = {
 *     templateKey, category, enabled,
 *     content: { [lang]: { title, body, coverImageUrl, ctaButton } },
 *     updatedBy, updatedAt,
 *   }
 */
export async function saveTemplate(
  db: Firestore,
  templateKey: string,
  data: TemplateContent & { enabled?: boolean },
  writerLineUid: string,
  lang: TemplateLang = 'zh_tw',
): Promise<void> {
  const meta = TEMPLATE_REGISTRY[templateKey];
  if (!meta) throw new Error(`Unknown template key: ${templateKey}`);

  const { FieldValue } = await import('firebase-admin/firestore');

  // 視 outputType 組對應 sub-doc
  const subDoc: Record<string, unknown> = meta.outputType === 'text'
    ? { body: (data as TemplateContentText).body }
    : {
      title: (data as TemplateContentFlex).title,
      body: (data as TemplateContentFlex).body,
      coverImageUrl: (data as TemplateContentFlex).coverImageUrl,
      ctaButton: (data as TemplateContentFlex).ctaButton,
    };

  await db.collection(NEW_COLLECTION).doc(templateKey).set({
    templateKey,
    category: meta.category,
    enabled: data.enabled ?? true,
    content: { [lang]: subDoc },
    updatedBy: writerLineUid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * 還原 template 到 registry.defaultContent（zh_tw）。
 *
 * 多語模板的 en/ja 不在此處清除（W6 多語 editor 上線後可由 admin 個別語系 reset）。
 */
export async function resetTemplate(db: Firestore, templateKey: string, writerLineUid: string): Promise<void> {
  const meta = TEMPLATE_REGISTRY[templateKey];
  if (!meta) throw new Error(`Unknown template key: ${templateKey}`);
  await saveTemplate(db, templateKey, {
    ...(meta.defaultContent as TemplateContent),
    enabled: true,
  }, writerLineUid, 'zh_tw');
}
