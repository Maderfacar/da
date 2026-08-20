import { describe, it, expect } from 'vitest';
import { SignJWT, generateKeyPair, jwtVerify, errors as joseErrors } from 'jose';
import {
  verifyLineIdToken,
  classifyVerifyError,
  LINE_ISSUER,
  LINE_ID_TOKEN_ALG,
  LINE_JWKS_URL,
} from './line-id-token';

const CHANNEL_ID = '2009509209';
const NONCE = 'nonce-abc-123';

/** 用自簽 ES256 金鑰組出一枚 LINE 形狀的 id_token（不打真實網路）。 */
async function makeToken(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = await generateKeyPair(LINE_ID_TOKEN_ALG);
  const claims = {
    nonce: NONCE,
    name: '測試使用者',
    picture: 'https://profile.line-scdn.net/xxx',
    ...overrides,
  };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: LINE_ID_TOKEN_ALG })
    .setIssuer((overrides.iss as string) ?? LINE_ISSUER)
    .setAudience((overrides.aud as string) ?? CHANNEL_ID)
    .setSubject((overrides.sub as string) ?? 'U3727e111e915d4199f75e30fda2a0d79')
    .setIssuedAt()
    .setExpirationTime((overrides.exp as string) ?? '5m')
    .sign(privateKey);
  return { token, publicKey };
}

describe('常數與 LINE discovery 對齊', () => {
  it('issuer / jwks / alg 與 LINE 實際宣告一致', () => {
    // 2026-08-20 實測 https://access.line.me/.well-known/openid-configuration
    expect(LINE_ISSUER).toBe('https://access.line.me');
    expect(LINE_JWKS_URL).toBe('https://api.line.me/oauth2/v2.1/certs');
    expect(LINE_ID_TOKEN_ALG).toBe('ES256'); // discovery 只宣告這一種
  });
});

