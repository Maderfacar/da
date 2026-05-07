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
      throw new Error('NUXT_FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
    }
    let sa: Record<string, unknown>;
    if (typeof serviceAccount === 'string') {
      sa = JSON.parse(serviceAccount);
    } else if (typeof serviceAccount === 'object') {
      sa = serviceAccount;
    } else {
      throw new Error(`Unexpected serviceAccount type: ${typeof serviceAccount}`);
    }
    _app = initializeApp({ credential: cert(sa as Parameters<typeof cert>[0]) });
  } else if (!_app) {
    _app = getApps()[0];
  }
  return { auth: getAuth(_app), db: getFirestore(_app) };
}
