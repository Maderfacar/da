/**
 * CSRF 同源判斷（純函式，便於單元測試；不依賴 h3 auto-import）。認證根治 Phase 0。
 *
 * 規則：只對 mutating（POST/PUT/PATCH/DELETE）且 /nuxt-api/* 的請求檢查：
 *   - 無 Origin header（server-to-server / LINE webhook）→ 放行（webhook 另有簽章驗證）
 *   - Origin 的 host 與請求 Host 不符（跨站）→ 擋
 *   - Origin 格式非法 → 擋
 * 用「同源比對」而非靜態白名單 → 自動適用 localhost / preview / 自定義網域 / prod，免硬編。
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isBlockedCrossOrigin(
  method: string,
  path: string,
  origin: string | undefined | null,
  host: string | undefined | null,
): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  if (!path.startsWith('/nuxt-api/')) return false;
  if (!origin) return false; // 無 Origin（非瀏覽器來源）→ 放行
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // Origin 格式非法 → 擋
  }
  if (!host) return false; // 無 Host header 無從比對（極罕見）→ 保守放行
  return originHost !== host; // 跨站 → 擋
}
