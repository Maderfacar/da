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

  it('CJK 字族的宣告不得擴張 —— bunny 自架不成立，加了也不會生效', () => {
    // 為什麼要守這條：nuxt.config 的 fonts.families 列著 Noto Sans TC，
    // 但產物裡 @font-face 是 0 —— 宣告與現實不一致，而**建置全綠**，
    // 沒有任何訊號會告訴後人「你加的字重沒有生效」。
    //
    // 根因量測（2026-08-28）：bunny 對 noto-sans-tc 回 106 個 @font-face，
    // 只有 4 個帶 unicode-range。少了 unicode-range 就無法分塊載入 CJK。
    // 詳見 nuxt.config.ts 該條目上方的註解。
    //
    // 這條守的是「有人以為補字重就會有中文粗體」——
    // 那會白花建置時間、且讓宣告離現實更遠。
    const entries = [...NUXT_CONFIG.matchAll(/\{\s*name:\s*'([^']+)'[^}]*weights:\s*\[([^\]]*)\][^}]*\}/g)]
      .map((m) => ({ name: m[1]!, weights: m[2]!.replace(/\s/g, '') }));

    const cjk = entries.filter((e) => /(?:^|[ -])(TC|SC|JP|KR|CJK)(?:$|[ -])/.test(e.name));

    expect(
      cjk.map((e) => e.name),
      'fonts.families 只允許既有的 Noto Sans TC 這一個 CJK 條目。'
      + '新增 CJK 字族不會產生 @font-face（bunny 缺 unicode-range），'
      + '要自架中文請走建置期 subset，另開變更。',
    ).toEqual(['Noto Sans TC']);

    expect(
      cjk[0]?.weights,
      '不要為了補中文字重而改 Noto Sans TC 的 weights —— 加上去不會生效，只會多花建置時間。'
      + '站上對中文用 font-weight 600 由瀏覽器合成偽粗體，是已知且接受的現況。',
    ).toBe('300,400,700,900');
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
  ['舊亮黃 --da-stripe-yellow', '#f5c842', [245, 200, 66]],   // 階段 1 的表列過它，名單漏收
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
          // String.raw：單反斜線在此原樣保留，不必寫成 '\s' 這種容易被工具鏈吃掉的雙跳脫
          const rgbRe = new RegExp(String.raw`rgba?\(\s*${rgb[0]}\s*,\s*${rgb[1]}\s*,\s*${rgb[2]}\s*[,)]`);
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
    //   ② —— 原本這裡放行「中性的白／黑疊層」（r === g === b），理由是它們不帶色相。
    //      **階段 2 已關閉**：79 條宣告連同 343 處引用全數改走 --surface-a* / --ink-a*。
    //      當時註解估「全站約 40 條」，實測 79 條；而行內寫法（非變數宣告）另有 884 處。
    //      又一次「只查一種寫法就低估」—— 與階段 1 的 rgba 舊色是同一個教訓。
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
    const required = ['[data-da-theme]', '[data-surface=\'dark\']', '[data-surface=\'light\']', '.dark [data-da-theme]'];
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*--accent\s*:[^{}]*)\}/g)].map((m) => m[1]!.trim());
    const missing = required.filter((sel) => !blocks.some((b) => b.includes(sel)));
    expect(missing, '這些作用域會覆寫 --da-*，但沒有重新宣告別名層，換膚／深色面會「切一半」：' + missing.join(', ')).toEqual([]);
  });

  it('元件不得硬編飽和色（狀態色／品牌色）', () => {
    // 只擋「飽和且中等明度」的色：s ≥ 25%、25% ≤ l ≤ 85%。
    // 中性色（白／黑／灰）與深色面改由階段 2 的「表面色不得硬編」那條專門守，這裡只管有色相的。
    // 例外檔案都附了理由，不是「先加進來讓測試變綠」。
    const ALLOW: Array<[string, string]> = [
      ['app/components/MapRoutePreview.client.vue', 'Google Maps 的 stylers / marker 吃色碼字串，不解析 var()'],
      ['app/pages/admin/war-room/index.vue', '同上，即時戰情地圖的 stylers'],
      ['app/components/admin/TrafficChart.client.vue', 'Chart.js 的資料集色，畫在 canvas 上'],
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

// ── 階段 2（玻璃退場 + 表面 token 化）新增的守衛 ──────────────────────────────
//
// 階段 1 的守衛裡有兩處註解明寫「暫時放行，歸尺度與表面 token 階段」。
// 那兩處已在本階段關閉，下面這幾條是接手它們的常態檢查。
//
// ⚠ 中性色的檢查**只掃 <style> 區塊**。理由：`#fff` 這種字串在 .vue 的 <script>
//    裡是合法的（QRCode 的 light 模組色、canvas ctx.fillStyle、送去 LINE 的 payload），
//    那些地方 CSS 變數到不了，正確做法是走 shared/design-colors.ts 的 JS 鏡像。
//    掃全檔會把那些誤判成違規，最後只能加例外清單 —— 那比縮小掃描範圍糟。

/** .vue 只取 <style> 內容；.scss / .css 取全檔。回傳已剝註解的文字。 */
function styleOf({ rel, text }: SourceFile): string {
  const css = rel.endsWith('.vue')
    ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n')
    : text;
  return stripComments(css);
}

/** 深色面的藍黑家族 —— 階段 2 之前散在 34 處，與縞黑差了近一個補色。
 *  ⚠ hex 與 rgb() 兩種寫法都要列。只列 hex 的話，`rgba(26, 26, 46, .92)` 會漏掉 ——
 *    它在原始碼裡看不出是藍黑，要等 Sass 壓縮成 `#1a1a2eeb` 才現形，
 *    而那時已經在產物裡了。階段 1 的舊色票守衛就是為了同一件事才同時列兩種寫法，
 *    這條第一版只列了 hex，然後就真的漏了三處（war-room 控制列 / 司機端權限遮罩 /
 *    公告彈窗遮罩）—— 是比對 build 產物才抓到的。 */
const RETIRED_BLUE_BLACK: Array<[string, [number, number, number]]> = [
  ['#1a1a2e', [26, 26, 46]],
  ['#161b22', [22, 27, 34]],
  ['#1f2937', [31, 41, 55]],
  ['#0f1115', [15, 17, 21]],
  ['#2d2d4e', [45, 45, 78]],
  ['#0d0f14', [13, 15, 20]],
  ['#373760', [55, 55, 96]],
  ['#0f1623', [15, 22, 35]],
  ['#3a3a5c', [58, 58, 92]],
  ['#1f1f35', [31, 31, 53]],
];

describe('表面與尺度守衛（階段 2）', () => {
  it('玻璃已下架 —— --da-glass-* 零引用', () => {
    // 半透明底 + 古銅邊 + 雙層陰影，配 backdrop-filter，是 glassmorphism 的語彙。
    // 精品調的層級語言是「實心表面 + 髮絲線 + 極淡陰影」，兩者疊在一起會既不通透也不紮實。
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      stripComments(text).split(/\r?\n/).forEach((line, i) => {
        if (line.includes('--da-glass')) offenders.push(`${rel}:${i + 1} → ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders, `玻璃 token 已下架，請改用 --surface-raised / --hairline / --shadow-soft：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('backdrop-filter 零使用', () => {
    // 除了風格不合，它每幀都要重新取樣整個背景並強制建立合成層 ——
    // 站上原本 30 處是 blur(12px)，全在會捲動的卡片上。遮罩改用實色疊層（--ink-a50 之類）。
    const offenders: string[] = [];
    for (const f of FILES) {
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        if (/backdrop-filter/i.test(line)) offenders.push(`${f.rel}:${i + 1} → ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders, `遮罩請用實色疊層，卡片請用實心表面：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('深色面的藍黑家族不得復活 —— hex 與 rgb() 兩種寫法都算', () => {
    // 縞黑 #1A1917 是 hue 40° 的暖黑，這些是 hue 213–240° 的冷藍黑。
    // 兩者並置時暖黑顯得偏紅、藍黑顯得偏冷 —— 那是「admin 跟乘客端不像同一個站」的成因。
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      stripComments(text).split(/\r?\n/).forEach((line, i) => {
        const low = line.toLowerCase();
        for (const [hex, rgb] of RETIRED_BLUE_BLACK) {
          // String.raw：單反斜線在此原樣保留，不必寫成 '\s' 這種容易被工具鏈吃掉的雙跳脫
          const rgbRe = new RegExp(String.raw`rgba?\(\s*${rgb[0]}\s*,\s*${rgb[1]}\s*,\s*${rgb[2]}\s*[,)]`);
          if (low.includes(hex) || rgbRe.test(line)) {
            offenders.push(rel + ':' + (i + 1) + '（' + hex + '）→ ' + line.trim().slice(0, 80));
          }
        }
      });
    }
    expect(offenders, `深色面請用 --surface-deep / -2 / -3（暖黑軸）：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('色碼不得寫成 8 碼 hex（帶 alpha）', () => {
    // 這是本階段第三次撞到同一個病：**同一個顏色有第三種寫法，而守衛只認得前兩種**。
    //   第一次（階段 1）：只查 hex，漏掉 rgba() —— 舊主色 rgb 形式比 hex 多三倍
    //   第二次（本階段）：藍黑守衛只查 hex，漏掉 rgb()，三處要等 Sass 壓成 #1a1a2eeb 才現形
    //   第三次（這一條）：`#00000094` 這種 8 碼形式，前面兩條守衛的 `#[0-9a-f]{6}\b`
    //     與 `rgba?\(` 都抓不到 —— `\b` 在第 7 個字元處不成立，整串直接不匹配
    //
    // 8 碼 hex 沒有任何非用不可的場合（alpha 一律走疊色階梯），所以直接全禁，
    // 不必再判斷它是中性還是飽和 —— 少一個判斷就少一個漏法。
    const offenders: string[] = [];
    for (const f of FILES) {
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/#[0-9a-fA-F]{8}\b/g)) {
          offenders.push(`${f.rel}:${i + 1} → ${m[0]}  ${line.trim().slice(0, 60)}`);
        }
      });
    }
    expect(offenders, `帶 alpha 的顏色請用疊色階梯（--accent-a* / --ink-a* / --surface-a*）：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('元件的 <style> 內不得出現任何字面色碼', () => {
    // 這條是階段 2 收尾時把前面幾條「門檻式」守衛升級成「全禁式」的結果。
    //
    // 為什麼門檻式擋不住：飽和色守衛的條件是 s ≥ 25 且 25 ≤ l ≤ 85，
    // 而 Element Plus 與 Tailwind 的預設灰藍（#dcdfe6 s17 l88、#606266 s3 l39、
    // #909399 s4 l58、#6b7280 s9 l46…）全部落在門檻外。它們被手抄進元件裡
    // ——**131 處**，散在 admin 子頁、2FA 頁、公告彈窗、富文本樣式 ——
    // 而階段 1 只修了 EP 的 $colors map（編譯期常數），看不到手抄的字面值。
    // 那是站上的**第三套調色盤**，只是因為夠灰所以一直沒被當成顏色。
    //
    // 現在全部走 token 了，所以規則可以收成最簡單的一句：<style> 裡不准有色碼。
    // 例外只有兩個，各自附理由 —— 不是「先加進來讓測試變綠」。
    const ALLOW: Array<[string, string]> = [
      ['app/assets/styles/scss-tool/element-plus/index.scss',
       'Sass 需要編譯期常數才能推出 EP 的色階；由「$colors map 必須與 token 一致」那條守衛比對'],
      ['app/composables/system/use-inapp-browser/inapp-browser-block.vue',
       '全屏阻擋畫面，刻意獨立於設計系統（W0b 已記錄）—— 它要在 token 全掛的情況下仍然看得見'],
    ];
    const allow = new Set(ALLOW.map(([f]) => f));
    const offenders: string[] = [];
    for (const f of FILES) {
      if (allow.has(f.rel)) continue;
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          offenders.push(`${f.rel}:${i + 1} → ${m[0]}  ${line.trim().slice(0, 58)}`);
        }
        for (const m of line.matchAll(/rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*[,)]/g)) {
          offenders.push(`${f.rel}:${i + 1} → ${m[0]}  ${line.trim().slice(0, 58)}`);
        }
        // 空格分隔的現代語法 `rgb(0 0 0 / 60%)` —— 本階段的**第七種寫法**。
        // 前面所有 regex 都寫成逗號式，所以它一路穿過六道守衛，
        // 最後在產物裡以 `#0009`（4 碼 hex）現形 —— 又是比對 build 產物才發現的。
        for (const m of line.matchAll(/(?:rgba?|hsla?)\(\s*[\d.]+%?\s+[\d.]+%?\s+[\d.]+%?\s*[/)]/g)) {
          offenders.push(`${f.rel}:${i + 1} → ${m[0]}…  ${line.trim().slice(0, 52)}`);
        }
        // CSS 顏色關鍵字 —— 本階段撞到的**第五種寫法**。
        // `background: white` 不含 # 也不含 rgb(，前面所有掃描與守衛都不認得它，
        // 而 minifier 會把它輸出成 `#fff` —— 所以它只在 build 產物裡現形。實測 36 處。
        //
        // ⚠ 比對的是**值裡的關鍵字 token**，不是「屬性後緊接關鍵字」。
        //    第一版寫成後者，於是漏掉寫在函式裡的
        //    `repeating-conic-gradient(var(--ink-a06) 0% 25%, white 0% 50%)`
        //    —— 同一個病的第六個變化，一樣是比對產物才發現的。
        //    前後的 (?<![\w-]) / (?![\w-]) 用來排掉 `white-space:` 與 `.is-white` 這類。
        for (const m of line.matchAll(/(?<![\w-])(white|black|gray|grey|red|blue|green|silver|orange|yellow|purple|pink|brown|navy|teal|olive|lime|aqua|maroon|fuchsia)(?![\w-])/g)) {
          offenders.push(`${f.rel}:${i + 1} → ${m[1]}  ${line.trim().slice(0, 58)}`);
        }
      });
    }
    expect(offenders, `色彩只能從 token 進來（--ink* / --surface* / --accent* / --good|wait|note|stop*）：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('玻璃 token 的**定義**也不得復活', () => {
    // 上面那條「--da-glass-* 零引用」掃不到 _theme-colors.css ——
    // 它在 TOKEN_SOURCES 裡，被 collect() 跳過了（那是刻意的：token 定義處本來就該寫字面值）。
    // 結果是：用法 88 處全清乾淨、守衛全綠，而三個定義安安靜靜留在產物的 entry.css 裡。
    // 是比對 build 產物才發現的。定義與用法要分開守。
    const css = readFileSync(join(ROOT, 'app/assets/styles/css-class/_theme-colors.css'), 'utf8');
    const hits = [...stripComments(css).matchAll(/^\s*--da-glass-[\w-]+\s*:/gm)].map((m) => m[0].trim());
    expect(hits, '玻璃層已於階段 2 下架，別把定義加回來').toEqual([]);
  });

  it('表面色不得硬編 —— 中性白／黑疊層與純白純黑', () => {
    // 接手階段 1 那條「r === g === b 放行」。實測規模：SCSS 變數宣告 79 條、
    // 行內寫法 884 處（白 rgba 524 · 黑 rgba 151 · #fff 205 · #000 4）。
    // 疊層一律走 --surface-a* / --ink-a*，實色走 --surface-raised / --ink。
    // 註：--surface-a* 的底是瓷白 #F5F3EE 而非純白，這是刻意的（純白在骨白環境裡會跳）。
    const offenders: string[] = [];
    for (const f of FILES) {
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        const push = (what: string) => offenders.push(`${f.rel}:${i + 1} → ${what}  ${line.trim().slice(0, 70)}`);
        for (const m of line.matchAll(/rgba?\(\s*(255|0)\s*,\s*(255|0)\s*,\s*(255|0)\s*[,)]/g)) {
          if (m[1] === m[2] && m[2] === m[3]) push(`rgb(${m[1]},${m[2]},${m[3]})`);
        }
        for (const m of line.matchAll(/#(?:fff|ffffff|000|000000)\b/gi)) push(m[0]);
      });
    }
    expect(offenders, `疊層請用 --surface-a* / --ink-a*，實色請用 --surface-raised / --ink：\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('尺度守衛（階段 2）', () => {
  it('圓角不得寫字面值', () => {
    // 階段 0 定了階梯卻一處都沒替換，於是實況長到 31 種相異值。
    // 放行：0 / 百分比（橢圓角）/ SCSS 變數與 v-bind（動態）/ token。
    const offenders: string[] = [];
    for (const f of FILES) {
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        const m = line.match(/border(?:-[a-z]+)*-radius\s*:\s*([^;{}]+);/);
        if (!m) return;
        const val = m[1]!.replace(/!important/, '').trim();
        if (/var\(|v-bind|calc\(|\$/.test(val)) return;
        for (const t of val.split('/').join(' ').split(/\s+/)) {
          if (t === '0' || t === '0px' || t.endsWith('%')) continue;
          offenders.push(`${f.rel}:${i + 1} → ${t}  ${line.trim().slice(0, 60)}`);
        }
      });
    }
    expect(offenders, `圓角請從 --r-round / --r-pill / --r-xl / --r-lg / --r-md / --r-sm / --r-xs 挑：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('跨元件層級的 z-index 必須走 token', () => {
    // 20 以下刻意放行 —— 那是元件自己 stacking context 內的相對關係（把 ::after 疊到內容上、
    // richmenu 編輯器的四個把手 11/12/13/14）。收進全域 token 會把它們壓成同一層。
    // token 治的是「跨元件」的層級，那些原本長到 9999 / 10000 / 90000。
    const offenders: string[] = [];
    for (const f of FILES) {
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        const m = line.match(/z-index\s*:\s*([^;{}]+);/);
        if (!m) return;
        const val = m[1]!.replace(/!important/, '').trim();
        if (/var\(|calc\(|\$/.test(val)) return;
        const n = Number(val);
        if (Number.isFinite(n) && Math.abs(n) <= 20) return;
        offenders.push(`${f.rel}:${i + 1} → ${val}  ${line.trim().slice(0, 60)}`);
      });
    }
    expect(offenders, `層級請從 --z-sticky / --z-nav / --z-header / --z-overlay / --z-drawer / --z-modal / --z-modal-2 / --z-boot / --z-gate / --z-toast 挑：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('transition 的時長必須走 --dur-*', () => {
    // 實測 14 種時長、245 處 0.15s。緩動同時收成 --ease-out（expo-out）。
    // `linear` 與明確寫出的 cubic-bezier 放行：前者多用在進度／旋轉，後者是刻意挑過的曲線。
    const offenders: string[] = [];
    for (const f of FILES) {
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        const m = line.match(/transition\s*:\s*([^;{}]+);/);
        if (!m) return;
        const val = m[1]!;
        if (/v-bind|\$/.test(val)) return;
        for (const seg of val.split(',')) {
          const lit = seg.match(/(^|\s)(\d*\.?\d+m?s)(?=\s|$)/);
          if (lit) offenders.push(`${f.rel}:${i + 1} → ${lit[2]}  ${line.trim().slice(0, 60)}`);
        }
      });
    }
    expect(offenders, `時長請用 --dur-fast / --dur-base / --dur-slow / --dur-slower：\n${offenders.join('\n')}`).toEqual([]);
  });
});

  /** 排版守衛的共同例外 —— 理由與色彩守衛那份一致，不是「先加進來讓測試變綠」 */
  const TYPE_ALLOW = new Set([
    // 全屏阻擋畫面：刻意獨立於設計系統，它要在 token 全掛的情況下仍然讀得到
    'app/composables/system/use-inapp-browser/inapp-browser-block.vue',
    // rem() mixin 吃的是傳進來的參數，不是字面值
    'app/assets/styles/scss-tool/font-size.scss',
  ]);

describe('排版守衛（階段 2 續）', () => {
  it('字級不得寫 px 字面值', () => {
    // `scss-tool/typography.scss` 早在階段 2 之前就定了階梯，還寫著
    // 「最小字級 12px，不再使用 9 / 10 / 11px」「舊代碼 11px 仍存在 100+ 處，後續以 PR 漸進收斂」。
    // 那個收斂從來沒發生：實測 444 處低於它自訂的最小值，而整套 16 個 token 只被引用 8 次。
    // 跟圓角同一個病 —— 階梯定了，實況沒跟上。本輪把 1,309 處接上去。
    //
    // ⚠ 前面的 (?<![\w-]) 是必要的：沒有它，`$base-font-size: 16px` 這種**變數宣告**
    //    會因為含有 `font-size:` 子字串而被誤判成違規。
    //    替換腳本當年就是漏了同一個邊界，把那個 Sass 編譯期常數換成 var()，直接讓 build 中斷。
    // ⚠ 前面的 (?<![\w-]) 是必要的：沒有它，`$base-font-size: 16px` 這種**變數宣告**
    //    會因為含有 `font-size:` 子字串而被誤判成違規。替換腳本當年漏的就是同一個邊界，
    //    把那個 Sass 編譯期常數換成了 var()，直接讓 build 中斷（Undefined operation）。
    // 放行 clamp()：超大展示字必須隨視窗縮放，固定 token 蓋不住（否則手機爆版）。
    // 放行 em / rem / %：那是相對於父級的比例，不是階梯上的一階。
    const offenders: string[] = [];
    for (const f of FILES) {
      if (TYPE_ALLOW.has(f.rel)) continue;
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        const m = line.match(/(?<![\w-])font-size\s*:\s*([^;{}]+);/);
        if (!m) return;
        const val = m[1]!.replace(/!important/, '').trim();
        if (/var\(|\$|clamp\(|calc\(|v-bind|inherit/.test(val)) return;
        if (/^\d*\.?\d+(em|rem|%)$/.test(val)) return;
        offenders.push(`${f.rel}:${i + 1} → ${val}  ${line.trim().slice(0, 52)}`);
      });
    }
    expect(offenders, `字級請從 --fs-label / -body-sm / -body / -body-lg / -h4 / -h3 / -h2 / -h1 / -display / -hero / -mega 挑：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('行高與字距不得寫字面值', () => {
    // 行高實測 243 處 25 種、字距 623 處 24 種。字距對精品調特別要緊 ——
    // 大字收緊、小字放開、UPPERCASE 放到很開，那是「看起來貴」的一部分，不是裝飾。
    // 行高放行 px（那多半是 Element Plus 的行內覆寫，屬版位不屬排版階梯）。
    const offenders: string[] = [];
    for (const f of FILES) {
      if (TYPE_ALLOW.has(f.rel)) continue;
      styleOf(f).split(/\r?\n/).forEach((line, i) => {
        const lh = line.match(/(?<![\w-])line-height\s*:\s*([^;{}]+);/);
        if (lh) {
          const v = lh[1]!.replace(/!important/, '').trim();
          if (!/var\(|\$|v-bind|calc\(|inherit|normal|px|em|rem|%/.test(v) && /^\d*\.?\d+$/.test(v)) {
            offenders.push(`${f.rel}:${i + 1} → line-height ${v}`);
          }
        }
        const ls = line.match(/(?<![\w-])letter-spacing\s*:\s*([^;{}]+);/);
        if (ls) {
          const v = ls[1]!.replace(/!important/, '').trim();
          if (!/var\(|\$|v-bind|calc\(|inherit|normal/.test(v)) {
            offenders.push(`${f.rel}:${i + 1} → letter-spacing ${v}`);
          }
        }
      });
    }
    expect(offenders, `行高用 --lh-*，字距用 --ls-*：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('typography.scss 只做轉指，不得自帶字面值', () => {
    // 它原本自帶 16 個字面值（$fs-label: 12px …），與 --fs-* 是兩套排版真相來源。
    // 這條跟「tokens.scss 只做轉指」是同一條紀律，只是當年漏了這一份檔案。
    const scss = stripComments(readFileSync(join(ROOT, 'app/assets/styles/scss-tool/typography.scss'), 'utf8'));
    const offenders = [...scss.matchAll(/^\s*\$([\w-]+)\s*:\s*([^;]+);/gm)]
      .filter((m) => !/^var\(/.test(m[2]!.trim()))
      .map((m) => `$${m[1]} = ${m[2]!.trim()}`);
    expect(offenders, `typography.scss 應只做轉指：\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('Sass 與 CSS 變數的邊界（階段 2 續）', () => {
  it('值為 var() 的 SCSS 變數不得餵進 Sass 算術', () => {
    // 既有那條「不得餵進 Sass **色彩函式**」擋的是靜默失效（編出無效 CSS，宣告消失但 build 全綠）。
    // 這一條擋的是相反的失敗：**build 直接中斷**。
    //
    // 實際踩到：字級替換把 `$base-font-size: 16px` 換成了 `var(--fs-body-lg)`，
    // 而 `rem()` 是 `calc($px / $base-font-size) * 1rem` ——
    // Sass 無法對 var() 做算術，報 `Undefined operation "calc(40px / var(--fs-body-lg)) * 1rem"`。
    // （會誤換是因為 regex 寫成 `font-size:`，而 `$base-font-size:` 含有那個子字串。
    //  同一類子字串錯誤本階段犯過兩次，另一次是 `color:` 吃掉 `border-color:`。）
    //
    // 這條紅了的話，選擇是二選一：那個變數留成編譯期字面值，或改用 CSS 的 calc() 在瀏覽器算。
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      if (!/\.(scss|vue)$/.test(rel)) continue;
      const clean = stripComments(text);
      const varAliases = new Set([...clean.matchAll(/^\s*\$([\w-]+)\s*:\s*var\(/gm)].map((m) => m[1]!));
      if (!varAliases.size) continue;
      clean.split(/\r?\n/).forEach((line, i) => {
        for (const name of varAliases) {
          // $x 左右緊鄰算術運算子，或出現在 calc() 裡跟運算子作伴
          const re = new RegExp(String.raw`\$${name}\s*[*/+]|[*/+]\s*\$${name}\b`);
          if (re.test(line)) offenders.push(`${rel}:${i + 1} → $${name}  ${line.trim().slice(0, 60)}`);
        }
      });
    }
    expect(offenders, `Sass 無法對 var() 做算術，build 會直接中斷：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('config.scss 的編譯期常數不得改成 var()', () => {
    // 上一條是通用檢查，但**抓不到本階段實際踩到的那次**：
    // `$base-font-size` 宣告在 config.scss，而算術發生在 fn.scss 的
    // `@function rem($px, $defaultVal: $base-font-size)` —— 跨檔、又走函式預設參數，
    // 通用的「同一行同時出現 $alias 與運算子」看不到。
    //
    // config.scss 裡全部都是給 Sass 在編譯期算的常數（rem 的基準、RWD 斷點）。
    // 它們一旦變成 var()，build 會直接中斷（Undefined operation）。
    // 這條窄但準：與其寫一個看得懂 Sass 語意的檢查，不如直接守住那個檔案的性質。
    const scss = stripComments(readFileSync(join(ROOT, 'app/assets/styles/scss-tool/config.scss'), 'utf8'));
    const offenders = [...scss.matchAll(/^\s*\$([\w-]+)\s*:\s*([^;]+);/gm)]
      .filter((m) => /var\(/.test(m[2]!))
      .map((m) => `$${m[1]} = ${m[2]!.trim()}`);
    expect(offenders, `這些是編譯期常數，改成 var() 會讓 build 中斷：\n${offenders.join('\n')}`).toEqual([]);
  });
});
