// W4（2026-06-18）：純函式 — 依當前 path 決定 middleware/role 該 await 哪些 Ensure*。
// 不執行任何 IO；只回 boolean 旗標。實際 EnsureXxxLoaded 由 middleware/role 呼叫。
//
// 設計原則：
//   - 公開頁全 false（middleware/auth 已放行，不進 middleware/role；冗餘設計求純函式自洽）
//   - login entry（/、/login、/driver/auth）需 users 才能算分流 target
//   - /driver/register 需 users（檢查 approved driver 該不該跳 dashboard）
//   - /driver/* 受保護頁需 users + drivers
//   - /admin/2fa/* 只需 users（避免 2FA gate 自我擋進迴圈）
//   - /admin/* 其他需 users + admins + 2FA session
//   - 其他受保護頁（/home /booking /orders 等）需 users
//   - 語系前綴 /en /ja 剝掉再判斷，三語一致
//
// 抽純函式的好處：
//   - 可獨立單測（不依賴 Pinia / Firebase / Nuxt runtime）
//   - middleware/role 內邏輯收斂為「拿 needs → 並發 await」，可讀性大幅提升
import { isPublicRoute } from '~shared/constants/auth-public-routes';

export interface RequiredLoads {
  user: boolean;
  driver: boolean;
  admin: boolean;
  admin2fa: boolean;
}

const LOCALE_PREFIX_PATTERN = /^\/(?:en|ja)(?=\/|$)/;
const NONE: RequiredLoads = Object.freeze({
  user: false, driver: false, admin: false, admin2fa: false,
}) as RequiredLoads;

export function resolveRequiredLoads(path: string): RequiredLoads {
  if (!path) return NONE;

  const stripped = (path.replace(LOCALE_PREFIX_PATTERN, '') || '/');

  // login entry — 「公開頁 + 已登入時需算分流 target」雙重身份；純函式回 worst-case
  // 注意 `/` 與 `/login` 同時是 isPublicRoute；提前判斷避免 NONE 短路
  // middleware/role 未登入時不會 reach EnsureUserDocLoaded（!isSignIn → 直接 return）
  if (stripped === '/' || stripped === '/login' || stripped.startsWith('/login/')) {
    return { user: true, driver: false, admin: false, admin2fa: false };
  }
  if (stripped === '/driver/auth' || stripped.startsWith('/driver/auth/')) {
    return { user: true, driver: false, admin: false, admin2fa: false };
  }

  if (isPublicRoute(stripped)) return NONE;

  // /driver/register — 需 users（檢查 approved driver 該不該跳 dashboard）
  if (stripped === '/driver/register' || stripped.startsWith('/driver/register/')) {
    return { user: true, driver: false, admin: false, admin2fa: false };
  }

  // /admin/2fa/* — 只 users（避免 2FA gate 迴圈）
  if (stripped.startsWith('/admin/2fa')) {
    return { user: true, driver: false, admin: false, admin2fa: false };
  }

  // /admin/* — users + admins + 2FA session
  if (stripped.startsWith('/admin')) {
    return { user: true, driver: false, admin: true, admin2fa: true };
  }

  // /driver/* — users + drivers
  if (stripped.startsWith('/driver')) {
    return { user: true, driver: true, admin: false, admin2fa: false };
  }

  // 其他受保護頁（passenger /home /booking /orders 等）— users
  return { user: true, driver: false, admin: false, admin2fa: false };
}
