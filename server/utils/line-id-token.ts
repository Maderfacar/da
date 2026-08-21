/**
 * LINE id_token 驗證 — 以標準函式庫本地驗簽（oidc-standard-verify / 承諾 3）
 *
 * **為什麼不再自己寫**：2026-08-19 手機瀏覽器登入 100% 失敗，炸點是我們自己寫的那行
 * `verified.aud !== channelId`（channel id 被 destr 轉成 number，型別不等）。
 * 改用 `jose` 之後，簽章 / iss / aud / exp 全由函式庫驗，那行比對不再存在。
 *
 * ⚠️ **本檔第一版在 prod 炸過一次（2026-08-22，已回滾 f2a15f7），教訓寫在這裡：**
 *
 * 第一版查了 LINE 的 discovery 端點，看到 `id_token_signing_alg_values_supported: ['ES256']`
 * 就寫死只接受 ES256 → 瀏覽器登入 100% 失敗、無限登入迴圈。
 *
 * 官方文件（developers.line.biz/en/docs/line-login/verify-id-token/）明確區分：
 *   - **web login（就是我們這條瀏覽器 OAuth 流程）→ `HS256`，用 channel secret 驗**
 *   - native app / LINE SDK / LIFF → `ES256`，用 JWK 端點的公鑰驗
 * discovery 宣告的 ES256 講的是後者，不是我們。
 *
 * 錯誤的根源不是查得不夠，是**查錯了東西**：查了「文件怎麼描述」，卻從未解開一枚真實
 * id_token 的 header 看它實際寫什麼。而單元測試裡的 token 全是照我的假設用 ES256 自簽的
 * ——測試驗證的是「程式碼符合我的假設」，不是「假設符合現實」，所以它們全綠然後上線就炸。
 *
 * **因此本版不賭在單一假設上**：依 token 實際的 `alg` header 選金鑰，兩條記載的路徑都支援。
 * 就算文件再錯一次，也不會整條掛掉。
 *
 * **依 alg 選金鑰為何安全**（這與典型的 alg confusion 攻擊不同）：
 * 經典漏洞是「把 RS256 改成 HS256，拿公鑰當 HMAC 密鑰簽」——成立的前提是驗證方的 HMAC
 * 密鑰是公開的。這裡 HS256 用的是 **channel secret（我方私密、從不外流）**，
 * ES256 用的是 LINE 私鑰簽發、我方以公鑰驗。攻擊者兩邊的金鑰都拿不到，故無此問題。
 * 演算法白名單也嚴格限定這兩種，不接受 `none` 或任何非對稱/對稱混用。
 */
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, errors as joseErrors } from 'jose';
import { createSecretKey } from 'node:crypto';
import { configStr } from '~shared/config-str';

export const LINE_ISSUER = 'https://access.line.me';
export const LINE_JWKS_URL = 'https://api.line.me/oauth2/v2.1/certs';

/**
 * 允許的簽章演算法。**兩種都要支援**，見檔頭教訓：
 *   HS256 — web login（channel secret）
 *   ES256 — LIFF / native（JWKS 公鑰）
 */
export const LINE_ID_TOKEN_ALGS = ['HS256', 'ES256'] as const;
export type LineIdTokenAlg = (typeof LINE_ID_TOKEN_ALGS)[number];

/**
 * 失敗原因列舉。**刻意區分**：2026-08-19 查那顆 bug 有一半成本花在
 * 「verify 端點打不通」與「payload 不符」被寫成同一句話，只能靠讀原始碼猜。
 */
export type LineIdTokenFailReason =
  /** 取不到公開金鑰（LINE 端異常 / 網路 / 冷啟逾時） */
  | 'fetch'
  /** 簽章驗證失敗（金鑰不符 / token 遭竄改 / alg 不在白名單） */
  | 'signature'
  /** iss / aud / exp 不符 —— **設定錯誤會落在這一類** */
  | 'claims'
  /** nonce 不符（replay / state 錯配） */
  | 'nonce'
  /** 非預期的內部錯誤（呼叫參數型別錯等）—— 刻意不併入 fetch，
   *  否則設定型別錯誤會被誤報成網路問題 */
  | 'internal';

export interface LineIdTokenOk {
  ok: true;
  sub: string;
  name: string;
  picture: string;
  /** 實際使用的簽章演算法（診斷用；讓 log 能看出走了哪條路） */
  alg: string;
}

export interface LineIdTokenFail {
  ok: false;
  reason: LineIdTokenFailReason;
  /** 診斷用簡述，**不含 token 內容** */
  detail: string;
  /**
   * token 標頭宣告的演算法（未經驗證，僅供診斷）。
   * 教訓：錯誤訊息只寫「我期望什麼」而不寫「實際收到什麼」，會讓排查得用猜的
   * —— 第一版就是只印「僅接受 ES256」，沒印實際是 HS256。
   */
  observedAlg?: string;
}

