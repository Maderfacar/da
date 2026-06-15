import { describe, it, expect, beforeAll, vi } from 'vitest';
import { generateSync } from 'otplib';

const TEST_KEY = 'eb5f3a17262247f37768d4644ee577dea904c54c87e8874359d140b8af6321b6';

// 在 import totp.ts 前先 mock useRuntimeConfig（h3 auto-import 在 vitest 內未注入）
vi.stubGlobal('useRuntimeConfig', () => ({ totpEncKey: TEST_KEY }));

let encryptSecret: typeof import('./totp').encryptSecret;
let decryptSecret: typeof import('./totp').decryptSecret;
let verifyCode: typeof import('./totp').verifyCode;
let generateSecret: typeof import('./totp').generateSecret;
let buildOtpauthUrl: typeof import('./totp').buildOtpauthUrl;
let _resetKeyCacheForTest: typeof import('./totp')._resetKeyCacheForTest;

beforeAll(async () => {
  const mod = await import('./totp');
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
  verifyCode = mod.verifyCode;
  generateSecret = mod.generateSecret;
  buildOtpauthUrl = mod.buildOtpauthUrl;
  _resetKeyCacheForTest = mod._resetKeyCacheForTest;
});

describe('totp encrypt/decrypt', () => {
  it('round-trip 同字串', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const blob = encryptSecret(secret);
    expect(blob.split(':').length).toBe(3);
    expect(decryptSecret(blob)).toBe(secret);
  });

  it('每次 encrypt 用不同 IV → 同明文兩次 ciphertext 不同', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });

  it('blob 格式錯 → 拋錯', () => {
    expect(() => decryptSecret('not-a-blob')).toThrow();
  });

  it('竄改 authTag → 拋錯', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP');
    const [iv, tag, ct] = blob.split(':');
    const badTag = '0'.repeat(tag.length);
    expect(() => decryptSecret(`${iv}:${badTag}:${ct}`)).toThrow();
  });

  it('未設 key → encryptSecret 拋錯', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ totpEncKey: '' }));
    _resetKeyCacheForTest();
    expect(() => encryptSecret('x')).toThrow(/NUXT_TOTP_ENC_KEY/);
    // 還原給後續測試
    vi.stubGlobal('useRuntimeConfig', () => ({ totpEncKey: TEST_KEY }));
    _resetKeyCacheForTest();
  });
});

describe('totp verifyCode', () => {
  it('接受當下產生的 code', () => {
    const secret = generateSecret();
    const code = generateSync({ strategy: 'totp', secret });
    expect(verifyCode(secret, code)).toBe(true);
  });

  it('容許 ±1 step 漂移', () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000);
    // 模擬上一個 step 的 code（epoch 在過去 30s）
    const prevStepCode = generateSync({ strategy: 'totp', secret, epoch: now - 30 });
    expect(verifyCode(secret, prevStepCode)).toBe(true);
  });

  it('拒絕 ±5 step 之外的舊 code', () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000);
    const oldCode = generateSync({ strategy: 'totp', secret, epoch: now - 5 * 30 });
    expect(verifyCode(secret, oldCode)).toBe(false);
  });

  it('拒絕格式錯的 code（非 6 位數）', () => {
    const secret = generateSecret();
    expect(verifyCode(secret, '12345')).toBe(false);
    expect(verifyCode(secret, '1234567')).toBe(false);
    expect(verifyCode(secret, 'abcdef')).toBe(false);
    expect(verifyCode(secret, '')).toBe(false);
  });

  it('拒絕完全不對的 code', () => {
    const secret = generateSecret();
    expect(verifyCode(secret, '000000')).toBe(false);
  });
});

describe('buildOtpauthUrl', () => {
  it('包含 issuer / displayName / secret', () => {
    const url = buildOtpauthUrl('JBSWY3DPEHPK3PXP', 'super-admin');
    expect(url).toMatch(/^otpauth:\/\/totp\/DestinationAnywhere:/);
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(url).toContain('issuer=DestinationAnywhere');
  });

  it('displayName URL encode（含特殊字元）', () => {
    const url = buildOtpauthUrl('JBSWY3DPEHPK3PXP', 'a b@c');
    expect(url).toContain('a%20b%40c');
  });

  it('空 displayName fallback admin', () => {
    const url = buildOtpauthUrl('JBSWY3DPEHPK3PXP', '');
    expect(url).toContain('DestinationAnywhere:admin');
  });
});