describe('verifyLineIdToken（注入本地金鑰，驗完整流程不打網路）', () => {
  it('合法 token 通過並取出 sub / name / picture', async () => {
    const { token, publicKey } = await makeToken();
    const res = await verifyLineIdToken({ idToken: token, channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    expect(res).toMatchObject({
      ok: true,
      sub: 'U3727e111e915d4199f75e30fda2a0d79',
      name: '測試使用者',
      picture: 'https://profile.line-scdn.net/xxx',
    });
  });

  it('迴歸：aud 不符必須失敗並歸類 claims（2026-08-19 炸的就是這個比對）', async () => {
    const { token, publicKey } = await makeToken({ aud: '9999999999' });
    const res = await verifyLineIdToken({ idToken: token, channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    expect(res).toMatchObject({ ok: false, reason: 'claims' });
  });

  it('迴歸：channelId 傳 number（destr 型別陷阱）行為必須與字串完全一致', async () => {
    const { token, publicKey } = await makeToken();
    const asString = await verifyLineIdToken({ idToken: token, channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    const asNumber = await verifyLineIdToken(
      { idToken: token, channelId: Number(CHANNEL_ID), nonce: NONCE },
      publicKey,
    );
    expect(asNumber).toEqual(asString);
    expect(asNumber.ok).toBe(true); // 型別不同不得讓驗證失敗，也不得讓不符者通過
  });

  it('channelId 為空 → claims，不得靜默放行', async () => {
    const { token, publicKey } = await makeToken();
    const res = await verifyLineIdToken({ idToken: token, channelId: '', nonce: NONCE }, publicKey);
    expect(res).toMatchObject({ ok: false, reason: 'claims' });
  });

  it('iss 不符 → claims', async () => {
    const { token, publicKey } = await makeToken({ iss: 'https://evil.example.com' });
    const res = await verifyLineIdToken({ idToken: token, channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    expect(res).toMatchObject({ ok: false, reason: 'claims' });
  });

  it('已過期 → claims', async () => {
    const { token, publicKey } = await makeToken({ exp: '-1m' });
    const res = await verifyLineIdToken({ idToken: token, channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    expect(res).toMatchObject({ ok: false, reason: 'claims' });
  });

  it('用別把金鑰簽的 token → signature', async () => {
    const { token } = await makeToken();
    const other = await generateKeyPair(LINE_ID_TOKEN_ALG);
    const res = await verifyLineIdToken(
      { idToken: token, channelId: CHANNEL_ID, nonce: NONCE },
      other.publicKey,
    );
    expect(res).toMatchObject({ ok: false, reason: 'signature' });
  });

  it('nonce 不符 → nonce（replay 防護）', async () => {
    const { token, publicKey } = await makeToken();
    const res = await verifyLineIdToken(
      { idToken: token, channelId: CHANNEL_ID, nonce: 'different-nonce' },
      publicKey,
    );
    expect(res).toMatchObject({ ok: false, reason: 'nonce' });
  });

  it('token 缺 nonce → nonce', async () => {
    const { token, publicKey } = await makeToken({ nonce: undefined });
    const res = await verifyLineIdToken({ idToken: token, channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    expect(res).toMatchObject({ ok: false, reason: 'nonce' });
  });

  it('token 格式壞 → 不 throw，回結構化失敗', async () => {
    const { publicKey } = await makeToken();
    const res = await verifyLineIdToken({ idToken: 'not-a-jwt', channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    expect(res.ok).toBe(false);
  });

  it('name / picture 缺失時回空字串，不得 undefined', async () => {
    const { token, publicKey } = await makeToken({ name: undefined, picture: undefined });
    const res = await verifyLineIdToken({ idToken: token, channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    expect(res).toMatchObject({ ok: true, name: '', picture: '' });
  });

  it('失敗結果不含 token 內容', async () => {
    const { token, publicKey } = await makeToken({ aud: 'wrong' });
    const res = await verifyLineIdToken({ idToken: token, channelId: CHANNEL_ID, nonce: NONCE }, publicKey);
    expect(JSON.stringify(res)).not.toContain(token.slice(0, 20));
  });
});

describe('classifyVerifyError 分類順序', () => {
  it('具體類別不得被泛用 JOSEError 吃掉（繼承關係陷阱）', () => {
    const claimErr = new joseErrors.JWTClaimValidationFailed('aud mismatch', {}, 'aud');
    expect(claimErr).toBeInstanceOf(joseErrors.JOSEError); // 確認繼承關係存在
    expect(classifyVerifyError(claimErr).reason).toBe('claims'); // 仍須歸為 claims
  });

  it('claims 的 detail 指出是哪個 claim（設定錯誤要能一眼看出）', () => {
    const err = new joseErrors.JWTClaimValidationFailed('aud mismatch', {}, 'aud');
    expect(classifyVerifyError(err).detail).toContain('aud');
  });

  it('金鑰未命中 → signature（金鑰輪替未追上的症狀）', () => {
    expect(classifyVerifyError(new joseErrors.JWKSNoMatchingKey()).reason).toBe('signature');
  });

  it('演算法不被允許 → signature', () => {
    expect(classifyVerifyError(new joseErrors.JOSEAlgNotAllowed('alg not allowed')).reason).toBe('signature');
  });

  it('JWKS 逾時 → fetch', () => {
    expect(classifyVerifyError(new joseErrors.JWKSTimeout()).reason).toBe('fetch');
  });

  it('網路層錯誤 → fetch', () => {
    expect(classifyVerifyError(new Error('fetch failed')).reason).toBe('fetch');
    expect(classifyVerifyError(new TypeError('network error')).reason).toBe('fetch');
  });

  it('未知錯誤歸 internal，不得誤報為 fetch（否則設定型別錯會被當成網路問題）', () => {
    expect(classifyVerifyError({ weird: true }).reason).toBe('internal');
    expect(classifyVerifyError(new TypeError('audience must be a string')).reason).toBe('internal');
  });

  it('detail 不含 token 內容', () => {
    const err = new joseErrors.JWTClaimValidationFailed('aud mismatch', {}, 'aud');
    expect(classifyVerifyError(err).detail).not.toContain('eyJ');
  });
});
