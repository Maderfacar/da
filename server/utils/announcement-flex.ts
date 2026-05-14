/**
 * 公告 LINE Flex Message builder（P37 Phase 4）
 *
 * 對應 design.md §3 規格（L1 rich content）：
 *   - bubble（hero image optional / body title + text excerpt / footer button optional）
 *   - altText = title（最多 400 字）
 *   - body excerpt：strip HTML tag + 限 200 字
 *
 * coverImageUrl 限制：必須 HTTPS、LINE 可訪問（Firebase Storage signed URL ok）。
 */
import type { LineMessage } from '@@/utils/line-push';

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

  const bodyContents: object[] = [
    { type: 'text', text: ann.title, weight: 'bold', size: 'lg', wrap: true, color: '#222222' },
  ];
  if (excerpt) {
    bodyContents.push({
      type: 'text',
      text: excerpt,
      wrap: true,
      size: 'sm',
      color: '#666666',
      margin: 'md',
    });
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
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
