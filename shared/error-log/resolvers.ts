// Client Error Log — 純函式 helpers（可獨立測試，無 Nuxt runtime 依賴）

export type EndKind = 'passenger' | 'driver' | 'admin';

/** 從 path 推導三端歸屬：`/admin*` → admin、`/driver*` → driver、其餘 passenger */
export const resolveEnd = (path: string): EndKind => {
  if (typeof path !== 'string') return 'passenger';
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/driver')) return 'driver';
  return 'passenger';
};

/** 7 字元 a-z0-9 random id；不引 nanoid 依賴 */
export const generateSessionId = (): string => Math.random().toString(36).slice(2, 9);

/** 字串截斷；非字串回空字串，避免下游 Firestore 寫入時遇 undefined */
export const clipString = (v: unknown, max: number): string => {
  if (typeof v !== 'string') return '';
  return v.length <= max ? v : v.slice(0, max);
};

/** metadata 整包 stringify 後是否超過 byteCap（防爆，5KB 上限） */
export const isMetadataTooLarge = (m: unknown, byteCap: number): boolean => {
  if (!m || typeof m !== 'object') return false;
  try {
    const s = JSON.stringify(m);
    return typeof s === 'string' && s.length > byteCap;
  } catch {
    // circular / unserializable → 視為過大，下游 drop
    return true;
  }
};
