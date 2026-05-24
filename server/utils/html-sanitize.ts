/**
 * HTML Sanitize wrapper（W2 資安）
 *
 * 用途：admin 從 TinyEditor 寫入的富文本（legal-pages.bodyHtml、announcements.body）
 *      在落庫前統一過此 wrapper 過濾，擋 XSS。
 *
 * 政策（allowlist）：
 *   - 允許常見 tag（p / br / strong / em / a / ul / ol / li / h1-h6 / blockquote / img / hr / span / div / code / pre / table 群）
 *   - 允許 attr：href / title / alt / src / class / style / target / rel / width / height / colspan / rowspan
 *   - <a> 預設補 rel="noopener noreferrer"；若未指定 target 補 target="_blank"
 *   - href 只允許 http(s) / mailto；javascript: 一律移除
 *   - img src 允許 https + data:image/（base64 內嵌圖片）；其他 data: URL 移除
 *   - 不允許 on* event handler
 *
 * 設計：
 *   - 統一 export 一個 sanitizeHtml(html) 給 server endpoints 用
 *   - announcement.ts:sanitizeBody 改 delegate 到此（保留原 export 避免 caller 改動）
 *
 * 註：寫入時過 sanitize，讀取時信任（不再過）。前端 v-html 直接 render。
 */
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'em', 'u', 's', 'b', 'i',
  'a', 'img',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
];

const ALLOWED_ATTR = [
  'href', 'title', 'alt', 'src', 'class', 'style',
  'target', 'rel',
  'width', 'height',
  'colspan', 'rowspan',
];

// 允許 http / https / mailto / tel / data:image/
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)/i;

// 預設 sanitize config（不含 hook 變更）
const SANITIZE_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOWED_URI_REGEXP,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'] as string[],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur', 'formaction'] as string[],
};

// 全域 hook：<a> 補 rel；若沒 target 補 _blank（不覆蓋既有）
let hookRegistered = false;
function ensureHook() {
  if (hookRegistered) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer');
      if (!node.hasAttribute('target')) {
        node.setAttribute('target', '_blank');
      }
    }
  });
  hookRegistered = true;
}

/**
 * Sanitize 任意 HTML，回傳安全 HTML 字串。
 *
 * @param html 原始 HTML（可為任何使用者輸入）
 * @returns 過濾後的 HTML；空輸入回空字串
 */
export function sanitizeHtml(html: unknown): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  ensureHook();
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
