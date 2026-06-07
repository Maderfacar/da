/**
 * Welcome Sequence schema for bot_replies/{client}.follow（2026-06-08）
 *
 * 取代舊版「單則純文字 follow reply」，支援多則訊息序列（最多 5 則；LINE Messaging API
 * reply / push 一次上限 5 則）。每則可選 text / flex，各帶 3 語內容（zh_tw / en / ja）。
 *
 * Schema 演進：
 *   - Legacy（v1，2026-05 前）：{ enabled, text: string }
 *   - Current（v2，2026-06+）：{ enabled, messages: WelcomeMessage[] }
 *   - migrateBotReplyDoc() 偵測 + 轉換，舊 doc 視為「一則 text 訊息 × 三語都填同一字串」。
 *
 * 適用範圍：僅 follow 類（passenger.follow / driver.follow）。
 *   .text 類（passenger.text / driver.text）維持單則 text，不走此 schema。
 */
import type { LineMessage } from '@@/utils/line-push';

// ── Limits ────────────────────────────────────────────────────
export const MAX_MESSAGES = 5;       // LINE reply / push 一次最多 5 則
export const MAX_TEXT_LEN = 500;     // 文字訊息每語單則上限
export const MAX_TITLE_LEN = 80;
export const MAX_BODY_LEN = 500;
export const MAX_LABEL_LEN = 20;
export const MAX_URL_LEN = 2000;

const MAX_ALT_TEXT = 400;
const FLEX_AMBER = '#D4860A';

// ── Types ────────────────────────────────────────────────────
export type SupportedLang = 'zh_tw' | 'en' | 'ja';
const VALID_LANGS: readonly SupportedLang[] = ['zh_tw', 'en', 'ja'] as const;

export type LangText = Record<SupportedLang, string>;

export interface WelcomeMessageText {
  id: string;
  type: 'text';
  enabled: boolean;
  content: LangText;
}

export interface WelcomeMessageFlex {
  id: string;
  type: 'flex';
  enabled: boolean;
  title: LangText;
  body: LangText;
  coverImageUrl: string | null;
  ctaButton: {
    label: LangText;
    url: string;
  } | null;
}

export type WelcomeMessage = WelcomeMessageText | WelcomeMessageFlex;

export interface WelcomeSequence {
  enabled: boolean;
  messages: WelcomeMessage[];
}

// ── Validation ────────────────────────────────────────────────
export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

const _isStr = (v: unknown): v is string => typeof v === 'string';
const _isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const _validateLangText = (
  v: unknown,
  maxLen: number,
  fieldName: string,
): ValidationResult<LangText> => {
  if (!v || typeof v !== 'object') {
    return { ok: false, error: `${fieldName} 缺失或型別錯誤` };
  }
  const obj = v as Record<string, unknown>;
  const result: Partial<LangText> = {};
  for (const lang of VALID_LANGS) {
    const text = obj[lang];
    if (text === undefined || text === null) {
      result[lang] = '';
      continue;
    }
    if (!_isStr(text)) return { ok: false, error: `${fieldName}.${lang} 必須為字串` };
    if (text.length > maxLen) return { ok: false, error: `${fieldName}.${lang} 超過 ${maxLen} 字` };
    result[lang] = text;
  }
  return { ok: true, value: result as LangText };
};

const _validateHttpsUrl = (v: unknown, fieldName: string): ValidationResult<string> => {
  if (!_isStr(v)) return { ok: false, error: `${fieldName} 必須為字串` };
  const url = v.trim();
  if (!url) return { ok: false, error: `${fieldName} 不可為空` };
  if (!url.startsWith('https://')) return { ok: false, error: `${fieldName} 必須為 https URL` };
  if (url.length > MAX_URL_LEN) return { ok: false, error: `${fieldName} 超過 ${MAX_URL_LEN} 字元` };
  return { ok: true, value: url };
};

const _validateMessage = (m: unknown, idx: number): ValidationResult<WelcomeMessage> => {
  if (!m || typeof m !== 'object') return { ok: false, error: `messages[${idx}] 缺失或型別錯誤` };
  const obj = m as Record<string, unknown>;

  if (!_isStr(obj.id) || obj.id.length === 0) {
    return { ok: false, error: `messages[${idx}].id 必須為非空字串` };
  }
  if (!_isStr(obj.type) || (obj.type !== 'text' && obj.type !== 'flex')) {
    return { ok: false, error: `messages[${idx}].type 必須為 text 或 flex` };
  }
  const enabled = _isBool(obj.enabled) ? obj.enabled : true;

  if (obj.type === 'text') {
    const c = _validateLangText(obj.content, MAX_TEXT_LEN, `messages[${idx}].content`);
    if (!c.ok) return { ok: false, error: c.error };
    return { ok: true, value: { id: obj.id, type: 'text', enabled, content: c.value! } };
  }

  // flex
  const titleR = _validateLangText(obj.title, MAX_TITLE_LEN, `messages[${idx}].title`);
  if (!titleR.ok) return { ok: false, error: titleR.error };
  const bodyR = _validateLangText(obj.body, MAX_BODY_LEN, `messages[${idx}].body`);
  if (!bodyR.ok) return { ok: false, error: bodyR.error };

  let coverImageUrl: string | null = null;
  if (obj.coverImageUrl !== null && obj.coverImageUrl !== undefined && obj.coverImageUrl !== '') {
    const r = _validateHttpsUrl(obj.coverImageUrl, `messages[${idx}].coverImageUrl`);
    if (!r.ok) return { ok: false, error: r.error };
    coverImageUrl = r.value!;
  }

  let ctaButton: WelcomeMessageFlex['ctaButton'] = null;
  if (obj.ctaButton !== null && obj.ctaButton !== undefined) {
    const btn = obj.ctaButton as Record<string, unknown>;
    // 兩者皆有才算啟用 CTA；只填一個視為未設
    if (btn.label !== undefined && btn.url !== undefined && btn.url !== '') {
      const labelR = _validateLangText(btn.label, MAX_LABEL_LEN, `messages[${idx}].ctaButton.label`);
      if (!labelR.ok) return { ok: false, error: labelR.error };
      const urlR = _validateHttpsUrl(btn.url, `messages[${idx}].ctaButton.url`);
      if (!urlR.ok) return { ok: false, error: urlR.error };
      ctaButton = { label: labelR.value!, url: urlR.value! };
    }
  }

  return {
    ok: true,
    value: {
      id: obj.id,
      type: 'flex',
      enabled,
      title: titleR.value!,
      body: bodyR.value!,
      coverImageUrl,
      ctaButton,
    },
  };
};

