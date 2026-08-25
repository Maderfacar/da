// 設計 token 單一真相來源守衛（W0b）
//
// 為什麼需要這支：
//   W0b 一口氣把 1,080 行內嵌 font-family 與 124 行本地 $font-* 宣告收斂成四個字族 token，
//   又刪掉了 scss-tool/colors.scss 那 9 個樣板遺留色變數。這種「一次收乾淨」的成果
//   沒有守衛的話，之後任何一次 copy-paste 舊元件就會悄悄長回來 ——
//   而且不會有紅燈，只會在半年後變成「又有兩個真相來源」。
//
//   色票那邊已有 site-theme-sync.spec.ts 守四處同步；這支守的是另一半：
//   「字族與色彩只能從 token 進來，不能就地宣告」。
//
// 檢查範圍是 app/ 下的 .vue / .scss / .css。刻意不含 .ts ——
// TinyMCE 的 content_style 渲染在自己的 iframe，拿不到 :root 的 --ff-*，
// 只能寫字面系統堆疊，那是已記錄的例外（見 important-audit.md）。
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** token 的定義處本身，理所當然可以寫字面值 */
const TOKEN_SOURCES = new Set([
  'app/assets/styles/css-class/_design-tokens.css',
  'app/assets/styles/scss-tool/tokens.scss',
]);

interface SourceFile { rel: string; text: string }

function collect(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.nuxt' && entry !== '.output') collect(abs, out);
      continue;
    }
    if (!/\.(vue|scss|css)$/.test(entry)) continue;
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (TOKEN_SOURCES.has(rel)) continue;
    out.push({ rel, text: readFileSync(abs, 'utf8') });
  }
  return out;
}

const FILES = collect(join(ROOT, 'app'));
const NUXT_CONFIG = readFileSync(join(ROOT, 'nuxt.config.ts'), 'utf8');

/** `font-family: X;` / `--el-font-family: X;`，回傳 [檔案:行, 值] */
function fontFamilyDeclarations(): Array<[string, string]> {
  const hits: Array<[string, string]> = [];
  for (const { rel, text } of FILES) {
    text.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/((?:--el-)?font-family)\s*:\s*([^;]+);/g)) {
        hits.push([`${rel}:${i + 1}`, m[2]!.trim()]);
      }
    });
  }
  return hits;
}

describe('設計 token 單一真相來源', () => {
  it('字族只能從 --ff-* token 取，不得內嵌字體名稱', () => {
    // inherit 是「跟隨父層」的語意，不是指定字體，放行。
    const offenders = fontFamilyDeclarations()
      .filter(([, value]) => value !== 'inherit' && !value.startsWith('var(--ff-'))
      .map(([where, value]) => `${where} → ${value}`);

    expect(offenders, `這些地方直接寫了字體堆疊，請改用 var(--ff-display|ui|label|data|mono)：\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('不得在元件內自行宣告 $font-* SCSS 變數', () => {
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      text.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*\$font-[a-z]+\s*:\s*[^;]+;/.test(line)) offenders.push(`${rel}:${i + 1} → ${line.trim()}`);
      });
    }
    expect(offenders, `本地 $font-* 宣告是舊的第二真相來源，請改用 tokens.scss 的 $ff-*：\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('已下架字族（Bebas Neue / Barlow / Barlow Condensed）零引用', () => {
    // 只看實際會生效的地方：font-family 宣告值，以及 nuxt.config 的 fonts.families 條目。
    // 說明「為什麼移除」的註解不算引用，否則等於逼後人刪掉決策紀錄。
    const dead = /Bebas Neue|Barlow Condensed|Barlow/;

    const inCss = fontFamilyDeclarations()
      .filter(([, value]) => dead.test(value))
      .map(([where, value]) => `${where} → ${value}`);
    expect(inCss, `font-family 仍指向已下架字族：\n${inCss.join('\n')}`).toEqual([]);

    const inConfig = [...NUXT_CONFIG.matchAll(/\{\s*name:\s*'([^']+)'[^}]*provider:\s*'bunny'[^}]*\}/g)]
      .map((m) => m[1]!)
      .filter((name) => dead.test(name));
    expect(inConfig, `nuxt.config.ts 的 fonts.families 仍列著已下架字族：${inConfig.join(', ')}`).toEqual([]);
  });

  it('tokens.scss 只做轉指，不得自帶字面值', () => {
    const scss = readFileSync(join(ROOT, 'app/assets/styles/scss-tool/tokens.scss'), 'utf8');
    const offenders = scss.split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /^\s*\$[\w-]+\s*:/.test(line))
      .filter(([, line]) => !/:\s*var\(--[\w-]+\)\s*;/.test(line))
      .map(([n, line]) => `tokens.scss:${n} → ${line.trim()}`);

    expect(offenders, `SCSS 別名層的值必須是 var(--x) 形式：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('樣板遺留色變數已收斂，不得復活', () => {
    // 這 9 個是專案樣板帶進來的（--primary 是藍色、--bg 是舊米白），與品牌無關，
    // W0b 已全數接到語意 token。復活它們就是把第二真相來源請回來。
    const legacy = ['demo', 'primary', 'secondary', 'tertiary', 'gray', 'err', 'font', 'bg', 'white'];
    const useRe = new RegExp(`var\\(\\s*--(${legacy.join('|')})\\s*[,)]`);

    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      // 同檔自己宣告過的不算 —— 例如 inapp-browser-block.vue 在
      // `.SystemInappBrowserBlock` 上自帶一組區域變數（含 --gray）。那是刻意獨立於
      // 設計系統的全屏阻擋畫面，解析得到、也該維持獨立。這裡要抓的是「指向已刪除的全域變數」。
      const selfDeclared = new Set(
        [...text.matchAll(/^\s*--([\w-]+)\s*:/gm)].map((m) => m[1]!),
      );
      text.split(/\r?\n/).forEach((line, i) => {
        const m = line.match(useRe);
        if (m && !selfDeclared.has(m[1]!)) offenders.push(`${rel}:${i + 1} → ${line.trim()}`);
      });
    }
    expect(offenders, `樣板遺留色變數已刪除，這些引用會解析失敗：\n${offenders.join('\n')}`).toEqual([]);
  });
});
