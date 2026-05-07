import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let _app: App | null = null;

/**
 * Service account 來源型別：
 * - string：環境變數原始 JSON 字串（需 JSON.parse）
 * - object：Nuxt runtimeConfig 內建用 destr 自動把合法 JSON 字串 parse 成 object，
 *   這時直接拿來用即可（避免再次 JSON.parse 拋出 "[object Object]" is not valid JSON）
 */
export function useFirebaseAdmin(serviceAccount: string | Record<string, unknown> | undefined | null): { auth: Auth; db: Firestore } {
  if (!_app && !getApps().length) {
    if (!serviceAccount) {
      throw new Error('NUXT_FIREBASE_SERVICE_ACCOUNT_JSON is not configured (empty/undefined)');
    }
    let sa: Record<string, unknown>;
    try {
      if (typeof serviceAccount === 'string') {
        sa = JSON.parse(serviceAccount);
      } else if (typeof serviceAccount === 'object') {
        // 重要：Nuxt runtimeConfig 經過 defu deep merge 後 object 是 frozen / read-only。
        // Firebase Admin SDK 內部會試圖 mutate service account（規範化欄位），會 throw
        // "Cannot assign to read only property 'project_id'"。深拷貝一份解除 frozen。
        sa = JSON.parse(JSON.stringify(serviceAccount));
      } else {
        throw new Error(`Unexpected serviceAccount type: ${typeof serviceAccount}`);
      }
    } catch (err) {
      console.error('[useFirebaseAdmin] failed to normalize service account:', err);
      throw err;
    }

    // 驗證必要欄位都存在
    const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
    const missing = requiredFields.filter((k) => !sa[k]);
    if (missing.length > 0) {
      console.error('[useFirebaseAdmin] service account 缺少必要欄位:', missing, 'present keys:', Object.keys(sa));
      throw new Error(`Service account missing required fields: ${missing.join(', ')}`);
    }

    // private_key 格式檢查：必須是含 BEGIN/END PRIVATE KEY 的 PEM 字串
    const pk = sa.private_key as string;
    if (typeof pk !== 'string' || !pk.includes('BEGIN PRIVATE KEY') || !pk.includes('END PRIVATE KEY')) {
      console.error('[useFirebaseAdmin] private_key 格式異常 — 不是合法 PEM');
      console.error('[useFirebaseAdmin] private_key type:', typeof pk, 'length:', pk?.length);
      console.error('[useFirebaseAdmin] private_key starts with:', String(pk).slice(0, 50));
      throw new Error('private_key is not a valid PEM string');
    }

    try {
      _app = initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) });
    } catch (err) {
      console.error('[useFirebaseAdmin] initializeApp(cert) failed:', err);
      throw err;
    }
  } else if (!_app) {
    _app = getApps()[0];
  }
  return { auth: getAuth(_app), db: getFirestore(_app) };
}