export const validateWelcomeSequence = (input: unknown): ValidationResult<WelcomeSequence> => {
  if (!input || typeof input !== 'object') return { ok: false, error: 'body 缺失' };
  const obj = input as Record<string, unknown>;

  const enabled = _isBool(obj.enabled) ? obj.enabled : true;

  if (!Array.isArray(obj.messages)) {
    return { ok: false, error: 'messages 必須為陣列' };
  }
  if (obj.messages.length > MAX_MESSAGES) {
    return { ok: false, error: `messages 最多 ${MAX_MESSAGES} 則` };
  }

  const validated: WelcomeMessage[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < obj.messages.length; i++) {
    const r = _validateMessage(obj.messages[i], i);
    if (!r.ok) return { ok: false, error: r.error };
    if (seenIds.has(r.value!.id)) {
      return { ok: false, error: `messages[${i}].id 重複：${r.value!.id}` };
    }
    seenIds.add(r.value!.id);
    validated.push(r.value!);
  }

  return { ok: true, value: { enabled, messages: validated } };
};

// ── Migration：舊 doc（single text）→ 新 sequence ───────────
interface LegacyDoc {
  text?: string;
  enabled?: boolean;
}

const _hasNewSchema = (d: Record<string, unknown>): boolean => Array.isArray(d.messages);

const _singleTextSequence = (text: string, enabled: boolean): WelcomeSequence => ({
  enabled,
  messages: [
    {
      id: 'msg-legacy',
      type: 'text',
      enabled: true,
      content: { zh_tw: text, en: text, ja: text },
    },
  ],
});

export const migrateBotReplyDoc = (
  doc: Record<string, unknown> | null | undefined,
  fallbackText: string,
): WelcomeSequence => {
  if (!doc) return _singleTextSequence(fallbackText, true);

  if (_hasNewSchema(doc)) {
    const r = validateWelcomeSequence(doc);
    if (r.ok && r.value) return r.value;
    console.warn('[welcome-sequence] doc has messages but invalid:', r.error);
    return _singleTextSequence(fallbackText, doc.enabled !== false);
  }

  const legacy = doc as LegacyDoc;
  const text = (typeof legacy.text === 'string' && legacy.text.length > 0) ? legacy.text : fallbackText;
  return _singleTextSequence(text, legacy.enabled !== false);
};

// ── LINE Message builders（push 前依 user lang 解 + 篩 enabled）─

const _pickLang = (t: LangText, lang: SupportedLang): string => {
  return t[lang] || t.zh_tw || t.en || t.ja || '';
};

export const buildWelcomeTextMessage = (
  msg: WelcomeMessageText,
  lang: SupportedLang,
): LineMessage | null => {
  const text = _pickLang(msg.content, lang);
  if (!text) return null;
  return { type: 'text', text };
};

export const buildWelcomeFlexBubble = (
  msg: WelcomeMessageFlex,
  lang: SupportedLang,
): LineMessage | null => {
  const title = _pickLang(msg.title, lang);
  const body = _pickLang(msg.body, lang);
  if (!title && !body && !msg.coverImageUrl) return null;

  const altText = (title || body || 'Welcome').slice(0, MAX_ALT_TEXT);

  const bodyContents: Array<Record<string, unknown>> = [];
  if (title) bodyContents.push({ type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true, color: '#222222' });
  if (body)  bodyContents.push({ type: 'text', text: body, wrap: true, size: 'sm', color: '#666666', margin: 'md' });

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
    },
  };

  if (msg.coverImageUrl && msg.coverImageUrl.startsWith('https://')) {
    bubble.hero = {
      type: 'image',
      url: msg.coverImageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  if (msg.ctaButton) {
    const label = _pickLang(msg.ctaButton.label, lang);
    if (label && msg.ctaButton.url) {
      bubble.footer = {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: label.slice(0, MAX_LABEL_LEN), uri: msg.ctaButton.url },
          style: 'primary',
          color: FLEX_AMBER,
        }],
      };
    }
  }

  return { type: 'flex', altText, contents: bubble };
};

/**
 * 解 sequence 成 LINE message array，依 user lang 篩內容、skip enabled=false。
 * - sequence.enabled === false → 回空陣列（webhook handler 不 push）
 * - 過濾 enabled=false 的 messages
 * - 任一則 build 不出（無內容）也 skip
 * - 上限 MAX_MESSAGES（防呆，schema validator 已擋）
 */
export const buildWelcomeMessages = (
  seq: WelcomeSequence,
  lang: SupportedLang,
): LineMessage[] => {
  if (!seq.enabled) return [];
  const out: LineMessage[] = [];
  for (const m of seq.messages) {
    if (!m.enabled) continue;
    const built = m.type === 'text' ? buildWelcomeTextMessage(m, lang) : buildWelcomeFlexBubble(m, lang);
    if (built) out.push(built);
  }
  return out.slice(0, MAX_MESSAGES);
};
