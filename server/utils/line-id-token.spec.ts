import { describe, it, expect } from 'vitest';
import { SignJWT, generateKeyPair, decodeProtectedHeader, errors as joseErrors } from 'jose';
import { createSecretKey } from 'node:crypto';
import {
  verifyLineIdToken,
  classifyVerifyError,
  LINE_ISSUER,
  LINE_ID_TOKEN_ALGS,
  LINE_JWKS_URL,
} from './line-id-token';

const CHANNEL_ID = '2009509209';
const CHANNEL_SECRET = 'a'.repeat(32); // LINE channel secret 為 32 字元
const NONCE = 'nonce-abc-123';
const SUB = 'U3727e111e915d4199f75e30fda2a0d79';

const secretKey = (s = CHANNEL_SECRET) => createSecretKey(Buffer.from(s, 'utf8'));

const baseClaims = (o: Record<string, unknown> = {}) => ({
  nonce: NONCE,
  name: '測試使用者',
  picture: 'https://profile.line-scdn.net/xxx',
  ...o,
});

const sign = (claims: Record<string, unknown>, alg: string) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setIssuer((claims.iss as string) ?? LINE_ISSUER)
    .setAudience((claims.aud as string) ?? CHANNEL_ID)
    .setSubject((claims.sub as string) ?? SUB)
    .setIssuedAt()
    .setExpirationTime((claims.exp as string) ?? '5m');

/**
 * web login 的 token：HS256 + channel secret。
 * **這是我們的瀏覽器 OAuth 流程實際會收到的形狀**
 * （developers.line.biz/en/docs/line-login/verify-id-token/：
 *  「for web login, HS256 (HMAC using SHA-256) is returned」，金鑰為 channel secret）。
 */
const makeWebToken = (o: Record<string, unknown> = {}, secret = CHANNEL_SECRET) =>
  sign(baseClaims(o), 'HS256').sign(secretKey(secret));

/** LIFF / native 的 token：ES256 + 私鑰簽、公鑰驗。 */
async function makeLiffToken(o: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const token = await sign(baseClaims(o), 'ES256').sign(privateKey);
  return { token, publicKey };
}

const verifyWeb = (token: string, over: Partial<Parameters<typeof verifyLineIdToken>[0]> = {}) =>
  verifyLineIdToken({
    idToken: token,
    channelId: CHANNEL_ID,
    channelSecret: CHANNEL_SECRET,
    nonce: NONCE,
    ...over,
  });

describe('常數與 LINE 官方文件對齊', () => {
  it('issuer / jwks 位址正確', () => {
    expect(LINE_ISSUER).toBe('https://access.line.me');
    expect(LINE_JWKS_URL).toBe('https://api.line.me/oauth2/v2.1/certs');
  });

  it('迴歸：必須同時支援 HS256 與 ES256', () => {
    // 2026-08-22 事故：只允許 ES256（照 discovery 端點寫死）→ 瀏覽器登入 100% 失敗。
    // 官方文件：web login 回 HS256（channel secret）、LIFF/native 回 ES256（JWKS）。
    expect([...LINE_ID_TOKEN_ALGS].sort()).toEqual(['ES256', 'HS256']);
  });
});

describe('web login 路徑（HS256 + channel secret）—— 我們的瀏覽器 OAuth 流程', () => {
  it('迴歸：HS256 token 必須驗證通過（2026-08-22 炸的就是這個）', async () => {
    const res = await verifyWeb(await makeWebToken());
    expect(res).toMatchObject({ ok: true, sub: SUB, name: '測試使用者', alg: 'HS256' });
  });

  it('用錯的 channel secret 簽 → signature', async () => {
    const token = await makeWebToken({}, 'b'.repeat(32));
    expect(await verifyWeb(token)).toMatchObject({ ok: false, reason: 'signature' });
  });

  it('channelSecret 為空時明確失敗，不得靜默放行', async () => {
    const res = await verifyWeb(await makeWebToken(), { channelSecret: '' });
    expect(res).toMatchObject({ ok: false });
    expect(res.ok).toBe(false);
  });

  it('aud 不符 → claims（2026-08-19 炸的那個比對）', async () => {
    expect(await verifyWeb(await makeWebToken({ aud: '9999999999' })))
      .toMatchObject({ ok: false, reason: 'claims' });
  });

  it('iss 不符 → claims', async () => {
    expect(await verifyWeb(await makeWebToken({ iss: 'https://evil.example.com' })))
      .toMatchObject({ ok: false, reason: 'claims' });
  });

  it('已過期 → claims', async () => {
    expect(await verifyWeb(await makeWebToken({ exp: '-1m' })))
      .toMatchObject({ ok: false, reason: 'claims' });
  });

  it('nonce 不符 → nonce（replay 防護）', async () => {
    expect(await verifyWeb(await makeWebToken(), { nonce: 'different' }))
      .toMatchObject({ ok: false, reason: 'nonce' });
  });

  it('token 缺 nonce → nonce', async () => {
    expect(await verifyWeb(await makeWebToken({ nonce: undefined })))
      .toMatchObject({ ok: false, reason: 'nonce' });
  });

  it('迴歸：channelId 傳 number（destr 型別陷阱）行為與字串完全一致', async () => {
    const token = await makeWebToken();
    const asString = await verifyWeb(token);
    const asNumber = await verifyWeb(token, { channelId: Number(CHANNEL_ID) });
    expect(asNumber).toEqual(asString);
    expect(asNumber.ok).toBe(true);
  });

  it('name / picture 缺失時回空字串，不得 undefined', async () => {
    expect(await verifyWeb(await makeWebToken({ name: undefined, picture: undefined })))
      .toMatchObject({ ok: true, name: '', picture: '' });
  });
});

