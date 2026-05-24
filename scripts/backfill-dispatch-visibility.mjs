#!/usr/bin/env node
/**
 * Wave 2B+2C 一次性 migration：補 orders.dispatchVisibility
 *
 * 用法：
 *   FIREBASE_SERVICE_ACCOUNT_JSON='...' node scripts/backfill-dispatch-visibility.mjs --dry-run
 *   FIREBASE_SERVICE_ACCOUNT_JSON='...' node scripts/backfill-dispatch-visibility.mjs --apply
 *
 *   或 pnpm migrate:dispatch-visibility --dry-run / --apply
 *
 * 邏輯：
 *   1. 連 Firestore admin SDK
 *   2. 列出 orders（全掃，無 query 過濾；上限預期 < 5000 筆，prod 可一次性處理）
 *   3. 對每筆：
 *      a. 若 doc.dispatchVisibility 已存在 → skip（idempotent）
 *      b. 否則寫 dispatchVisibility = {
 *           startLevel:'0', currentLevel:'0',
 *           openedAt: doc.dispatchAt ?? doc.createdAt ?? now,
 *           levelHistory: [{ level:'0', openedAt: 同上, openedBy:'system', reason:'init' }]
 *         }
 *      c. 用 500/batch commit（Firestore 上限）
 *   4. 結束 print summary：scanned / skipped / migrated / failed
 *
 * Idempotency：已搬過的（dispatchVisibility 存在）跳過，可重複跑
 *
 * Why backfill '0' 全開？避免上線後既有 pending 訂單突然沒人看到。
 * 全部當「全車隊可見」對齊舊行為，admin 後續可手動降級。
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isApply = args.includes('--apply');

if (!isDryRun && !isApply) {
  console.error('Usage: node scripts/backfill-dispatch-visibility.mjs --dry-run | --apply');
  process.exit(1);
}
if (isDryRun && isApply) {
  console.error('Cannot use --dry-run and --apply together');
  process.exit(1);
}

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
  console.error('Missing env var: FIREBASE_SERVICE_ACCOUNT_JSON');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
} catch (err) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:', err.message);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const MODE = isDryRun ? 'DRY-RUN' : 'APPLY';
console.log('\n=== Wave 2B+2C Migration: backfill orders.dispatchVisibility ===');
console.log(`Mode: ${MODE}\n`);

const BATCH_SIZE = 500;

const startedAt = Date.now();
const stats = {
  scanned: 0,
  skippedAlreadyHas: 0,
  migrated: 0,
  failed: 0,
  failedIds: [],
};

const _coerceTs = (raw) => {
  if (raw && typeof raw === 'object' && typeof raw.toMillis === 'function') return raw;
  if (raw instanceof Date) return Timestamp.fromDate(raw);
  if (typeof raw === 'string') {
    const t = new Date(raw);
    if (!Number.isNaN(t.getTime())) return Timestamp.fromDate(t);
  }
  return null;
};

try {
  console.log('Scanning orders collection...');
  const snap = await db.collection('orders').get();
  stats.scanned = snap.size;
  console.log(`Found ${snap.size} order docs.\n`);

  let batch = db.batch();
  let pendingInBatch = 0;

  const flushBatch = async (label) => {
    if (pendingInBatch === 0) return;
    if (isDryRun) {
      console.log(`[DRY-RUN] (would commit batch of ${pendingInBatch} writes ${label ?? ''})`);
      pendingInBatch = 0;
      batch = db.batch();
      return;
    }
    try {
      await batch.commit();
      console.log(`[APPLY] committed batch of ${pendingInBatch} writes ${label ?? ''}`);
    } catch (err) {
      console.error('[APPLY] batch commit failed:', err.message);
      stats.failed += pendingInBatch;
    }
    pendingInBatch = 0;
    batch = db.batch();
  };

  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    if (data.dispatchVisibility) {
      stats.skippedAlreadyHas += 1;
      continue;
    }
    const fallbackTs = _coerceTs(data.dispatchAt) ?? _coerceTs(data.createdAt) ?? Timestamp.now();
    const visibility = {
      startLevel: '0',
      currentLevel: '0',
      openedAt: fallbackTs,
      levelHistory: [{
        level: '0',
        openedAt: fallbackTs,
        openedBy: 'system',
        reason: 'init',
      }],
    };
    if (isDryRun) {
      console.log(`[DRY-RUN] would backfill ${doc.id} → openedAt=${fallbackTs.toDate().toISOString()}`);
    }
    batch.set(doc.ref, { dispatchVisibility: visibility }, { merge: true });
    pendingInBatch += 1;
    stats.migrated += 1;
    if (pendingInBatch >= BATCH_SIZE) {
      await flushBatch(`(after ${stats.migrated} migrated)`);
    }
  }

  await flushBatch('(final)');
} catch (err) {
  console.error('FATAL:', err);
  process.exit(2);
}

const tookMs = Date.now() - startedAt;
console.log('\n=== Summary ===');
console.log(`Mode             : ${MODE}`);
console.log(`Scanned          : ${stats.scanned}`);
console.log(`Skipped (has)    : ${stats.skippedAlreadyHas}`);
console.log(`Migrated         : ${stats.migrated}${isDryRun ? ' (dry-run, not written)' : ''}`);
console.log(`Failed           : ${stats.failed}`);
if (stats.failedIds.length > 0) {
  console.log(`Failed IDs       : ${stats.failedIds.join(', ')}`);
}
console.log(`Elapsed          : ${(tookMs / 1000).toFixed(2)}s`);
console.log();

process.exit(stats.failed > 0 ? 3 : 0);
