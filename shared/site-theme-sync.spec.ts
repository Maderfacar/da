// 色票四處同步守衛
//
// 為什麼需要這支：
//   `--da-*` 的值同時存在於四個地方，任何一處漏改，症狀都是「看起來成功但其實沒有」：
//     1. app/assets/styles/css-class/_theme-colors.css   → admin / driver 吃這份
//     2. shared/site-theme.ts 的 DEFAULT_TOKENS          → 乘客端經主題引擎注入吃這份
//     3. scripts/migrate-site-themes.mjs 的 TARGET       → 寫進 prod Firestore
//     4. tests/e2e/auth/fixtures.ts 的主題 mock          → e2e / 視覺基線吃這份
//
//   最惡劣的組合是「1 改了、2 沒改」：admin 與 driver 正常變色，乘客端被舊色蓋回去 ——
//   而人只要先開 admin 看，就會以為換色成功了。
//
//   W0a 實作時真的踩到：`da-gray-light` 在 1/2/4 已改成 #868073，3 還留著 #A6A198，
//   靠 migration 的 --dry 輸出才發現。這支測試把那次僥倖變成常態防護。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DA_THEME_TOKEN_KEYS, DEFAULT_SITE_THEMES, type DaTokenKey } from './site-theme';

const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

/** 從 CSS 抽 `--da-x: #xxxxxx;` */
function parseCssTokens(css: string): Partial<Record<DaTokenKey, string>> {
  const out: Partial<Record<DaTokenKey, string>> = {};
  for (const key of DA_THEME_TOKEN_KEYS) {
    const m = css.match(new RegExp(`--${key}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\s*;`));
    if (m) out[key] = m[1]!.toUpperCase();
  }
  return out;
}

/** 從 JS/TS 物件字面值抽 `'da-x': '#xxxxxx'`，限定在指定區段內 */
function parseObjTokens(src: string, sectionStart: string, sectionEnd: string): Partial<Record<DaTokenKey, string>> {
  const from = src.indexOf(sectionStart);
  const to = from >= 0 ? src.indexOf(sectionEnd, from) : -1;
  const section = from >= 0 && to > from ? src.slice(from, to) : '';
  const out: Partial<Record<DaTokenKey, string>> = {};
  for (const key of DA_THEME_TOKEN_KEYS) {
    const m = section.match(new RegExp(`'${key}'\\s*:\\s*'(#[0-9a-fA-F]{3,6})'`));
    if (m) out[key] = m[1]!.toUpperCase();
  }
  return out;
}

const SOURCE_OF_TRUTH = Object.fromEntries(
  DA_THEME_TOKEN_KEYS.map((k) => [
    k,
    DEFAULT_SITE_THEMES.find((t) => t.isDefault)!.tokens[k]!.toUpperCase(),
  ]),
) as Record<DaTokenKey, string>;

describe('色票四處同步', () => {
  it('shared/site-theme.ts 的 default 主題涵蓋全部白名單 token', () => {
    for (const key of DA_THEME_TOKEN_KEYS) {
      expect(SOURCE_OF_TRUTH[key], `default 主題缺 ${key}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('_theme-colors.css 與 DEFAULT_TOKENS 一致', () => {
    const css = parseCssTokens(read('../app/assets/styles/css-class/_theme-colors.css'));
    for (const key of DA_THEME_TOKEN_KEYS) {
      expect(css[key], `_theme-colors.css 缺 --${key}`).toBeDefined();
      expect(css[key], `--${key} 與 shared/site-theme.ts 不一致`).toBe(SOURCE_OF_TRUTH[key]);
    }
  });

  it('migrate-site-themes.mjs 的 default TARGET 與 DEFAULT_TOKENS 一致', () => {
    const mjs = parseObjTokens(read('../scripts/migrate-site-themes.mjs'), 'default: {', '  // 節日包');
    for (const key of DA_THEME_TOKEN_KEYS) {
      expect(mjs[key], `migration script 缺 ${key}`).toBeDefined();
      expect(mjs[key], `migration script 的 ${key} 與 shared/site-theme.ts 不一致`).toBe(SOURCE_OF_TRUTH[key]);
    }
  });

  it('e2e fixtures 的主題 mock 與 DEFAULT_TOKENS 一致', () => {
    const fx = parseObjTokens(read('../tests/e2e/auth/fixtures.ts'), '\'/nuxt-api/config/theme\'', 'status:');
    for (const key of DA_THEME_TOKEN_KEYS) {
      expect(fx[key], `fixtures.ts 缺 ${key}`).toBeDefined();
      expect(fx[key], `fixtures.ts 的 ${key} 與 shared/site-theme.ts 不一致`).toBe(SOURCE_OF_TRUTH[key]);
    }
  });

  it('_theme-colors.css 不得復活 :root.dark 死碼', () => {
    const css = read('../app/assets/styles/css-class/_theme-colors.css');
    expect(/^\s*:root\.dark\s*\{/m.test(css), ':root.dark 已於 W0a 移除，要做深色模式請另開變更').toBe(false);
  });
});
