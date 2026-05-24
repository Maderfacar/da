/**
 * HTML sanitize wrapper（W2-redo）
 *
 * 用途：admin 端 TinyEditor 富文本入庫前統一過濾，擋 XSS。
 * 套件：sanitize-html（純 JS，serverless 友善；不依賴 jsdom / canvas / sharp）。
 *
 * Caller：
 *   - server/utils/announcement.ts:sanitizeBody（delegate）
 *   - server/routes/nuxt-api/admin/legal-pages/[key].put.ts
 *
 * 安全策略：
 *   - 允許 TinyEditor 常見 tag（含 table / code block / blockquote）
 *   - 移除 script / style / iframe / object / embed / form / input / textarea / button
 *   - 移除 on* 事件 + javascript: URI（sanitize-html 預設行為 + allowedSchemes 強制）
 *   - 允許 href: http(s) / mailto / tel；img src: http(s) / data:image/*（data: 限圖片）
 *   - <a> 透過 transformTags 強制補 rel="noopener noreferrer" + target="_blank"
 *     → admin 寫入的 link 一律新分頁，避免劫持當前頁
 *   - style attribute 走 allowedStyles 白名單 property + 寬鬆 value regex（擋 url()/expression()）
 */
import sanitize from 'sanitize-html';
import type { IOptions } from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'em', 'u', 's', 'b', 'i',
  'a', 'img',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
];

const SAFE_LENGTH = /^[\d.]+(px|em|rem|%|pt)?$/i;
const SAFE_SPACED_LENGTH = /^[\d.\s]+(px|em|rem|%|pt)?$/i;

const SANITIZE_OPTIONS: IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    '*': ['class', 'style', 'title'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan', 'width', 'height'],
    th: ['colspan', 'rowspan', 'width', 'height'],
    table: ['width', 'height'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  disallowedTagsMode: 'discard',
  allowedStyles: {
    '*': {
      color: [/^[^"'()<>]+$/],
      'background-color': [/^[^"'()<>]+$/],
      'text-align': [/^(left|right|center|justify)$/i],
      'text-decoration': [/^(underline|line-through|none)$/i],
      'font-weight': [/^(bold|normal|\d+)$/i],
      'font-style': [/^(italic|normal|oblique)$/i],
      'font-size': [SAFE_LENGTH],
      'font-family': [/^[^"'()<>]+$/],
      'line-height': [SAFE_LENGTH],
      width: [SAFE_LENGTH],
      height: [SAFE_LENGTH],
      padding: [SAFE_SPACED_LENGTH],
      'padding-left': [SAFE_LENGTH],
      'padding-right': [SAFE_LENGTH],
      'padding-top': [SAFE_LENGTH],
      'padding-bottom': [SAFE_LENGTH],
      margin: [SAFE_SPACED_LENGTH],
      'margin-left': [SAFE_LENGTH],
      'margin-right': [SAFE_LENGTH],
      'margin-top': [SAFE_LENGTH],
      'margin-bottom': [SAFE_LENGTH],
    },
  },
  transformTags: {
    /**
     * <a> 強制覆寫 rel + target：
     * admin 端寫入的外部連結一律新分頁開啟，並補 noopener/noreferrer
     * 防止劫持當前頁（reverse tabnabbing）。
     */
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: {
        ...attribs,
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    }),
    /**
     * <img> 進一步限制 data: URI 只允許 data:image/*
     * sanitize-html 的 allowedSchemesByTag 只能控制 scheme 名（"data"）
     * 無法區分 data:image/png vs data:text/html — 在此補一層 mime 檢查。
     */
    img: (tagName, attribs) => {
      const src = typeof attribs.src === 'string' ? attribs.src : '';
      if (src.startsWith('data:') && !/^data:image\//i.test(src)) {
        const { src: _drop, ...rest } = attribs;
        return { tagName: 'img', attribs: rest };
      }
      return { tagName: 'img', attribs };
    },
  },
};

/**
 * Sanitize 富文本 HTML，回傳安全可入庫的字串。
 *
 * 對 null / undefined / 非字串 / 空字串一律回傳 ''（防呆）。
 */
export function sanitizeHtml(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return sanitize(input, SANITIZE_OPTIONS);
}
