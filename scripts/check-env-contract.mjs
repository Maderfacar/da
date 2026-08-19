// 設定契約 build gate — 設定寫錯的上不了線（config-contract-gate Phase B）
//
// 在 Nuxt 編譯「之前」執行（編譯完才發現設定錯就失去意義）。三種硬擋：
//   1. 核心必要設定缺失（缺了站台本來就是壞的，硬擋不可能擋掉一個正常的部署）
//   2. 已設定的值格式不符契約
//   3. destr 靜態掃描：純數字設定被直接讀取而未經 configStr() 包裹
//
// 非核心設定缺失只警告不擋 —— .env.dev 只有 23 個 key、不是 prod 的可靠鏡像，
// 把無法查證的項目設成硬擋會擋掉本來正常的部署（見 openspec design.md）。
//
// 輸出只印設定名稱與問題種類，**永不印值**。
//
// 用法：
//   node scripts/check-env-contract.mjs          （build 前自動執行）
//   node scripts/check-env-contract.mjs --json   （輸出 JSON，供其他工具消費）
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ENV_CONTRACTS,
  DESTR_HAZARD_CONTRACTS,
  validateEnvValues,
  configKeyOf,
  summarizeIssues,
} from '../shared/env-contract.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCAN_DIRS = ['server', 'app'];
const SCAN_EXTS = ['.ts', '.vue', '.mjs'];
/** 談論這些 key 而非讀取它們的檔案（契約本身與本腳本）。 */
const SCAN_EXEMPT = ['shared/env-contract.mjs', 'scripts/check-env-contract.mjs'];

const jsonMode = process.argv.includes('--json');

/** 解析 .env 檔為 key/value（僅供本機使用；不印任何值）。 */
function parseEnvFile(path) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('\'') && v.endsWith('\'')) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

/**
 * 環境值來源：
 *   - Vercel / CI：只用 process.env（真實部署環境）
 *   - 本機：合併 .env.dev（`pnpm dev` 用的同一份）；不存在則跳過驗證，不擋新 clone 的 build
 */
function resolveEnv() {
  if (process.env.VERCEL || process.env.CI) {
    return { env: process.env, source: 'process.env（Vercel / CI）', skip: false };
  }
  const devPath = join(ROOT, '.env.dev');
  if (!existsSync(devPath)) {
    return { env: process.env, source: '無 .env.dev', skip: true };
  }
  return { env: { ...process.env, ...parseEnvFile(devPath) }, source: '.env.dev（本機）', skip: false };
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (SCAN_EXTS.some((ext) => name.endsWith(ext))) acc.push(full);
  }
  return acc;
}

/**
 * destr 靜態掃描：純數字設定凡直接讀取而未經 configStr() 包裹 → 硬擋。
 *
 * build 期的 process.env 永遠是字串，看不出 destr 之後會變成什麼，所以型別檢查在這裡無效。
 * 真正要防的是「純數字設定被當字串比對」，那是程式碼層次的事 —— 只能靜態掃描。
 *
 * 行級啟發式（本專案風格中設定讀取都在同一行）。誤判的後果是 build 紅 + 明確訊息，
 * 把讀取包成 configStr() 即可解除 —— 誤判方向是安全的。
 */
function scanDestrHazards() {
  const keys = DESTR_HAZARD_CONTRACTS.map((c) => ({ contract: c, key: configKeyOf(c.path) }));
  /** @type {{ file: string, line: number, key: string, env: string, snippet: string }[]} */
  const violations = [];

  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (SCAN_EXEMPT.includes(rel)) continue;

      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        // 略過純註解行（討論這些 key 不等於讀取）
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

        for (const { contract, key } of keys) {
          const read = new RegExp(`\\b(?:config|runtimeConfig)\\s*\\.\\s*(?:public\\s*\\.\\s*)?${key}\\b`);
          if (!read.test(line)) continue;
          if (line.includes('configStr(')) continue; // 已正規化
          violations.push({
            file: rel,
            line: i + 1,
            key,
            env: contract.env,
            snippet: trimmed.slice(0, 120),
          });
        }
      });
    }
  }
  return violations;
}

function main() {
  const { env, source, skip } = resolveEnv();

  if (skip) {
    if (!jsonMode) {
      console.log('[env-contract] 找不到 .env.dev，跳過設定值驗證（新 clone 可正常 build）。');
      console.log('[env-contract] 靜態掃描仍會執行。');
    }
  }

  const issues = skip ? [] : validateEnvValues(env);
  const violations = scanDestrHazards();
  const { error, warn } = summarizeIssues(issues);
  const failed = error > 0 || violations.length > 0;

  if (jsonMode) {
    console.log(JSON.stringify({ ok: !failed, source, skipped: skip, issues, violations }, null, 2));
    process.exit(failed ? 1 : 0);
  }

  console.log(`[env-contract] 契約 ${ENV_CONTRACTS.length} 項｜來源 ${source}`);

  for (const i of issues) {
    const tag = i.level === 'error' ? '✖ 錯誤' : '⚠ 警告';
    const kind = i.problem === 'missing' ? '未設定' : '格式不符';
    console.log(`  ${tag} ${i.env}（${kind}）— ${i.detail}`);
  }

  for (const v of violations) {
    console.log(`  ✖ 錯誤 ${v.file}:${v.line} 直接讀取 ${v.key} 未經 configStr()`);
    console.log(`        ${v.snippet}`);
    console.log(`        ${v.env} 是純數字設定，Nitro 注入時會被 destr 轉成 number；`);
    console.log('        直接與外部 API 回傳的字串比對必然不相等（2026-08-19 事故）。');
  }

  if (failed) {
    console.log('');
    console.log(`[env-contract] ✖ 未通過：${error} 項設定錯誤、${violations.length} 處未正規化讀取。`);
    console.log('[env-contract] 設定寫錯的不上線 —— 修正後再部署。');
    process.exit(1);
  }

  console.log(`[env-contract] ✔ 通過${warn > 0 ? `（${warn} 項警告，不擋部署）` : ''}`);
}

main();
