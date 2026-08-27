// 一次性 migration：site_themes 色票換裝為精品調（W0a — 2026-08-25）
//
// 為什麼需要這支：
//   改 _theme-colors.css 只影響 admin / driver（那兩端吃 :root 預設）。
//   乘客端（front-desk / marketing）掛 [data-da-theme]，色值來自 Firestore
//   site_themes/{id}.tokens 經 resolveTheme() 注入 —— prod 那份是 2026-07-30
//   seed 的舊色。不跑這支，乘客端會被舊色蓋回去，而 admin/driver 正常變色，
//   給出「看起來成功」的假訊號。
//
// 冪等：只覆寫 tokens 與 hero 的色值欄位，不動 name / enabled / sortOrder /
//       isDefault / hero.bgImage（後台上傳的主圖必須保留）。
//
// 用法（專案根目錄）：
//   node scripts/migrate-site-themes.mjs --dry   # 只列出前後對照，不寫入
//   node scripts/migrate-site-themes.mjs         # 實際寫入
//
// service account 取自 .env.dev 的 NUXT_FIREBASE_SERVICE_ACCOUNT_JSON（= prod 專案）。

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY = process.argv.includes('--dry');
const COLLECTION = 'site_themes';

function loadServiceAccount() {
  const raw = readFileSync(new URL('../.env.dev', import.meta.url), 'utf8');
  const line = raw.split(/\r?\n/).find((l) => /^\s*NUXT_FIREBASE_SERVICE_ACCOUNT_JSON\s*=/.test(l));
  if (!line) throw new Error('NUXT_FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.dev');
  let val = line.replace(/^\s*NUXT_FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*/, '').trim();
  if ((val.startsWith('\'') && val.endsWith('\'')) || (val.startsWith('"') && val.endsWith('"'))) {
    val = val.slice(1, -1);
  }
  return JSON.parse(val);
}

// ── 目標色票 ────────────────────────────────────────────────────────────────
// 必須與 shared/site-theme.ts 的 DEFAULT_TOKENS / DEFAULT_TOKENS_DARK / DEFAULT_SITE_THEMES 逐字一致。
// 兩邊不同步 = 下次 seed 或 fallback 時色值會漂回去。

