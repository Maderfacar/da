import { describe, it, expect } from 'vitest';
import {
  DA_THEME_TOKEN_KEYS,
  DEFAULT_SITE_THEMES,
  isHexColor,
  isSafeThemeImageUrl,
  resolveTheme,
  buildThemeCss,
  getDefaultTheme,
  type SiteTheme,
} from './site-theme';

describe('isHexColor', () => {
  it('接受 3 碼與 6 碼 hex', () => {
    expect(isHexColor('#fff')).toBe(true);
    expect(isHexColor('#F5C842')).toBe(true);
    expect(isHexColor('#abcabc')).toBe(true);
  });

  it('拒絕非 hex / rgba / 缺 # / 非字串', () => {
    expect(isHexColor('rgba(0,0,0,0.1)')).toBe(false);
    expect(isHexColor('F5C842')).toBe(false);
    expect(isHexColor('#12')).toBe(false);
    expect(isHexColor('#1234')).toBe(false);
    expect(isHexColor(123)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

describe('isSafeThemeImageUrl', () => {
  it('接受站內 /themes 影像與 https 影像', () => {
    expect(isSafeThemeImageUrl('/themes/christmas/hero.webp')).toBe(true);
    expect(isSafeThemeImageUrl('https://cdn.example.com/a/hero.jpg')).toBe(true);
  });

  it('接受 Firebase Storage 公開 URL 與 signed URL（副檔名後帶查詢字串）', () => {
    // 公開 URL（無 query）
    expect(
      isSafeThemeImageUrl('https://storage.googleapis.com/da.appspot.com/site-themes/uid/hero-123.webp'),
    ).toBe(true);
    // signed URL（副檔名後接 X-Goog-* 查詢字串）
    expect(
      isSafeThemeImageUrl(
        'https://storage.googleapis.com/da.appspot.com/site-themes/uid/hero-123.webp?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=deadbeef01',
      ),
    ).toBe(true);
  });

  it('拒絕含引號/括號/分號等注入字元與非影像', () => {
    expect(isSafeThemeImageUrl('/themes/x.webp");}body{display:none')).toBe(false);
    // https 帶查詢字串仍須阻擋注入字元（括號 / 引號 / 分號）
    expect(isSafeThemeImageUrl('https://evil.com/a.webp?x=1");}html{background:red')).toBe(false);
    expect(isSafeThemeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeThemeImageUrl('/themes/x.svg')).toBe(false);
    expect(isSafeThemeImageUrl('https://evil.com/a.svg')).toBe(false);
    expect(isSafeThemeImageUrl('http://insecure.com/a.png')).toBe(false);
    expect(isSafeThemeImageUrl(undefined)).toBe(false);
  });
});

describe('DEFAULT_SITE_THEMES', () => {
  it('恰有一筆 isDefault，且 id 為 default', () => {
    const defaults = DEFAULT_SITE_THEMES.filter((t) => t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe('default');
  });

  it('default 主題涵蓋全部白名單 token', () => {
    const def = getDefaultTheme(DEFAULT_SITE_THEMES);
    for (const key of DA_THEME_TOKEN_KEYS) {
      expect(isHexColor(def.tokens[key])).toBe(true);
    }
  });

  it('每套主題所有 token 覆寫值皆為合法 hex', () => {
    for (const theme of DEFAULT_SITE_THEMES) {
      for (const [, value] of Object.entries(theme.tokens)) {
        expect(isHexColor(value)).toBe(true);
      }
    }
  });

  it('主題 id 不重複', () => {
    const ids = DEFAULT_SITE_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolveTheme', () => {
  it('default 疊 active：未覆寫的 key 取 default 值', () => {
    const resolved = resolveTheme(DEFAULT_SITE_THEMES, 'christmas');
    // christmas 未覆寫 da-dark-mid → 取 default
    expect(resolved.tokens['da-dark-mid']).toBe('#2E2B25');
    // christmas 有覆寫 da-amber
    expect(resolved.tokens['da-amber']).toBe('#C1121F');
    expect(resolved.activeThemeId).toBe('christmas');
  });

  it('tokens 補齊為完整 record（每個白名單 key 都有值）', () => {
    const resolved = resolveTheme(DEFAULT_SITE_THEMES, 'summer');
    for (const key of DA_THEME_TOKEN_KEYS) {
      expect(isHexColor(resolved.tokens[key])).toBe(true);
    }
  });

  it('active 不存在 → fallback default', () => {
    const resolved = resolveTheme(DEFAULT_SITE_THEMES, 'no-such-theme');
    expect(resolved.activeThemeId).toBe('default');
    expect(resolved.tokens['da-amber']).toBe('#D4860A');
  });

  it('active 存在但 enabled=false → fallback default', () => {
    const themes: SiteTheme[] = DEFAULT_SITE_THEMES.map((t) =>
      t.id === 'christmas' ? { ...t, enabled: false } : t,
    );
    const resolved = resolveTheme(themes, 'christmas');
    expect(resolved.activeThemeId).toBe('default');
  });

  it('非法 hex 覆寫值被忽略，回退底層', () => {
    const themes: SiteTheme[] = [
      DEFAULT_SITE_THEMES[0]!,
      {
        id: 'broken',
        name: { zh: '壞', en: 'broken', ja: '壊' },
        tokens: { 'da-amber': 'rgba(1,2,3,0.4)' as string },
        hero: {},
        enabled: true,
        sortOrder: 9,
        isDefault: false,
      },
    ];
    const resolved = resolveTheme(themes, 'broken');
    expect(resolved.tokens['da-amber']).toBe('#D4860A'); // 回退 default
  });

  it('hero 缺項回退對應 token', () => {
    const themes: SiteTheme[] = [
      DEFAULT_SITE_THEMES[0]!,
      {
        id: 'noHero',
        name: { zh: 'x', en: 'x', ja: 'x' },
        tokens: { 'da-amber': '#111111', 'da-stripe-yellow': '#222222', 'da-stripe-dark': '#333333' },
        hero: {},
        enabled: true,
        sortOrder: 9,
        isDefault: false,
      },
    ];
    const resolved = resolveTheme(themes, 'noHero');
    expect(resolved.hero.tagColor).toBe('#111111');
    expect(resolved.hero.stripeYellow).toBe('#222222');
    expect(resolved.hero.stripeDark).toBe('#333333');
    expect(resolved.hero.bgImage).toBeUndefined();
  });

  it('不安全 bgImage 被剔除', () => {
    const themes: SiteTheme[] = [
      DEFAULT_SITE_THEMES[0]!,
      {
        id: 'badImg',
        name: { zh: 'x', en: 'x', ja: 'x' },
        tokens: {},
        hero: { bgImage: '/themes/x.webp");}html{}' },
        enabled: true,
        sortOrder: 9,
        isDefault: false,
      },
    ];
    const resolved = resolveTheme(themes, 'badImg');
    expect(resolved.hero.bgImage).toBeUndefined();
  });
});

describe('buildThemeCss', () => {
  it('選擇器為 [data-da-theme]，非 :root', () => {
    const css = buildThemeCss(resolveTheme(DEFAULT_SITE_THEMES, 'default'));
    expect(css.startsWith('[data-da-theme]{')).toBe(true);
    expect(css).not.toContain(':root');
  });

  it('輸出全部 --da-* token 與 --da-hero-* 變數', () => {
    const css = buildThemeCss(resolveTheme(DEFAULT_SITE_THEMES, 'christmas'));
    for (const key of DA_THEME_TOKEN_KEYS) {
      expect(css).toContain(`--${key}:`);
    }
    expect(css).toContain('--da-hero-stripe-yellow:');
    expect(css).toContain('--da-hero-stripe-dark:');
    expect(css).toContain('--da-hero-tag:');
  });

  it('無 bgImage 時不輸出 --da-hero-bg', () => {
    const css = buildThemeCss(resolveTheme(DEFAULT_SITE_THEMES, 'default'));
    expect(css).not.toContain('--da-hero-bg');
  });

  it('有安全 bgImage 時輸出 url()', () => {
    const themes: SiteTheme[] = [
      DEFAULT_SITE_THEMES[0]!,
      {
        id: 'withImg',
        name: { zh: 'x', en: 'x', ja: 'x' },
        tokens: {},
        hero: { bgImage: '/themes/christmas/hero.webp' },
        enabled: true,
        sortOrder: 9,
        isDefault: false,
      },
    ];
    const css = buildThemeCss(resolveTheme(themes, 'withImg'));
    expect(css).toContain('--da-hero-bg:url("/themes/christmas/hero.webp")');
  });
});
