/**
 * html-sanitize wrapper 測試（W2-redo）
 *
 * 6 大類共 22 tests：
 *   1. XSS attack（script / on* / javascript: / data:text/html）
 *   2. data:image/* 圖片白名單保留
 *   3. forbidden tags（iframe / style / object / embed / form / input / textarea / button）
 *   4. <a> 強制補 rel="noopener noreferrer" + target="_blank"
 *   5. 合法 TinyEditor 輸出保留（CJK / h2 / strong / em / ul li / mailto / inline style）
 *   6. edge cases（空 / null / undefined / 非字串 / 純文字）
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './html-sanitize';

describe('sanitizeHtml — XSS attack', () => {
  it('1. <script> 完整移除', () => {
    const dirty = '<p>hello</p><script>alert(1)</script><p>world</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert');
    expect(clean).toContain('hello');
    expect(clean).toContain('world');
  });

  it('2. on* event handler 移除', () => {
    const dirty = '<p onclick="alert(1)" onmouseover="evil()">hi</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/onmouseover/i);
    expect(clean).toContain('hi');
  });

  it('3. javascript: scheme 在 href 被移除', () => {
    const dirty = '<a href="javascript:alert(1)">click</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/javascript:/i);
  });

  it('4. data:text/html 被擋（不在 img 白名單）', () => {
    const dirty = '<a href="data:text/html,<script>alert(1)</script>">x</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/data:text\/html/i);
  });

  it('5. <img onerror> 事件被剝除', () => {
    const dirty = '<img src="https://example.com/a.png" onerror="alert(1)">';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).toContain('https://example.com/a.png');
  });

  it('6. style 內 javascript: / expression() 被擋', () => {
    const dirty = '<p style="background:url(javascript:alert(1))">x</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/javascript/i);
    expect(clean).not.toMatch(/url\(/i);
  });
});

describe('sanitizeHtml — data:image whitelist', () => {
  it('7. data:image/png base64 圖片保留', () => {
    const dirty = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('8. data:image/jpeg base64 圖片保留', () => {
    const dirty = '<img src="data:image/jpeg;base64,/9j/4AAQSkZJ" alt="">';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('data:image/jpeg');
  });

  it('9. data:application/javascript 偽裝成 img 被擋', () => {
    const dirty = '<img src="data:application/javascript,alert(1)" alt="">';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/data:application/i);
  });
});

describe('sanitizeHtml — forbidden tags', () => {
  it('10. <iframe> 整段丟棄', () => {
    const dirty = '<p>before</p><iframe src="https://evil.com"></iframe><p>after</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<iframe');
    expect(clean).toContain('before');
    expect(clean).toContain('after');
  });

  it('11. <style> 丟棄', () => {
    const dirty = '<style>body{display:none}</style><p>ok</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<style');
    expect(clean).toContain('ok');
  });

  it('12. <object> / <embed> 丟棄', () => {
    const dirty = '<object data="x.swf"></object><embed src="y.swf">';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<object');
    expect(clean).not.toContain('<embed');
  });

  it('13. <form> / <input> / <button> 丟棄', () => {
    const dirty = '<form><input name="x"><button>go</button></form>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<input');
    expect(clean).not.toContain('<button');
  });
});

describe('sanitizeHtml — <a> rel + target 強制', () => {
  it('14. 一般 a 補 rel="noopener noreferrer" + target="_blank"', () => {
    const dirty = '<a href="https://example.com">go</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toMatch(/rel="noopener noreferrer"/);
    expect(clean).toMatch(/target="_blank"/);
    expect(clean).toContain('href="https://example.com"');
  });

  it('15. 原 target="_self" 被強制覆寫為 _blank', () => {
    const dirty = '<a href="https://example.com" target="_self">go</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toMatch(/target="_blank"/);
    expect(clean).not.toMatch(/target="_self"/);
  });

  it('16. 原 rel 被強制覆寫為 noopener noreferrer', () => {
    const dirty = '<a href="https://example.com" rel="dofollow">go</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toMatch(/rel="noopener noreferrer"/);
    expect(clean).not.toMatch(/rel="dofollow"/);
  });
});

describe('sanitizeHtml — 合法 TinyEditor 輸出保留', () => {
  it('17. CJK 中文 + h2 + strong + em 保留', () => {
    const dirty = '<h2>條款</h2><p><strong>重要</strong>：請<em>仔細</em>閱讀</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('條款');
    expect(clean).toContain('<h2>');
    expect(clean).toContain('<strong>重要</strong>');
    expect(clean).toContain('<em>仔細</em>');
  });

  it('18. ul / li 列表保留', () => {
    const dirty = '<ul><li>一</li><li>二</li><li>三</li></ul>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('<ul>');
    expect(clean).toContain('<li>一</li>');
    expect(clean).toContain('<li>二</li>');
  });

  it('19. mailto: 連結保留（並補 rel + target）', () => {
    const dirty = '<a href="mailto:contact@example.com">寄信</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('href="mailto:contact@example.com"');
    expect(clean).toMatch(/target="_blank"/);
  });

  it('20. inline style（color / font-size / text-align）保留', () => {
    const dirty = '<p style="color: #333; font-size: 16px; text-align: center;">置中</p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toMatch(/color/i);
    expect(clean).toMatch(/font-size/i);
    expect(clean).toMatch(/text-align/i);
    expect(clean).toContain('置中');
  });
});

describe('sanitizeHtml — edge cases', () => {
  it('21. 空字串 / null / undefined / 非字串 一律回傳空字串', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml(123 as unknown)).toBe('');
    expect(sanitizeHtml({ html: '<p>x</p>' } as unknown)).toBe('');
  });

  it('22. 純文字（無 tag）原樣保留', () => {
    const clean = sanitizeHtml('純文字內容沒有任何標籤');
    expect(clean).toBe('純文字內容沒有任何標籤');
  });
});
