/**
 * LINE id_token 驗證 — 以標準函式庫本地驗簽（oidc-standard-verify / 承諾 3）
 *
 * **為什麼不再自己寫**：2026-08-19 手機瀏覽器登入 100% 失敗，炸點是我們自己寫的那行
 * `verified.aud !== channelId`（channel id 被 destr 轉成 number，型別不等）。根因雖是型別，
 * 但更上一層的問題是 id_token 的驗證整段都是手刻的——自己寫的每一行，就是自己可能寫錯的一行。
 * 承諾 1 的靜態掃描能擋住「同一種」錯誤，擋不住下一種。
 *
 * 改用 `jose` 之後，簽章 / iss / aud / exp 全由函式庫驗，**那行比對不再存在**。
 *
 * **已查證的 LINE OIDC 事實**（取自 discovery 與 JWKS 實際回應，非推測）：
 *   issuer                         = https://access.line.me
 *   jwks_uri                       = https://api.line.me/oauth2/v2.1/certs
 *   id_token_signing_alg_supported = ['ES256'] 僅此一種
 *   JWKS 金鑰數                     = 20 把 EC/P-256 → **金鑰處於輪替狀態**
 *
 * 金鑰輪替這點決定了設計：必須用 `createRemoteJWKSet`（依 `kid` 查找、未命中自動重抓、
 * 內建 cooldown）。自行抓一次快取起來，輪替後遇到未知 kid 就會全面驗證失敗
 * ——那正是「低流量路徑 100% 失效」的再一次翻版。
 *
 * JWKS 放模組層：warm lambda 跨 invocation 共用，冷啟才取一次。同時我們移除了原本對
 * LINE `/verify` 端點的呼叫，網路往返淨減少。
 */
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import { configStr } from '~shared/config-str';

export const LINE_ISSUER = 'https://access.line.me';
export const LINE_JWKS_URL = 'https://api.line.me/oauth2/v2.1/certs';
/** LINE 的 discovery 只宣告 ES256；明確限定可擋掉 alg 混淆類攻擊。 */
export const LINE_ID_TOKEN_ALG = 'ES256';

/**
 * 失敗原因列舉。**刻意區分**：2026-08-19 查那顆 bug 有一半成本花在
 * 「verify 端點打不通」與「payload 不符」被寫成同一句話，只能靠讀原始碼猜。
 */
export type LineIdTokenFailReason =
  /** 取不到公開金鑰（LINE 端異常 / 網路 / 冷啟逾時） */
  | 'fetch'
  /** 簽章驗證失敗（金鑰輪替未追上 / token 遭竄改） */
  | 'signature'
  /** iss / aud / exp 不符 —— **設定錯誤會落在這一類** */
  | 'claims'
  /** nonce 不符（replay / state 錯配） */
  | 'nonce'
  /** 非預期的內部錯誤（呼叫參數型別錯等）—— 刻意不併入 fetch，
   *  否則設定型別錯誤會被誤報成網路問題（2026-08-20 單測抓到） */
  | 'internal';

export interface LineIdTokenOk {
  ok: true;
  sub: string;
  name: string;
  picture: string;
}

export interface LineIdTokenFail {
  ok: false;
  reason: LineIdTokenFailReason;
  /** 診斷用簡述，**不含 token 內容** */
  detail: string;
}

export type LineIdTokenResult = LineIdTokenOk | LineIdTokenFail;

/** 模組層建立：warm lambda 跨 invocation 共用金鑰快取，並在未知 kid 時自動重抓。 */
const LINE_JWKS = createRemoteJWKSet(new URL(LINE_JWKS_URL));

export interface VerifyLineIdTokenInput {
  idToken: string;
  /** OAuth client_id。允許傳入 number（destr 型別陷阱）——內部一律正規化為字串。 */
  channelId: string | number;
  /** 授權時送出的 nonce（來自我方一次性 state） */
  nonce: string;
}

/**
 * 驗證 LINE id_token 並取出身分。永不 throw。
 *
 * jose 負責：簽章、`iss`、`aud`、`exp`/`nbf`。
 * 本函式另外負責：`aud` 的型別正規化（雙重保險）與 `nonce` 比對（jose 不驗 nonce）。
 */
