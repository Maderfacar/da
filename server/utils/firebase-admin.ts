import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let _app: App | null = null;

export function useFirebaseAdmin(serviceAccountJson: string): { auth: Auth; db: Firestore } {
  if (!_app && !getApps().length) {
    const sa = JSON.parse(serviceAccountJson);
    _app = initializeApp({ credential: cert(sa) });
  } else if (!_app) {
    _app = getApps()[0];
  }
  return { auth: getAuth(_app), db: getFirestore(_app) };
}
