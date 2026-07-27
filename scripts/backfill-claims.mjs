// 一次性回填 persistent custom claims（W1 — 認證根治 2026-07-28）
//
// 目的：把每個 users/{lineUid}.roles 寫成 Firebase Auth persistent custom claims { roles }，
//       並 bump claimsUpdatedAt。讓 firestore.rules 對「現有所有舊用戶」立即生效
//       （client 下次 getIdToken(true) 刷新即拿到正確 roles，免重登）。
//
// 冪等：可重複執行；只寫 claims + claimsUpdatedAt，不動任何業務欄位。
//
// 用法（專案根目錄）：
//   node scripts/backfill-claims.mjs --dry      # 只列出將要寫入的內容，不實際寫
//   node scripts/backfill-claims.mjs            # 實際回填
//
// service account 取自 .env.dev 的 NUXT_FIREBASE_SERVICE_ACCOUNT_JSON（= prod 專案）。

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const DRY = process.argv.includes('--dry');

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

function parseRolesLoose(raw) {
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string') arr = raw.replace(/[[\]'"\s]/g, '').split(',');
  return arr.filter((r) => r === 'passenger' || r === 'driver' || r === 'admin');
}

async function main() {
  initializeApp({ credential: cert(loadServiceAccount()) });
  const db = getFirestore();
  const auth = getAuth();

  const snap = await db.collection('users').get();
  console.log(`${DRY ? '[DRY RUN] ' : ''}掃描 users：${snap.size} 筆\n`);

  let synced = 0, skippedNoAuth = 0, failed = 0;
  for (const doc of snap.docs) {
    const lineUid = doc.id;
    const data = doc.data();
    let roles = parseRolesLoose(data.roles);
    if (roles.length === 0 && typeof data.role === 'string') roles = parseRolesLoose([data.role]);
    if (roles.length === 0) roles = ['passenger'];

    if (DRY) {
      console.log(`  [dry] ${lineUid} → roles=${JSON.stringify(roles)}`);
      synced++;
      continue;
    }

    try {
      await auth.setCustomUserClaims(`line:${lineUid}`, { roles });
      await db.collection('users').doc(lineUid).set(
        { claimsUpdatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      synced++;
      if (synced % 50 === 0) console.log(`  ...已回填 ${synced}`);
    } catch (err) {
      const msg = String(err?.errorInfo?.code || err?.message || err);
      if (msg.includes('user-not-found') || msg.includes('no user record')) {
        skippedNoAuth++;
      } else {
        failed++;
        console.warn(`  ✗ ${lineUid}: ${msg}`);
      }
    }
  }

  console.log('\n=== 完成 ===');
  console.log(`  已回填 claims：${synced}`);
  console.log(`  跳過（無 Firebase Auth user，未曾登入）：${skippedNoAuth}`);
  console.log(`  失敗：${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
