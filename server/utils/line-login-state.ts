/**
 * LINE Login server OAuth — state 管理與導回目標淨化（認證根治 Phase 3）
 *
 * server-side authorization code flow 的 CSRF / replay 防護核心：
 *   - createLoginState：產生不可預測 state + nonce，寫入 line_login_states/{state}（含 TTL），
 *     隨 authorize URL 一起送出。state 是「這次授權是我方發起」的憑證。
 *   - consumeLoginState：callback 回來時以 transaction「讀取即刪除」，消費一次即失效（防 replay），
 *     並比對未過期。回 { target, clientType, nonce } 或 null。
 *   - sanitizeTarget：導回目標僅允許站內相對路徑，擋 open redirect（與 shared/auth deep-link /
 *     store _SyncLiffStateRoute 同一套規則：`/` 開頭、非 `//`、無 scheme）。
 *   - lineLoginRedirectUri：換 token / authorize 兩處共用同一條固定 callback（必須 byte-identical，
 *     且與 LINE console 登記值一致，否則 redirect_uri does not match）。
 *
 * 為何存 Firestore 而非 signed cookie：LINE in-app webview 對 cookie / 儲存不可靠（正是本次認證
 * 根治的核心動機）。state 存 server，callback 只帶回 state 字串，端到端不依賴 client 儲存。
 *
 * csrf-origin middleware 只擋「帶 da_session 的 mutating 請求」；本流程兩端點皆為 GET，
 * 不受其管，CSRF 防護完全靠此處的 state 驗證 + 消費一次。
 */
import { randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';

export type LoginClientType = 'passenger' | 'driver';

/** state doc TTL：10 分鐘（授權頁停留 + 網路往返的合理上限）。 */
export const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;

/** 固定 callback path（LINE console 登記值的 path 部分）。 */
export const LINE_CALLBACK_PATH = '/nuxt-api/auth/line/callback';

/** prod 網域（siteUrl 未設時的 fallback；與 nuxt.config site.url 預設一致）。 */
export const LINE_PROD_ORIGIN = 'https://da-line-liff-app.vercel.app';

const STATE_COLLECTION = 'line_login_states';

export interface LoginStatePayload {
  target: string;
  clientType: LoginClientType;
  nonce: string;
}

/**
 * 換 token / authorize 共用的固定 redirect_uri。
 * 兩處必回傳完全相同字串，且需與 LINE console 登記值一致。
 */
export function lineLoginRedirectUri(siteUrl: string | undefined | null): string {
  const origin = siteUrl && siteUrl.trim() ? siteUrl.trim().replace(/\/+$/, '') : LINE_PROD_ORIGIN;
  return `${origin}${LINE_CALLBACK_PATH}`;
}

/** clientType 正規化（僅接受 passenger / driver，其餘一律 passenger）。 */
export function normalizeClientType(raw: unknown): LoginClientType {
  return raw === 'driver' ? 'driver' : 'passenger';
}

/** 目標路徑允許字元：可見 ASCII（0x21-0x7E），排除控制字元 / 空白。 */
const HAS_UNSAFE_CHAR = /[^\x21-\x7e]/;

/**
 * 淨化導回目標：只允許站內相對路徑，擋 open redirect。
 * 規則：非空、`/` 開頭、非 `//`（protocol-relative）、不含 `\`、不含 `:`（scheme）、
 * 僅可見 ASCII（無控制字元 / 空白，正常 path 應已 %-encoded）。
 * 不合法回 fallback（依 clientType 給端別預設）。
 */
export function sanitizeTarget(raw: unknown, clientType: LoginClientType): string {
  const fallback = clientType === 'driver' ? '/driver/dashboard' : '/';
  if (typeof raw !== 'string') return fallback;
  const t = raw.trim();
  if (!t) return fallback;
  if (!t.startsWith('/')) return fallback;
  if (t.startsWith('//')) return fallback;
  if (t.includes('\\')) return fallback;
  if (t.includes(':')) return fallback; // 擋 javascript: / http: 等 scheme
  if (HAS_UNSAFE_CHAR.test(t)) return fallback;
  return t;
}

/** 產生 URL-safe 隨機 token（hex）。 */
function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * 建立一次性登入 state（寫入 Firestore，附 TTL）。
 * 回 { state, nonce }：state 放進 authorize `state` 參數，nonce 放進 `nonce` 參數。
 */
export async function createLoginState(
  db: Firestore,
  payload: { target: string; clientType: LoginClientType },
): Promise<{ state: string; nonce: string }> {
  const state = randomToken(32);
  const nonce = randomToken(16);
  const now = Date.now();
  await db.collection(STATE_COLLECTION).doc(state).set({
    target: payload.target,
    clientType: payload.clientType,
    nonce,
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + LOGIN_STATE_TTL_MS),
  });
  return { state, nonce };
}