describe('LIFF / native 路徑（ES256 + 公鑰）', () => {
  it('ES256 token 以注入的公鑰驗證通過', async () => {
    const { token, publicKey } = await makeLiffToken();
    const res = await verifyLineIdToken(
      { idToken: token, channelId: CHANNEL_ID, channelSecret: CHANNEL_SECRET, nonce: NONCE },
      publicKey,
    );
    expect(res).toMatchObject({ ok: true, sub: SUB, alg: 'ES256' });
  });

  it('用別把金鑰驗 → signature', async () => {
    const { token } = await makeLiffToken();
    const other = await generateKeyPair('ES256');
    const res = await verifyLineIdToken(
      { idToken: token, channelId: CHANNEL_ID, channelSecret: CHANNEL_SECRET, nonce: NONCE },
      other.publicKey,
    );
    expect(res).toMatchObject({ ok: false, reason: 'signature' });
  });
});

describe('診斷資訊（教訓：錯誤要說「實際看到什麼」，不只說「我期望什麼」）', () => {
  it('失敗時回報 token 標頭實際宣告的演算法', async () => {
    const token = await makeWebToken({ aud: 'wrong' });
    expect(decodeProtectedHeader(token).alg).toBe('HS256'); // 確認 fixture 形狀
    const res = await verifyWeb(token);
    expect(res).toMatchObject({ ok: false, observedAlg: 'HS256' });
  });

  it('成功時也回報實際使用的演算法（可看出走了哪條路）', async () => {
    expect(await verifyWeb(await makeWebToken())).toMatchObject({ alg: 'HS256' });
  });

  it('token 格式無法解析 → signature，不 throw', async () => {
    expect(await verifyWeb('not-a-jwt')).toMatchObject({ ok: false, reason: 'signature' });
  });

  it('失敗結果不含 token 內容', async () => {
    const token = await makeWebToken({ aud: 'wrong' });
    expect(JSON.stringify(await verifyWeb(token))).not.toContain(token.slice(0, 20));
  });
});

describe('演算法白名單', () => {
  it('白名單外的演算法一律拒絕（含 alg confusion 防線）', async () => {
    // 用 RS256 簽一枚 token：即使簽章本身有效，也不得通過
    const { privateKey } = await generateKeyPair('RS256');
    const token = await sign(baseClaims(), 'RS256').sign(privateKey);
    const res = await verifyWeb(token);
    expect(res).toMatchObject({ ok: false, reason: 'signature', observedAlg: 'RS256' });
  });
});

describe('classifyVerifyError 分類順序', () => {
  it('具體類別不得被泛用 JOSEError 吃掉（繼承關係陷阱）', () => {
    const claimErr = new joseErrors.JWTClaimValidationFailed('aud mismatch', {}, 'aud');
    expect(claimErr).toBeInstanceOf(joseErrors.JOSEError);
    expect(classifyVerifyError(claimErr).reason).toBe('claims');
  });

  it('claims 的 detail 指出是哪個 claim（設定錯誤要能一眼看出）', () => {
    const err = new joseErrors.JWTClaimValidationFailed('aud mismatch', {}, 'aud');
    expect(classifyVerifyError(err).detail).toContain('aud');
  });

  it('演算法不被允許時，訊息列出兩種都接受（不再只寫 ES256）', () => {
    const d = classifyVerifyError(new joseErrors.JOSEAlgNotAllowed('x')).detail;
    expect(d).toContain('HS256');
    expect(d).toContain('ES256');
  });

  it('金鑰未命中 → signature；JWKS 逾時 → fetch', () => {
    expect(classifyVerifyError(new joseErrors.JWKSNoMatchingKey()).reason).toBe('signature');
    expect(classifyVerifyError(new joseErrors.JWKSTimeout()).reason).toBe('fetch');
  });

  it('網路層錯誤 → fetch', () => {
    expect(classifyVerifyError(new Error('fetch failed')).reason).toBe('fetch');
  });

  it('未知錯誤歸 internal，不得誤報為 fetch', () => {
    expect(classifyVerifyError({ weird: true }).reason).toBe('internal');
    expect(classifyVerifyError(new TypeError('audience must be a string')).reason).toBe('internal');
  });
});
