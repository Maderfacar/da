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
  'app/assets/styles/css-class/_theme-colors.css',
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

// ── 階段 1（色彩收尾）新增的守衛 ─────────────────────────────────────────────
//
// 階段 0 的五條守衛掃 `--da-*` 與 `$font-*`，因此漏掉了三整類第二真相來源：
//   1. 自由命名的本地 SCSS 色變數（`$amber: #d4860a` 散在 33 個檔、442 處引用）
//   2. `rgba()` 形式的舊色（`grep '#'` 抓不到 `rgba(212,134,10,.18)`，光舊主色就 202 處）
//   3. Element Plus 的 `$colors` map（樣板藍 #354d7b 在裡面活過整個階段 0）
//
// 下面這幾條補的就是這三類，外加兩條「靜默失效」的陷阱。

/** 舊色票（階段 0 之前的美式復古琥珀）—— [名稱, hex, rgb] */
const RETIRED_PALETTE: Array<[string, string, [number, number, number]]> = [
  ['舊琥珀 --da-amber', '#d4860a', [212, 134, 10]],
  ['舊縞黑 --da-dark', '#1a1814', [26, 24, 20]],
  ['舊瓷白 --da-off-white', '#faf8f4', [250, 248, 244]],
  ['舊骨白 --da-cream', '#f5f2ec', [245, 242, 236]],
  ['舊次要灰 --da-gray', '#6b6560', [107, 101, 96]],
  ['舊三級灰 --da-gray-light', '#b8b3ac', [184, 179, 172]],
  ['舊琥珀深階', '#b8730a', [184, 115, 10]],
  ['舊琥珀亮階', '#f7b96a', [247, 185, 106]],
];

/** 把 CSS 註解與 // 行註解換成等長空白 —— 保留行號，但不讓「說明用的色碼」被誤判 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

function hslOf(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === R) h = ((G - B) / d) % 6;
    else if (mx === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/** 讀 token 定義檔，回傳 token 名 → 字面色碼（只取直接寫色碼的那些） */
function tokenLiterals(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ['app/assets/styles/css-class/_design-tokens.css', 'app/assets/styles/css-class/_theme-colors.css']) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    for (const m of src.matchAll(/^\s*--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/gm)) {
      if (!(m[1]! in out)) out[m[1]!] = m[2]!.toLowerCase();
    }
  }
  return out;
}

