import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

let _app: App | null = null;

/**
 * Service account 來源型別：
 * - string：環境變數原始 JSON 字串（需 JSON.parse）
 * - object：Nuxt runtimeConfig 內建用 destr 自動把合法 JSON 字串 parse 成 object，
 *   這時直接拿來用即可（避免再次 JSON.parse 拋出 "[object Object]" is not valid JSON）
 *
 * 重要：runtimeConfig 經 defu deep merge 後是 frozen / read-only。Firebase Admin SDK
 * 內部會 mutate service account（規範化欄位），對 frozen object 會 throw
 * "Cannot assign to read only property 'project_id'"。深拷貝一份解除 frozen。
 *
 * 詳見 docs/decision-log.md 2026/05/07~08 條目。
 */
export function useFirebaseAdmin(serviceAccount: string | Record<string, unknown> | undefined | null): { auth: Auth; db: Firestore; storage: Storage } {
  if (!_app && !getApps().length) {
    if (!serviceAccount) {
      throw new Error('NUXT_FIREBASE_SERVICE_ACCOUNT_JSON is not configured (empty/undefined)');
    }
    let sa: Record<string, unknown>;
    if (typeof serviceAccount === 'string') {
      sa = JSON.parse(serviceAccount);
    } else if (typeof serviceAccount === 'object') {
      // 深拷貝解除 Nuxt defu 的 frozen / read-only 限制
      sa = JSON.parse(JSON.stringify(serviceAccount));
    } else {
      throw new Error(`Unexpected serviceAccount type: ${typeof serviceAccount}`);
    }

    // 驗證必要欄位都存在
    const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
    const missing = requiredFields.filter((k) => !sa[k]);
    if (missing.length > 0) {
      throw new Error(`Service account missing required fields: ${missing.join(', ')}`);
    }

    // private_key 格式檢查：必須是含 BEGIN/END PRIVATE KEY 的 PEM 字串
    const pk = sa.private_key as string;
    if (typeof pk !== 'string' || !pk.includes('BEGIN PRIVATE KEY') || !pk.includes('END PRIVATE KEY')) {
      throw new Error('private_key is not a valid PEM string');
    }

    // P8：driver 證件圖片需上傳 Firebase Storage，於 init 時帶上 storageBucket
    //
    // 取值順序：
    //   1. server-only env var NUXT_FIREBASE_STORAGE_BUCKET
    //   2. public env var NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET（client SDK 也用此值，一份共用）
    //   3. fallback `${project_id}.firebasestorage.app`（2024/04 後新建專案的預設 bucket name）
    //   4. fallback `${project_id}.appspot.com`（舊版 Firebase 專案兜底）
    //
    // 使用者只需在 Vercel 設一份 NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET 即可同時供 client / server。
    const config = useRuntimeConfig();
    const serverBucket = (config as { firebaseStorageBucket?: string }).firebaseStorageBucket;
    const publicBucket = (config.public as { firebaseStorageBucket?: string })?.firebaseStorageBucket;
    const storageBucket =
      (serverBucket && serverBucket.length > 0 ? serverBucket : null)
      ?? (publicBucket && publicBucket.length > 0 ? publicBucket : null)
      ?? `${sa.project_id as string}.firebasestorage.app`;

    _app = initializeApp({
      credential: cert(sa as Parameters<typeof cert>[0]),
      storageBucket,
    });
  } else if (!_app) {
    _app = getApps()[0];
  }
  return { auth: getAuth(_app), db: getFirestore(_app), storage: getStorage(_app) };
}
