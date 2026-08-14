/**
 * LINE 使用者建置共用 helper（認證根治 Phase 3）
 *
 * 把 line-exchange 的「取得/建立 Firebase 使用者 → 取角色核准 → 同步 persistent claims →
 * 簽發 custom token」核心（原 §3~§6）抽出，供兩條入口共用、單一真相：
 *   1. server/routes/nuxt-api/auth/line-exchange.post.ts（LIFF access token 路徑，過渡保留）
 *   2. server/routes/nuxt-api/auth/line/callback.get.ts（server OAuth authorization code 路徑，P3）
 *
 * 兩者上游取得 LINE 身分的手段不同（LIFF verify+userinfo vs. OAuth id_token verify），
 * 但「拿到 { sub, name, picture } 之後」的使用者建置完全一致 —— 只維護這一份，杜絕行為漂移。
 *
 * 規範沿用 line-exchange 既有註解：
 *   - 新使用者一律建為 ['passenger']，額外 role 由 admin 加。
 *   - 同步 Firestore 文件禁用 .set() 直接覆寫（必 merge: true 或先 .get()）。
 *   - referralCode 產生失敗不可阻擋登入（§4 lazy backfill 補寫）。
 *   - P27：driverApplication 已搬至 drivers/{uid}.application，users doc 不含此欄位。
 */
import { FieldValue } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { DEFAULT_REFERRAL_USER_FIELDS, generateUniqueReferralCode } from '@@/utils/referral';
import { syncUserClaims, type Role } from '@@/utils/sync-user-claims';

export interface LineProfileInfo {
  /** LINE userId（Firestore users/{lineUid} document key；Firebase uid = `line:${sub}`） */
  sub: string;
  name: string;
  picture: string;
}

export interface ProvisionOk {
  ok: true;
  customToken: string;
  roles: Role[];
  approved: boolean;
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
}

export interface ProvisionFail {
  ok: false;
  /** createUser = §3 建立使用者失敗；customToken = §6 簽發登入憑證失敗 */
  reason: 'createUser' | 'customToken';
}

export type ProvisionResult = ProvisionOk | ProvisionFail;

/** 容錯：Firebase Console 誤把 roles 存成 string 型別時嘗試 parse。 */
const parseRoles = (raw: unknown): Role[] => {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === 'string') {
    arr = raw.replace(/[[\]'"\s]/g, '').split(',');
  }
  return arr.filter((r): r is Role => r === 'passenger' || r === 'driver' || r === 'admin');
};

/**
 * 由 LINE 身分建立/取得 Firebase 使用者並簽發 custom token。
 * 不 throw —— 失敗回 { ok:false, reason }，由呼叫端（JSON envelope / 302 redirect）自行處理。
 */
export async function provisionLineUser(
  auth: Auth,
  db: Firestore,
  profile: LineProfileInfo,
): Promise<ProvisionResult> {
  const uid = `line:${profile.sub}`;

  // ── §3 取得或建立 Firebase 使用者 ─────────────────────────
  let isNewUser = false;
  try {
    await auth.getUser(uid);
  } catch {
    isNewUser = true;
  }

  if (isNewUser) {
    try {
      await auth.createUser({
        uid,
        displayName: profile.name,
        photoURL: profile.picture,
      });
      // 用 merge: true 避免覆寫既有 Firestore 文件中的手動設定（admin 預先設好的 roles / approved）。
      // Firebase Auth user 可能因前次失敗而從未建成功，但 Firestore 文件已存在，直接 .set() 會清掉。
      const docRef = db.collection('users').doc(profile.sub);
      const existingSnap = await docRef.get();
      let referralCode: string | null = null;
      try {
        referralCode = await generateUniqueReferralCode(db);
      } catch (err) {
        console.warn('[line-user-provision] referralCode 產生失敗（非致命，將於下次登入補寫）:', err);
      }
      if (existingSnap.exists) {
        await docRef.set({
          lineUserId: profile.sub,
          displayName: profile.name,
          pictureUrl: profile.picture,
          lastSeenAt: FieldValue.serverTimestamp(),
          ...(referralCode && !existingSnap.data()?.referralCode ? { referralCode } : {}),
        }, { merge: true });
      } else {
        await docRef.set({
          roles: ['passenger'],
          approved: true,
          lineUserId: profile.sub,
          displayName: profile.name,
          pictureUrl: profile.picture,
          createdAt: new Date(),
          lastSeenAt: FieldValue.serverTimestamp(),
          referredBy: DEFAULT_REFERRAL_USER_FIELDS.referredBy,
          welcomeRewardClaimed: DEFAULT_REFERRAL_USER_FIELDS.welcomeRewardClaimed,
          ...(referralCode ? { referralCode } : {}),
        });
      }
    } catch (err) {
      console.error('[line-user-provision] createUser/set failed:', err);
      return { ok: false, reason: 'createUser' };
    }
  } else {
    // 既有使用者：merge 寫入最新 displayName / pictureUrl + lastSeenAt
    try {
      await db.collection('users').doc(profile.sub).set({
        displayName: profile.name,
        pictureUrl: profile.picture,
        lastSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.warn('[line-user-provision] existing user displayName/pictureUrl sync failed (non-fatal):', err);
    }
  }

  // ── §4 取得 Firestore 角色與核准狀態 ──────────────────────
  let roles: Role[] = ['passenger'];
  let approved = true;
  try {
    const userDoc = await db.collection('users').doc(profile.sub).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      const parsed = parseRoles(data?.roles);
      if (parsed.length > 0) {
        roles = parsed;
      } else if (typeof data?.role === 'string') {
        const legacy = parseRoles([data.role]);
        if (legacy.length > 0) roles = legacy;
      }
      approved = (data?.approved as boolean) ?? true;

      // 既有使用者缺 referralCode 時 lazy backfill（非致命）
      if (!data?.referralCode) {
        try {
          const code = await generateUniqueReferralCode(db);
          await db.collection('users').doc(profile.sub).set({ referralCode: code }, { merge: true });
        } catch (err) {
          console.warn('[line-user-provision] referralCode lazy backfill 失敗（非致命）:', err);
        }
      }
    }
  } catch (err) {
    console.error('[line-user-provision] Firestore read failed (non-fatal):', err);
  }

  // ── §5 同步 persistent custom claims（W1）─────────────────
  await syncUserClaims(auth, db, profile.sub, { roles });

  // ── §6 建立 Firebase Custom Token ────────────────────────
  let customToken: string;
  try {
    customToken = await auth.createCustomToken(uid, { roles });
  } catch (err) {
    console.error('[line-user-provision] createCustomToken failed:', err);
    return { ok: false, reason: 'customToken' };
  }

  return {
    ok: true,
    customToken,
    roles,
    approved,
    lineUserId: profile.sub,
    displayName: profile.name,
    pictureUrl: profile.picture,
  };
}