describe('色彩收尾守衛（階段 1）', () => {
  it('舊色票不得復活 —— hex 與 rgba() 兩種寫法都算', () => {
    // 只查 hex 抓不到 rgba(212,134,10,.18)。階段 0 的「537 處硬編色」就是這樣低估的：
    // 光舊主色的 rgba 形式就有 202 處，比它的 hex 形式（56 處）還多三倍。
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      stripComments(text).split(/\r?\n/).forEach((line, i) => {
        for (const [name, hex, rgb] of RETIRED_PALETTE) {
          const rgbRe = new RegExp('rgba?\\(\\s*' + rgb[0] + '\\s*,\\s*' + rgb[1] + '\\s*,\\s*' + rgb[2] + '\\s*[,)]');
          if (line.toLowerCase().includes(hex) || rgbRe.test(line)) {
            offenders.push(rel + ':' + (i + 1) + '（' + name + '）→ ' + line.trim().slice(0, 90));
          }
        }
      });
    }
    expect(offenders, '這些是換色票前的舊值，會在新底色上渲染成舊琥珀：\n' + offenders.join('\n')).toEqual([]);
  });

  it('不得在元件內自行宣告色彩用的 SCSS 變數', () => {
    // `$amber: #d4860a` 這種。與 $font-* 是同一種病，但名稱是自由的，
    // 所以不能列舉名單，只能看「值是不是色碼」。
    //
    // 兩類放行：
    //   ① 值為 var(--x) 的別名 —— 那是轉指 token，不是第二真相來源
    //   ② **中性**的白／黑疊層（r === g === b），例如 `$border: rgba(255,255,255,.08)`。
    //      它們不帶色相、不隨色票改變，不是「第二套調色盤」。全站約 40 條，
    //      屬「表面疊層 token 化」（--surface-a* / --ink-a*）的範圍，不在色彩收尾階段。
    //      這是刻意放行並記錄，不是忘了處理。
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      stripComments(text).split(/\r?\n/).forEach((line, i) => {
        const decl = line.match(/^\s*\$[\w-]+\s*:\s*(.+?);/);
        if (!decl) return;
        const value = decl[1]!.trim();
        const hex = value.match(/^#([0-9a-fA-F]{6})$/);
        const rgb = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
        if (!hex && !rgb) return;
        const [r, g, b] = hex
          ? [0, 2, 4].map((k) => parseInt(hex[1]!.slice(k, k + 2), 16))
          : [1, 2, 3].map((k) => Number(rgb![k]));
        if (r === g && g === b) return;   // 中性疊層，放行（見上）
        offenders.push(rel + ':' + (i + 1) + ' → ' + line.trim());
      });
    }
    expect(offenders, '本地色變數是第二真相來源，請改用 token 或 tokens.scss 的 $ 別名：\n' + offenders.join('\n')).toEqual([]);
  });

  it('不得把值為 var() 的 SCSS 變數餵進 Sass 色彩函式', () => {
    // 這一條擋的是**靜默失效**：`$danger: var(--stop)` 之後寫 `rgba($danger, .4)`，
    // Sass 不報錯，會原樣輸出 `rgba(var(--stop), .4)` —— 那在 CSS 裡是無效值，
    // 整條宣告直接消失（邊框不見、底色不見），而 build 全綠。
    // 階段 1 實際踩到 15 條，全都靜靜地躺在產物裡不生效。
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      const clean = stripComments(text);
      const varAliases = new Set([...clean.matchAll(/^\s*\$([\w-]+)\s*:\s*var\(/gm)].map((m) => m[1]!));
      if (!varAliases.size) continue;
      clean.split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/(darken|lighten|rgba|saturate|desaturate|mix|transparentize|adjust-color)\(\s*\$([\w-]+)/g)) {
          if (varAliases.has(m[2]!)) offenders.push(rel + ':' + (i + 1) + ' → ' + m[1] + '($' + m[2] + ', …)');
        }
      });
    }
    expect(offenders, '這些會編成 rgba(var(--x), …) 之類的無效 CSS 並靜默失效，請改用疊色階梯 token：\n' + offenders.join('\n')).toEqual([]);
  });

  it('Element Plus 的 $colors map 必須與 token 一致', () => {
    // 這份 map 是全站唯一容許寫色碼的第二處（Sass 需要編譯期常數才能推色階）。
    // 容許它存在的代價，就是必須有人盯著它別漂移 —— 那個人是這條測試。
    const scss = readFileSync(join(ROOT, 'app/assets/styles/scss-tool/element-plus/index.scss'), 'utf8');
    const tokens = tokenLiterals();
    const expected: Array<[string, string]> = [
      ['primary', tokens['da-amber']!],
      ['success', tokens['good']!],
      ['warning', tokens['wait']!],
      ['danger', tokens['stop']!],
      ['error', tokens['stop']!],
      ['info', tokens['da-gray']!],
    ];
    const offenders: string[] = [];
    for (const [key, want] of expected) {
      const m = scss.match(new RegExp('\'' + key + '\':\\s*\\(\\s*\'base\':\\s*(#[0-9a-fA-F]{6})'));
      if (!m) { offenders.push('$colors 找不到 \'' + key + '\''); continue; }
      if (m[1]!.toLowerCase() !== want) offenders.push('\'' + key + '\' = ' + m[1] + '，token 是 ' + want);
    }
    expect(offenders, 'EP 色階由編譯期常數推導，漂移了元件就不在品牌色系裡：\n' + offenders.join('\n')).toEqual([]);
  });

  it('語意別名層必須在每個會覆寫 --da-* 的作用域重新宣告', () => {
    // 階段 0 踩過的坑（design.md D10）：custom property 的計算值是「var() 代入後」的結果，
    // 並被子孫繼承。`--accent: var(--da-amber)` 寫在 :root 就當場定案，
    // 子孫 [data-da-theme] 再覆寫 --da-amber 也追不回來 —— 季節主題會失效。
    // 因此每個覆寫作用域都必須把整層別名重新宣告一次。新增作用域時要同步加進來。
    // ⚠ 必須先剝註解。第一版沒剝，結果選擇器**上方那段說明文字裡**就寫著
    //    「• [data-da-theme] —— 主題引擎注入處」，`includes` 直接命中，
    //    於是把 [data-da-theme] 從真正的選擇器拿掉，這條測試照樣是綠的。
    //    是「先注入違規證明它會紅」這道程序把它抓出來的。
    const css = stripComments(readFileSync(join(ROOT, 'app/assets/styles/css-class/_design-tokens.css'), 'utf8'));
    const required = ['[data-da-theme]', '[data-surface=\'dark\']', '[data-surface=\'light\']'];
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*--accent\s*:[^{}]*)\}/g)].map((m) => m[1]!.trim());
    const missing = required.filter((sel) => !blocks.some((b) => b.includes(sel)));
    expect(missing, '這些作用域會覆寫 --da-*，但沒有重新宣告別名層，換膚／深色面會「切一半」：' + missing.join(', ')).toEqual([]);
  });

  it('元件不得硬編飽和色（狀態色／品牌色）', () => {
    // 只擋「飽和且中等明度」的色：s ≥ 25%、25% ≤ l ≤ 85%。
    // 中性色（白／黑／灰）與深色面暫時放行 —— 它們歸「尺度與表面 token」階段，不在色彩收尾範圍。
    // 例外檔案都附了理由，不是「先加進來讓測試變綠」。
    const ALLOW: Array<[string, string]> = [
      ['app/components/MapRoutePreview.client.vue', 'Google Maps 的 stylers / marker 吃色碼字串，不解析 var()'],
      ['app/pages/admin/war-room/index.vue', '同上，即時戰情地圖的 stylers'],
      ['app/components/admin/TrafficChart.client.vue', 'Chart.js 的資料集色，畫在 canvas 上'],
      ['app/pages/home/index.vue', 'Hero 斜紋的漸層停點，走 --da-hero-*（待玻璃與斜紋退場階段）'],
    ];
    const allowSet = new Set(ALLOW.map(([f]) => f));
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      if (allowSet.has(rel) || rel.includes('scss-tool/element-plus/index.scss')) continue;
      stripComments(text).split(/\r?\n/).forEach((line, i) => {
        const push = (c: string) => offenders.push(rel + ':' + (i + 1) + ' → ' + c + '  ' + line.trim().slice(0, 70));
        for (const m of line.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
          const [r, g, b] = [0, 2, 4].map((k) => parseInt(m[1]!.slice(k, k + 2), 16));
          const [, s, l] = hslOf(r, g, b);
          if (s >= 25 && l >= 25 && l <= 85) push('#' + m[1]);
        }
        for (const m of line.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*[,)]/g)) {
          const [r, g, b] = [1, 2, 3].map((k) => Number(m[k]));
          const [, s, l] = hslOf(r, g, b);
          if (s >= 25 && l >= 25 && l <= 85) push('rgb(' + r + ',' + g + ',' + b + ')');
        }
      });
    }
    expect(offenders, '狀態色請用 --good/--wait/--note/--stop，主色用 --accent，第三方擬真色用 --line-*：\n' + offenders.join('\n')).toEqual([]);
  });
});
