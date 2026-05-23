/**
 * 公告 LINE Flex Message builder（P37 Phase 4 → P40 Phase 3：Q3=3b 混合策略）
 *
 * 對應 design.md §3 規格（L1 rich content）：
 *   - bubble（hero image optional / body title + text excerpt / footer button optional）
 *   - altText = title（最多 400 字）
 *   - body excerpt：strip HTML tag + 限 200 字
 *
 * P40 Phase 3 改：對 buildTemplateFlex 共用，避免兩處各自維護 bubble layout。
 * 外部行為（caller signature / multicast 流程 / Flex 結構）完全不變。
 *
 * coverImageUrl 限制：必須 HTTPS、LINE 可訪問（Firebase Storage signed URL ok）。
 */
import type { LineMessage } from '@@/utils/line-push';
import { buildTemplateFlex, type TemplateContentFlex } from '@@/utils/template-registry';

interface AnnouncementForFlex {
  title: string;
  body: string;
  coverImageUrl: string | null;
  ctaButton: { label: string; url: string } | null;
}

const MAX_ALT_TEXT = 400;
const BODY_EXCERPT_MAX = 200;

const _stripTags = (html: string): string => html
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

export function buildAnnouncementFlex(ann: AnnouncementForFlex): LineMessage {
  const altText = ann.title.slice(0, MAX_ALT_TEXT);
  const excerpt = _stripTags(ann.body).slice(0, BODY_EXCERPT_MAX);

  // P40 Phase 3：excerpt 非空時走共用 builder；確保 Flex 結構與通用 template 一致
  if (excerpt) {
    const ctaButton = ann.ctaButton
      && typeof ann.ctaButton.label === 'string'
      && ann.ctaButton.label.length > 0
      && typeof ann.ctaButton.url === 'string'
      && ann.ctaButton.url.startsWith('https://')
      ? { label: ann.ctaButton.label, action: { type: 'uri' as const, url: ann.ctaButton.url } }
      : null;

    const content: TemplateContentFlex = {
      title: ann.title,
      body: excerpt,
      coverImageUrl: ann.coverImageUrl,
      ctaButton,
    };
    const flex = buildTemplateFlex(content, {});
    if (flex) return flex;
  }

  // Fallback：excerpt 為空（公告 body 純 HTML tag、無實質內容）→ 保留 P37 單 title bubble 行為
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: ann.title, weight: 'bold', size: 'lg', wrap: true, color: '#222222' },
      ],
    },
  };

  if (ann.coverImageUrl && ann.coverImageUrl.startsWith('https://')) {
    bubble.hero = {
      type: 'image',
      url: ann.coverImageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  if (ann.ctaButton && ann.ctaButton.label && ann.ctaButton.url.startsWith('https://')) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        action: {
          type: 'uri',
          label: ann.ctaButton.label.slice(0, 20),
          uri: ann.ctaButton.url,
        },
        style: 'primary',
        color: '#D4860A',
      }],
    };
  }

  return {
    type: 'flex',
    altText,
    contents: bubble,
  };
}
