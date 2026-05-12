#!/usr/bin/env node
/**
 * P27 一次性 migration：users/{uid}.driverApplication → drivers/{uid}.application
 *
 * 用法：
 *   FIREBASE_SERVICE_ACCOUNT_JSON='...' node scripts/migrate-driver-application-to-drivers.mjs --dry-run
 *   FIREBASE_SERVICE_ACCOUNT_JSON='...' node scripts/migrate-driver-application-to-drivers.mjs --apply
 *
 *   或 pnpm migrate:driver-app --dry-run / --apply
 *
 * 邏輯：
 *   1. 連 Firestore admin SDK
 *   2. 列出 users where driverApplication exists
 *   3. 對每筆：
 *      a. 確認 drivers/{uid} 存在（必須先有 — driver/apply.post.ts 會建立）；不存在 skip 並 warn
 *      b. 若 drivers/{uid}.application 已存在 → skip（idempotent，已搬過）
 *      c. 否則寫 drivers/{uid}.application = copy of users/{uid}.driverApplication
 *      d. 從 users/{uid} 刪掉 driverApplication 欄位
 *   4. 最後寫一筆 audit log `migration.driver_application_move` 含 summary
 *
 * Idempotency：
 *   - 已搬過的（drivers.application 存在）跳過，可重複跑
 *   - 沒 driverApplication 的 user 不會被讀到（query 過濾）
 *
 * 安全：
 *   - dry-run 模式不寫入，只印影響清單
 *   - apply 模式逐筆寫，失敗 silent log，不中斷整批
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isApply = args.includes('--apply');

if (!isDryRun && !isApply) {
  console.error('Usage: node scripts/migrate-driver-application-to-drivers.mjs --dry-run | --apply');
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
console.log('\n=== P27 Migration: driverApplication users → drivers ===');
console.log(`Mode: ${MODE}\n`);

// ── 主流程 ────────────────────────────────────────────────────
const startedAt = Date.now();
const stats = {
  scanned: 0,
  skippedNoDriverDoc: 0,
  skippedAlreadyMoved: 0,
  migrated: 0,
  failed: 0,
  failedUids: [],
};

try {
  // Firestore 不直接支援 where('field', '!=', null) 對 map 欄位的存在性查詢；
  // 改成全掃 users 後在記憶體過濾。本專案 users 集合上限約 100 筆級。
  const usersSnap = await db.collection('users').get();

  for (const userDoc of usersSnap.docs) {
    const lineUid = userDoc.id;
    const userData = userDoc.data();
    const oldApp = userData.driverApplication;
    if (!oldApp || typeof oldApp !== 'object') continue;

    stats.scanned++;

    // 確認 drivers doc 存在（必須先有 — driver/apply.post.ts 流程會建）
    const driverRef = db.collection('drivers').doc(lineUid);
    const driverSnap = await driverRef.get();
    if (!driverSnap.exists) {
      console.warn(`[skip] ${lineUid}: drivers doc not found（可能 P18 之前的舊 driver，待手動處理）`);
      stats.skippedNoDriverDoc++;
      continue;
    }

    // 已搬過 → idempotent skip
    const existingApp = driverSnap.data()?.application;
    if (existingApp && typeof existingApp === 'object') {
      console.log(`[skip] ${lineUid}: drivers.application 已存在，idempotent skip`);
      stats.skippedAlreadyMoved++;
      // 不論 apply 或 dry-run，仍刪除 users.driverApplication（清理殘留）
      if (isApply) {
        try {
          await userDoc.ref.update({ driverApplication: FieldValue.delete() });
          console.log(`[clean] ${lineUid}: 刪除 users.driverApplication 殘留`);
        } catch (err) {
          console.error(`[clean fail] ${lineUid}: ${err.message}`);
        }
      }
      continue;
    }

    // 執行搬遷
    if (isDryRun) {
      console.log(`[dry-run] ${lineUid}: would migrate keys=[${Object.keys(oldApp).join(', ')}]`);
      stats.migrated++;
      continue;
    }

    try {
      // 1. 寫到 drivers.application
      await driverRef.set({ application: oldApp }, { merge: true });
      // 2. 刪掉 users.driverApplication
      await userDoc.ref.update({ driverApplication: FieldValue.delete() });
      console.log(`[ok] ${lineUid}: migrated`);
      stats.migrated++;
    } catch (err) {
      console.error(`[fail] ${lineUid}: ${err.message}`);
      stats.failed++;
      stats.failedUids.push(lineUid);
    }
  }

  // ── 寫 summary audit log（僅 apply mode）──────────────────────
  if (isApply) {
    try {
      await db.collection('audit_logs').add({
        actorUid: 'system:migration',
        actorDisplayName: 'P27 Migration Script',
        actorLevel: 'system',
        action: 'migration.driver_application_move',
        targetType: 'migration',
        targetId: 'P27',
        payload: {
          scanned: stats.scanned,
          migrated: stats.migrated,
          skippedNoDriverDoc: stats.skippedNoDriverDoc,
          skippedAlreadyMoved: stats.skippedAlreadyMoved,
          failed: stats.failed,
          failedUids: stats.failedUids,
          durationMs: Date.now() - startedAt,
        },
        ip: '',
        userAgent: 'migrate-driver-application-to-drivers.mjs',
        createdAt: FieldValue.serverTimestamp(),
      });
      console.log('\n[audit] migration summary written to audit_logs');
    } catch (err) {
      console.error('[audit fail]', err.message);
    }
  }
} catch (err) {
  console.error('\n=== FATAL ===');
  console.error(err);
  process.exit(1);
}

const durationSec = ((Date.now() - startedAt) / 1000).toFixed(2);
console.log('\n=== Summary ===');
console.log(`Mode:              ${MODE}`);
console.log(`Duration:          ${durationSec}s`);
console.log(`Scanned (有 dApp): ${stats.scanned}`);
console.log(`Migrated:          ${stats.migrated}`);
console.log(`Skipped (no driver doc): ${stats.skippedNoDriverDoc}`);
console.log(`Skipped (already moved): ${stats.skippedAlreadyMoved}`);
console.log(`Failed:            ${stats.failed}`);
if (stats.failedUids.length > 0) {
  console.log(`Failed UIDs:       ${stats.failedUids.join(', ')}`);
}
console.log('');
process.exit(stats.failed > 0 ? 1 : 0);
