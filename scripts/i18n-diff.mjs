// i18n locale key alignment scanner — temporary tool, not committed
// 比對 zh / en / ja 三個 locale 的 key 結構，輸出差異
import zh from '../i18n/locales/zh.js';
import en from '../i18n/locales/en.js';
import ja from '../i18n/locales/ja.js';

function flatKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatKeys(v, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

const zhKeys = new Set(flatKeys(zh));
const enKeys = new Set(flatKeys(en));
const jaKeys = new Set(flatKeys(ja));

const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
const missingInJa = [...zhKeys].filter((k) => !jaKeys.has(k));
const extraInEn = [...enKeys].filter((k) => !zhKeys.has(k));
const extraInJa = [...jaKeys].filter((k) => !zhKeys.has(k));

console.log('=== i18n locale key alignment ===');
console.log(`zh total keys: ${zhKeys.size}`);
console.log(`en total keys: ${enKeys.size}`);
console.log(`ja total keys: ${jaKeys.size}`);
console.log('');

console.log(`[missing in en.js] (zh has, en lacks): ${missingInEn.length}`);
missingInEn.forEach((k) => console.log(`  - ${k}`));
console.log('');

console.log(`[missing in ja.js] (zh has, ja lacks): ${missingInJa.length}`);
missingInJa.forEach((k) => console.log(`  - ${k}`));
console.log('');

console.log(`[extra in en.js] (en has, zh lacks): ${extraInEn.length}`);
extraInEn.forEach((k) => console.log(`  + ${k}`));
console.log('');

console.log(`[extra in ja.js] (ja has, zh lacks): ${extraInJa.length}`);
extraInJa.forEach((k) => console.log(`  + ${k}`));
console.log('');

if (missingInEn.length === 0 && missingInJa.length === 0 && extraInEn.length === 0 && extraInJa.length === 0) {
  console.log('✓ 三語 key 結構完全對齊');
} else {
  console.log('⚠️ 三語 key 結構有差異，請補齊');
  process.exit(1);
}