const TARGET = {
  default: {
    tokens: {
      'da-cream': '#EAE7E0',          // 骨白 · 頁面底
      'da-off-white': '#F5F3EE',      // 瓷白 · 卡片表面
      'da-amber': '#7E6330',          // 古銅 · 主色（淺底上 5.07:1，過 AA）
      'da-amber-light': '#C9A961',    // 亮銅 · 深底上使用
      'da-amber-pale': '#F0E8D6',
      'da-dark': '#1A1917',           // 縞黑（對骨白 14.0:1）
      'da-dark-mid': '#26241F',
      'da-gray': '#6D6A62',           // 次要文字（4.88:1，過 AA）
      'da-gray-light': '#868073',     // 三級文字（3.54:1）—— 舊值 #B8B3AC 僅 1.96:1，順手修正
      'da-gray-pale': '#D6D1C7',      // 髮絲線
      'da-stripe-yellow': '#B79A5E',  // 斜紋退場前的過渡值：暗金取代亮黃
      'da-stripe-dark': '#26241F',
    },
    tokensDark: {
      'da-cream': '#121110',
      'da-off-white': '#1C1A18',
      'da-amber': '#C9A961',          // 亮銅（對 #121110 8.38:1）
      'da-amber-light': '#DCC188',
      'da-amber-pale': '#2B2519',
      'da-dark': '#EDEAE3',           // ⚠ 深色模式下主文字反轉為淺色
      'da-dark-mid': '#C6C1B7',
      'da-gray': '#A29D93',
      'da-gray-light': '#7E7A71',
      'da-gray-pale': '#34312C',
      'da-stripe-yellow': '#6E5C36',
      'da-stripe-dark': '#171613',
    },
    hero: { stripeYellow: '#B79A5E', stripeDark: '#26241F', tagColor: '#7E6330' },
  },

  // 節日包：舊值是配著米白 #F5F2EC + 琥珀 #D4860A 定的，換骨白底後會失衡，
  // 一併重定。原則同精品調 —— 低彩度、深文字色、金屬色省著用。
  christmas: {
    tokens: {
      'da-amber': '#7A2B2B',          // 深酒紅（對瓷白 8.4:1）
      'da-amber-light': '#B5553F',
      'da-amber-pale': '#F3E3DE',
      'da-cream': '#E9E6DF',
      'da-off-white': '#F5F2ED',
      'da-stripe-yellow': '#2E4F3C',  // 深常綠
      'da-stripe-dark': '#6E2020',
    },
    tokensDark: {
      'da-amber': '#D2705C',          // 暖磚紅（5.56:1）
      'da-amber-light': '#E8A08E',
      'da-amber-pale': '#2C1A17',
      'da-cream': '#141110',
      'da-off-white': '#1E1917',
      'da-stripe-yellow': '#4C7A62',
      'da-stripe-dark': '#3A1614',
    },
    hero: { stripeYellow: '#2E4F3C', stripeDark: '#6E2020', tagColor: '#7A2B2B' },
  },
  'lunar-new-year': {
    tokens: {
      'da-amber': '#8C2B2B',
      'da-amber-light': '#C9A961',    // 金
      'da-amber-pale': '#F5E9DC',
      'da-cream': '#EDE6DE',
      'da-off-white': '#F7F2EC',
      'da-stripe-yellow': '#B08D4A',
      'da-stripe-dark': '#7A1F1F',
    },
    tokensDark: {
      'da-amber': '#D4685F',          // 5.35:1
      'da-amber-light': '#E0BE7C',    // 金
      'da-amber-pale': '#2C1614',
      'da-cream': '#141010',
      'da-off-white': '#1F1817',
      'da-stripe-yellow': '#B08D4A',
      'da-stripe-dark': '#3A1414',
    },
    hero: { stripeYellow: '#B08D4A', stripeDark: '#7A1F1F', tagColor: '#8C2B2B' },
  },
  summer: {
    tokens: {
      'da-amber': '#2F6156',          // 深松綠（對瓷白 6.4:1）
      'da-amber-light': '#5E9C8C',
      'da-amber-pale': '#E2EEEA',
      'da-cream': '#E7ECEA',
      'da-off-white': '#F3F7F5',
      'da-dark': '#17201D',
      'da-stripe-yellow': '#3E7F70',
      'da-stripe-dark': '#1E3A34',
    },
    tokensDark: {
      'da-amber': '#5FAE9B',          // 7.08:1
      'da-amber-light': '#8CCBBB',
      'da-amber-pale': '#132320',
      'da-cream': '#101413',
      'da-off-white': '#18201E',
      'da-dark': '#E6EDEA',
      'da-stripe-yellow': '#3E7F70',
      'da-stripe-dark': '#16302B',
    },
    hero: { stripeYellow: '#3E7F70', stripeDark: '#1E3A34', tagColor: '#2F6156' },
  },
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 出手前先自檢：任何非法 hex 都會被 resolveTheme() 靜默忽略，不如在這裡就擋下。 */
function assertPaletteValid() {
  const bad = [];
  for (const [id, spec] of Object.entries(TARGET)) {
    for (const [k, v] of Object.entries(spec.tokens)) {
      if (!HEX_RE.test(v)) bad.push(`${id}.tokens.${k} = ${v}`);
    }
    for (const [k, v] of Object.entries(spec.tokensDark ?? {})) {
      if (!HEX_RE.test(v)) bad.push(`${id}.tokensDark.${k} = ${v}`);
    }
    for (const [k, v] of Object.entries(spec.hero)) {
      if (!HEX_RE.test(v)) bad.push(`${id}.hero.${k} = ${v}`);
    }
  }
  if (bad.length) {
    throw new Error(`色值格式非法，中止：\n  ${bad.join('\n  ')}`);
  }
}

async function main() {
  assertPaletteValid();

  const db = getFirestore(initializeApp({ credential: cert(loadServiceAccount()) }));

  console.log(DRY ? '── DRY RUN（不寫入）──\n' : '── 實際寫入 ──\n');

  let changed = 0;
  let missing = 0;

  for (const [id, spec] of Object.entries(TARGET)) {
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      console.log(`[skip] ${id} — doc 不存在（seed 尚未跑過？）`);
      missing += 1;
      continue;
    }

    const before = snap.data() ?? {};
    const beforeTokens = before.tokens ?? {};
    const beforeHero = before.hero ?? {};

    console.log(`[${id}]`);
    for (const [k, next] of Object.entries(spec.tokens)) {
      const prev = beforeTokens[k];
      if (prev !== next) console.log(`   tokens.${k.padEnd(18)} ${String(prev ?? '(未設)').padEnd(9)} → ${next}`);
    }
    const beforeTokensDark = before.tokensDark ?? {};
    for (const [k, next] of Object.entries(spec.tokensDark ?? {})) {
      const prev = beforeTokensDark[k];
      if (prev !== next) console.log(`   tokensDark.${k.padEnd(14)} ${String(prev ?? '(未設)').padEnd(9)} → ${next}`);
    }
    for (const [k, next] of Object.entries(spec.hero)) {
      const prev = beforeHero[k];
      if (prev !== next) console.log(`   hero.${k.padEnd(20)} ${String(prev ?? '(未設)').padEnd(9)} → ${next}`);
    }

    // hero.bgImage 是後台上傳的主圖，必須原樣保留
    const nextHero = { ...beforeHero, ...spec.hero };
    const nextTokens = { ...beforeTokens, ...spec.tokens };
    const nextTokensDark = { ...beforeTokensDark, ...(spec.tokensDark ?? {}) };

    if (!DRY) {
      await ref.update({ tokens: nextTokens, tokensDark: nextTokensDark, hero: nextHero });
      console.log('   ✔ 已寫入');
    }
    console.log('');
    changed += 1;
  }

  console.log(`完成：${changed} 筆${DRY ? '（未寫入）' : '已更新'}${missing ? `，${missing} 筆不存在` : ''}`);
  if (!DRY) {
    console.log('\n下一步：curl prod GET /nuxt-api/config/theme 確認 tokens 與 _theme-colors.css 一致');
    console.log('（該端點有短 TTL 快取，可能需等數十秒或重新部署才反映）');
  }
}

main().catch((err) => {
  console.error('migration 失敗：', err);
  process.exit(1);
});