export async function verifyLineIdToken(
  input: VerifyLineIdTokenInput,
  /** 金鑰來源。預設為 LINE 遠端 JWKS；單測可注入本地金鑰以驗完整流程而不打網路。 */
  keyResolver: Parameters<typeof jwtVerify>[1] = LINE_JWKS,
): Promise<LineIdTokenResult> {
  // 雙重保險：呼叫端已用 configStr 讀取（承諾 1 的靜態掃描強制），此處再正規化一次。
  // 少了這一步，傳入 number 時的比對行為取決於函式庫實作，不該賭。
  const audience = configStr(input.channelId);
  if (!audience) {
    return { ok: false, reason: 'claims', detail: 'channelId 為空，無法比對 aud' };
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(input.idToken, keyResolver, {
      issuer: LINE_ISSUER,
      audience,
      algorithms: [LINE_ID_TOKEN_ALG],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    return { ok: false, ...classifyVerifyError(err) };
  }

  // nonce 由 jose 之外自行比對；兩邊的值都源自我方 Firestore state，無外部型別風險
  if (typeof payload.nonce !== 'string' || payload.nonce !== input.nonce) {
    return { ok: false, reason: 'nonce', detail: 'nonce 不符或缺失' };
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) {
    return { ok: false, reason: 'claims', detail: 'sub 缺失' };
  }

  return {
    ok: true,
    sub,
    name: typeof payload.name === 'string' ? payload.name : '',
    picture: typeof payload.picture === 'string' ? payload.picture : '',
  };
}

/**
 * 把 jose 的錯誤歸類為可機器判讀的原因。
 * 匯出供單測直接驗證分類邏輯（不必為了測分類而偽造完整驗證流程）。
 */
export function classifyVerifyError(err: unknown): { reason: LineIdTokenFailReason; detail: string } {
  // ⚠️ 順序有意義：JWTClaimValidationFailed 等皆繼承自 JOSEError，
  // 泛用的 JOSEError 判斷必須放在所有具體類別之後，否則會吃掉它們。
  // （JWTExpired 不繼承 JWTClaimValidationFailed，兩者都要檢——已實測確認。）

  // ── claims：iss / aud / exp 不符。**設定錯誤會落在這一類** ──────────
  if (err instanceof joseErrors.JWTExpired) {
    return { reason: 'claims', detail: 'id_token 已過期' };
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    const claim = (err as { claim?: string }).claim;
    return { reason: 'claims', detail: claim ? `claim 驗證失敗：${claim}` : 'claim 驗證失敗' };
  }

  // ── signature：簽章、金鑰、演算法 ──────────────────────────────
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return { reason: 'signature', detail: '簽章驗證失敗' };
  }
  if (err instanceof joseErrors.JWKSNoMatchingKey || err instanceof joseErrors.JWKSMultipleMatchingKeys) {
    return { reason: 'signature', detail: '找不到相符的公開金鑰（kid 未命中）' };
  }
  if (err instanceof joseErrors.JOSEAlgNotAllowed) {
    return { reason: 'signature', detail: `簽章演算法不被允許（僅接受 ${LINE_ID_TOKEN_ALG}）` };
  }

  // ── fetch：取不到公開金鑰 ─────────────────────────────────────
  if (err instanceof joseErrors.JWKSTimeout) {
    return { reason: 'fetch', detail: '取得公開金鑰逾時' };
  }

  // ── 其餘 jose 錯誤（token 格式壞等） ─────────────────────────────
  if (err instanceof joseErrors.JOSEError) {
    if (isFetchLikeError(err)) return { reason: 'fetch', detail: '取得公開金鑰失敗' };
    return { reason: 'signature', detail: `JWT 驗證失敗：${err.code}` };
  }

  // 非 jose 錯誤：網路層歸 fetch，其餘歸 internal。
  // 不可把未知錯誤一律當成 fetch —— 那會讓「呼叫參數型別錯」被誤報為網路問題。
  if (isFetchLikeError(err)) return { reason: 'fetch', detail: '取得公開金鑰失敗' };
  return { reason: 'internal', detail: '驗證過程發生非預期錯誤' };
}

/** 網路層錯誤的粗略判別（JWKS 取得失敗時 jose 會包裝底層 fetch 錯誤）。 */
function isFetchLikeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : '';
  return /fetch|network|timeout|ENOTFOUND|ECONNRESET/i.test(msg);
}
