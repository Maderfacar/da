/**
 * html-sanitize.spec.ts — W2 資安測試
 *
 * 覆蓋：
 *   - <script> 整段移除
 *   - on* event handler 移除
 *   - href="javascript:" 移除
 *   - data: URL 移除（圖片 base64 例外保留）
 *   - <style> tag 移除（但 style 屬性保留）
 *   - <iframe> / <object> / <embed> 移除
 *   - <a> 自動補 rel="noopener noreferrer" + target="_blank"
 *   - 一般合法 HTML 保留
 *   - 空輸入 / 非字串輸入回空字串
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './html-sanitize';

describe('sanitizeHtml', () => {
  describe('XSS — script', () => {
    it('移除 <script> 標籤', () => {
      const out = sanitizeHtml('<p>hello</p><script>alert(1)</script>');
      expect(out).not.toContain('<script');
      expect(out).not.toContain('alert');
      expect(out).toContain('<p>hello</p>');
    });

    it('移除 <script src="..."></script>', () => {
      const out = sanitizeHtml('<script src="https://evil.com/x.js"></script>');
      expect(out).not.toContain('script');
      expect(out).not.toContain('evil.com');
    });
  });

  describe('XSS — event handler', () => {
    it('移除 onerror', () => {
      const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
      expect(out).not.toContain('onerror');
      expect(out).not.toContain('alert');
    });

    it('移除 onclick', () => {
      const out = sanitizeHtml('<a href="https://x.com" onclick="alert(1)">x</a>');
      expect(out).not.toContain('onclick');
      expect(out).not.toContain('alert');
    });

    it('移除 onload / onmouseover / onfocus', () => {
      const out = sanitizeHtml('<div onload="x()" onmouseover="y()" onfocus="z()">x</div>');
      expect(out).not.toMatch(/on(?:load|mouseover|focus)/i);
    });
  });

  describe('XSS — javascript: URI', () => {
    it('移除 href="javascript:..."', () => {
      const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
      expect(out).not.toContain('javascript:');
      expect(out).not.toContain('alert');
    });

    it('移除大小寫混合 JavaScript:', () => {
      const out = sanitizeHtml('<a href="JaVaScRiPt:alert(1)">click</a>');
      expect(out).not.toMatch(/javascript:/i);
    });
  });

  describe('XSS — data: URI', () => {
    it('移除 href="data:text/html,..."', () => {
      const out = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
      expect(out).not.toContain('data:text/html');
    });

    it('保留合法 <img src="data:image/png;base64,...">（內嵌圖片白名單例外）', () => {
      const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      const out = sanitizeHtml(`<img src="data:image/png;base64,${tinyPng}">`);
      expect(out).toContain('data:image/png;base64');
    });

    it('移除 <img src="data:text/html,..."（非圖片 mime）', () => {
      const out = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">');
      expect(out).not.toContain('data:text/html');
    });
  });

  describe('Forbidden tags', () => {
    it('移除 <iframe>', () => {
      const out = sanitizeHtml('<iframe src="https://evil.com"></iframe>');
      expect(out).not.toContain('iframe');
      expect(out).not.toContain('evil.com');
    });

    it('移除 <style>...</style>（避免注入 CSS expression / @import）', () => {
      const out = sanitizeHtml('<style>body{background:url("javascript:alert(1)")}</style><p>x</p>');
      expect(out).not.toContain('<style');
      expect(out).not.toContain('javascript:');
      expect(out).toContain('<p>x</p>');
    });

    it('移除 <object> / <embed> / <form>', () => {
      const out = sanitizeHtml('<object data="x"></object><embed src="x"><form action="x"></form>');
      expect(out).not.toContain('object');
      expect(out).not.toContain('embed');
      expect(out).not.toContain('form');
    });
  });

  describe('<a> 補 rel / target', () => {
    it('合法 https href 自動補 rel="noopener noreferrer" + target="_blank"', () => {
      const out = sanitizeHtml('<a href="https://example.com">x</a>');
      expect(out).toContain('rel="noopener noreferrer"');
      expect(out).toContain('target="_blank"');
      expect(out).toContain('href="https://example.com"');
    });

    it('一律強制 target="_blank"（安全策略：避免 admin link 劫持當前頁）', () => {
      // DOMPurify 內建會清除 target，hook 收不到原值；同時這也是我們的安全選擇：
      // admin 編輯的 link 統一新分頁，避免使用者誤點被導離本站。
      const out = sanitizeHtml('<a href="https://x.com" target="_self">x</a>');
      expect(out).toContain('target="_blank"');
      expect(out).toContain('rel="noopener noreferrer"');
    });
  });

  describe('合法內容保留', () => {
    it('保留 TinyEditor 常見輸出（標題 / 段落 / 列表 / 連結 / 粗斜體）', () => {
      const html = '<h2>標題</h2><p>段落 <strong>粗</strong> <em>斜</em></p><ul><li>項目</li></ul><a href="https://x.com">連結</a>';
      const out = sanitizeHtml(html);
      expect(out).toContain('<h2>標題</h2>');
      expect(out).toContain('<strong>粗</strong>');
      expect(out).toContain('<em>斜</em>');
      expect(out).toContain('<li>項目</li>');
      expect(out).toContain('href="https://x.com"');
    });

    it('保留 mailto: 連結', () => {
      const out = sanitizeHtml('<a href="mailto:foo@bar.com">mail</a>');
      expect(out).toContain('href="mailto:foo@bar.com"');
    });

    it('保留 inline style 屬性', () => {
      const out = sanitizeHtml('<p style="color:red">x</p>');
      expect(out).toContain('style="color:red"');
    });

    it('保留 img https src + alt', () => {
      const out = sanitizeHtml('<img src="https://cdn.example.com/x.png" alt="img">');
      expect(out).toContain('src="https://cdn.example.com/x.png"');
      expect(out).toContain('alt="img"');
    });
  });

  describe('Edge cases', () => {
    it('空字串回空字串', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('null / undefined / 非字串回空字串', () => {
      expect(sanitizeHtml(null)).toBe('');
      expect(sanitizeHtml(undefined)).toBe('');
      expect(sanitizeHtml(123)).toBe('');
      expect(sanitizeHtml({})).toBe('');
    });

    it('純文字無 tag 直接回原文', () => {
      expect(sanitizeHtml('hello world')).toBe('hello world');
    });
  });
});
