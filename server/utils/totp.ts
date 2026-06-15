/**
 * Admin 端 TOTP（RFC 6238）helper
 *
 * 用途：在 admins/{uid}.totpSecret 內存加密的 base32 secret；
 *      verify-enrollment / verify-login 把使用者輸入的 6 位數對該 secret 驗證。
 *
 * 加密格式：AES-256-GCM 信封；blob = `iv:authTag:ciphertext`（皆 hex）。
 *   - key 從 env NUXT_TOTP_ENC_KEY 取，要求 64 hex char（= 32 bytes）。
 *   - 缺 key 或長度錯 → 拋錯（service account 已 fail-closed，admin 端寧停勿放）。
 *
 * verifyCode：otplib v13 functional API；epochTolerance=30s（容許 ±1 step / ±30s 時鐘漂移）。
 */
import { generateSecret as _genSecret, verifySync } from 'otplib';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM 標準 12 bytes
const KEY_LEN = 32;
const EPOCH_TOLERANCE_SEC = 30; // ±1 step（30s window）

let _cachedKey: Buffer | null = null;
function _getKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const raw = useRuntimeConfig().totpEncKey;
  if (typeof raw !== 'string' || raw.length !== KEY_LEN * 2) {
    throw new Error('NUXT_TOTP_ENC_KEY 必須為 64 字元 hex（= 32 bytes AES-256 key）');
  }
  _cachedKey = Buffer.from(raw, 'hex');
  if (_cachedKey.length !== KEY_LEN) {
    throw new Error('NUXT_TOTP_ENC_KEY 解碼後長度錯誤');
  }
  return _cachedKey;
}

/** 產生新的 base32 secret（給 setup-enrollment 用） */
export function generateSecret(): string {
  return _genSecret({ length: 20 });
}

/** 將 base32 secret 加密為信封 blob（`iv:authTag:ciphertext` hex） */
export function encryptSecret(secret: string): string {
  const key = _getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/** 解密信封 blob 回 base32 secret；blob 無效 → 拋錯 */
export function decryptSecret(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 3) throw new Error('totp blob 格式錯誤');
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ctHex, 'hex');
  const decipher = createDecipheriv(ALGO, _getKey(), iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

/** 驗證 6 位數 TOTP；容許 ±1 step（±30s） */
export function verifyCode(secret: string, code: string): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  try {
    const result = verifySync({
      strategy: 'totp',
      token: code,
      secret,
      epochTolerance: EPOCH_TOLERANCE_SEC,
    });
    // otplib v13 回 { valid: boolean }（OTPResult wrapped），統一抽 .valid
    return !!(result as { valid?: boolean } | boolean) && (typeof result === 'boolean' ? result : !!result.valid);
  } catch {
    return false;
  }
}

/** 組裝 otpauth URI（authenticator 掃 QR 用） */
export function buildOtpauthUrl(secret: string, displayName: string): string {
  const issuer = 'DestinationAnywhere';
  const safeName = encodeURIComponent(displayName || 'admin');
  return `otpauth://totp/${issuer}:${safeName}?secret=${secret}&issuer=${issuer}`;
}

/** 測試 hook：清快取 key（讓 spec 改 env var 後重讀） */
export function _resetKeyCacheForTest(): void {
  _cachedKey = null;
}
