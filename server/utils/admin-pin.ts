/**
 * Admin 敏感操作 PIN — 4-8 位純數字；bcrypt rounds=10。
 *
 * 用途：對 3 個最高敏感 endpoint（廣播 / 加減 admin role / fare rules 寫入）做二次確認。
 *   - 不取代 TOTP 第二因子（TOTP session 仍然必要）
 *   - 屬 step-up auth 模式：在已驗 TOTP session 之上多一道 5 分鐘短期 PIN session
 */
import bcrypt from 'bcryptjs';

const PIN_REGEX = /^\d{4,8}$/;
const BCRYPT_ROUNDS = 10;

/** PIN 格式驗證（純數字 4-8 位） */
export function validatePinFormat(pin: unknown): boolean {
  return typeof pin === 'string' && PIN_REGEX.test(pin);
}

/** bcrypt hash（cost=10） */
export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

/** bcrypt compare；任何錯誤一律回 false（never throw） */
export async function comparePin(pin: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pin, hash);
  } catch {
    return false;
  }
}
