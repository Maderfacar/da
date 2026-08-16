// 讀取 prod client_error_logs 診斷工具（唯讀）
//
// 為什麼需要這支：三端框架層（error-handler.client.ts / error-log.ts）會把
// client 未捕捉例外、middleware 導向決策、server OAuth 登入成敗全部寫進
// Firestore 的 client_error_logs，但專案沒有任何查閱介面（admin 端的 Diagnostics
// 頁看的是 line_event_logs / line_api_errors，不是這個 collection）。
// 排查「使用者說某某情境會壞」時，這份 log 通常是唯一的一手證據。
//
// 唯讀保證：本檔只呼叫 .get()，不含任何 set / update / delete / batch。
//
// 用法（專案根目錄）：
//   node scripts/diagnose-client-error-logs.mjs
//   node scripts/diagnose-client-error-logs.mjs --limit 100
//   node scripts/diagnose-client-error-logs.mjs --event middleware.redirect
//   node scripts/diagnose-client-error-logs.mjs --end driver --severity error
//
// service account 取自 .env.dev 的 NUXT_FIREBASE_SERVICE_ACCOUNT_JSON（= prod 專案）。

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const COLLECTION = 'client_error_logs';
const DEFAULT_LIMIT = 60;

function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

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

const toIso = (v) => v?.toDate?.()?.toISOString?.() ?? (typeof v === 'string' ? v : '');

async function main() {
  const limit = Number(argValue('limit') ?? DEFAULT_LIMIT);
  const eventPrefix = argValue('event');
  const endFilter = argValue('end');
  const severityFilter = argValue('severity');

  initializeApp({ credential: cert(loadServiceAccount()) });
  const db = getFirestore();

  // ⚠️ 排序欄位是 timestamp（見 server/routes/nuxt-api/_log/client-error.post.ts）。
  // Firestore 對「不存在的 orderBy 欄位」回空集合，寫錯欄位名會靜默得到 0 筆。
  // 取回較多筆再於本地過濾：event 是前綴比對，Firestore 無法直接查。
  const fetchLimit = eventPrefix || endFilter || severityFilter ? Math.max(limit * 6, 300) : limit;
  const snap = await db.collection(COLLECTION).orderBy('timestamp', 'desc').limit(fetchLimit).get();

  const rows = [];
  snap.forEach((doc) => {
    const v = doc.data();
    const ctx = v.context ?? {};
    if (eventPrefix && !String(v.event ?? '').startsWith(eventPrefix)) return;
    if (endFilter && ctx.end !== endFilter) return;
    if (severityFilter && v.severity !== severityFilter) return;
    rows.push({ id: doc.id, ...v, ctx });
  });

  const shown = rows.slice(0, limit);
  console.log(`collection=${COLLECTION} 掃描 ${snap.size} 筆，符合 ${rows.length} 筆，顯示 ${shown.length} 筆\n`);

  for (const v of shown) {
    const c = v.ctx;
    console.log(
      [
        toIso(v.timestamp),
        v.severity ?? '-',
        v.category ?? '-',
        v.event ?? '-',
        `end=${c.end ?? '-'}`,
        `path=${c.path ?? '-'}`,
      ].join(' | ')
    );
    console.log(
      `    who : uid=${c.lineUserId ?? '-'} roles=[${(c.roles ?? []).join(',')}] liff=${c.isInLiffClient ?? '-'} prev=${c.prevPath ?? '-'} v=${c.appVersion ?? '-'}`
    );
    if (v.message) console.log(`    msg : ${String(v.message).slice(0, 300)}`);
    if (v.metadata) console.log(`    meta: ${JSON.stringify(v.metadata).slice(0, 500)}`);
    if (v.stack) console.log(`    at  : ${String(v.stack).split('\n').slice(0, 3).join(' / ').slice(0, 400)}`);
    console.log('');
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[diagnose-client-error-logs] failed:', err);
    process.exit(1);
  }
);