// line_login_states 清理：consume 成功會即刻刪 doc，但「按了登入卻沒走完 callback」
// （關視窗 / 授權頁取消 / 網路斷）的 doc 會殘留至過期後仍在，無上限累積。以下 janitor
// 依 expiresAt 批次刪除過期 doc，冪等、單次有上限（避免 serverless timeout，剩餘留隔日）。
// ⚠️ 併進既有每日 cron（cleanup-error-logs）呼叫，不新增 Vercel cron 條目（Hobby 方案上限 2 個）。
const STATE_CLEANUP_BATCH = 400;         // Firestore WriteBatch 上限 500，留餘裕
const STATE_CLEANUP_MAX_BATCHES = 10;    // 單次最多刪 ~4k，剩餘隔日續清

export interface PurgeLoginStatesResult {
  deleted: number;
  batches: number;
  /** 達單次批次上限、仍有殘餘 → 隔日 cron 續清 */
  hasMore: boolean;
}

/** 批次刪除已過期的 line_login_states doc（依 expiresAt）。冪等、不 throw 由 caller 決定。 */
export async function purgeExpiredLoginStates(
  db: Firestore,
  now: Date = new Date(),
): Promise<PurgeLoginStatesResult> {
  const col = db.collection(STATE_COLLECTION);
  const cutoff = Timestamp.fromDate(now);
  let deleted = 0;
  let batches = 0;
  for (; batches < STATE_CLEANUP_MAX_BATCHES; batches++) {
    const snap = await col
      .where('expiresAt', '<', cutoff)
      .orderBy('expiresAt', 'asc')
      .limit(STATE_CLEANUP_BATCH)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < STATE_CLEANUP_BATCH) break; // 最後一批
  }
  return { deleted, batches, hasMore: batches >= STATE_CLEANUP_MAX_BATCHES };
}

/**
 * 消費 state：transaction 讀取即刪除（一次性，防 replay），並檢查未過期。
 * 回 payload 或 null（不存在 / 已消費 / 已過期 / 交易失敗）。
 */
export async function consumeLoginState(
  db: Firestore,
  state: string,
): Promise<LoginStatePayload | null> {
  if (!state || typeof state !== 'string' || state.length < 16) return null;
  const ref = db.collection(STATE_COLLECTION).doc(state);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.delete(ref); // 消費一次即失效
      const data = snap.data() ?? {};
      const expiresAtMs = (data.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (!expiresAtMs || Date.now() > expiresAtMs) return null; // 已過期
      const clientType: LoginClientType = data.clientType === 'driver' ? 'driver' : 'passenger';
      const target = typeof data.target === 'string'
        ? data.target
        : (clientType === 'driver' ? '/driver/dashboard' : '/');
      const nonce = typeof data.nonce === 'string' ? data.nonce : '';
      return { target, clientType, nonce };
    });
  } catch (err) {
    console.error('[line-login-state] consume transaction failed:', err);
    return null;
  }
}