export type LineIdTokenResult = LineIdTokenOk | LineIdTokenFail;

/** 模組層建立：warm lambda 跨 invocation 共用金鑰快取，並在未知 kid 時自動重抓。 */
const LINE_JWKS = createRemoteJWKSet(new URL(LINE_JWKS_URL));

export interface VerifyLineIdTokenInput {
  idToken: string;
  /** OAuth client_id。允許傳入 number（destr 型別陷阱）——內部一律正規化為字串。 */
  channelId: string | number;
  /** Channel secret —— HS256（web login）的驗簽金鑰 */
  channelSecret: string;
  /** 授權時送出的 nonce（來自我方一次性 state） */
  nonce: string;
}

/** jose 的 key resolver 型別（(protectedHeader, token) => key）。 */
type KeyResolver = Parameters<typeof jwtVerify>[1];

/**
 * 依 token 實際宣告的 alg 選金鑰。見檔頭「依 alg 選金鑰為何安全」。
 * 白名單外的 alg 一律拒絕（jwtVerify 的 algorithms 選項另有一道，此處為雙保險）。
 */
function keyResolverFor(channelSecret: string): KeyResolver {
  return (async (header, token) => {
    if (header.alg === 'HS256') {
      return createSecretKey(Buffer.from(channelSecret, 'utf8'));
    }
    if (header.alg === 'ES256') {
      return LINE_JWKS(header, token);
    }
    throw new joseErrors.JOSEAlgNotAllowed(`不支援的簽章演算法：${String(header.alg)}`);
  }) as KeyResolver;
}

/**
 * 驗證 LINE id_token 並取出身分。永不 throw。
 *
 * jose 負責：簽章、`iss`、`aud`、`exp`/`nbf`。
 * 本函式另外負責：`aud` 的型別正規化（雙重保險）、依 alg 選金鑰、`nonce` 比對（jose 不驗 nonce）。
 */
export async function verifyLineIdToken(
  input: VerifyLineIdTokenInput,
  /** 金鑰來源。預設依 alg 自動選；單測可注入固定金鑰以驗完整流程而不打網路。 */
  keyResolver?: KeyResolver,
): Promise<LineIdTokenResult> {
  // 雙重保險：呼叫端已用 configStr 讀取（承諾 1 的靜態掃描強制），此處再正規化一次。
  const audience = configStr(input.channelId);
  if (!audience) {
    return { ok: false, reason: 'claims', detail: 'channelId 為空，無法比對 aud' };
  }

  // 先解出 header 供診斷 —— 未經驗證，只用來回報「實際收到什麼演算法」。
  let observedAlg: string | undefined;
  try {
    observedAlg = decodeProtectedHeader(input.idToken).alg;
  } catch {
    return { ok: false, reason: 'signature', detail: 'id_token 格式無法解析' };
  }

  if (!input.channelSecret && observedAlg === 'HS256') {
    return { ok: false, reason: 'claims', detail: 'channelSecret 為空，無法驗 HS256 簽章', observedAlg };
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(
      input.idToken,
      keyResolver ?? keyResolverFor(input.channelSecret),
      {
        issuer: LINE_ISSUER,
        audience,
        algorithms: [...LINE_ID_TOKEN_ALGS],
      },
    );
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    return { ok: false, ...classifyVerifyError(err), observedAlg };
  }

  // nonce 由 jose 之外自行比對；兩邊的值都源自我方 Firestore state，無外部型別風險
  if (typeof payload.nonce !== 'string' || payload.nonce !== input.nonce) {
    return { ok: false, reason: 'nonce', detail: 'nonce 不符或缺失', observedAlg };
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) {
    return { ok: false, reason: 'claims', detail: 'sub 缺失', observedAlg };
  }

  return {
    ok: true,
    sub,
    name: typeof payload.name === 'string' ? payload.name : '',
    picture: typeof payload.picture === 'string' ? payload.picture : '',
    alg: observedAlg ?? '',
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
    return { reason: 'signature', detail: '簽章驗證失敗（金鑰不符或 token 遭竄改）' };
  }
  if (err instanceof joseErrors.JWKSNoMatchingKey || err instanceof joseErrors.JWKSMultipleMatchingKeys) {
    return { reason: 'signature', detail: '找不到相符的公開金鑰（kid 未命中）' };
  }
  if (err instanceof joseErrors.JOSEAlgNotAllowed) {
    return { reason: 'signature', detail: `簽章演算法不被允許（僅接受 ${LINE_ID_TOKEN_ALGS.join(' / ')}）` };
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
