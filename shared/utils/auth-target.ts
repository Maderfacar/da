// 認證後分流目標解析（SSOT）
//
// 依入口 path + 使用者角色狀態，算出已登入 user 應被導去的目標 path。
// 同時被 middleware/role.ts 與 PageIndex / PageLogin / PageDriverAuth 引用，
// 避免分流邏輯散落在 page watch / middleware 兩處漂移。
//
// 入口分流策略（W2）：
//
//   1. `/driver/auth`（司機端公開登入入口）
//      - approved driver  → /driver/dashboard
//      - admin（不含 driver）→ /admin/orders
//      - driver pending / rejected / 純 passenger / roles=[] → /driver/register
//        （讓 register 頁顯示對應流程：申請 / pending / rejected 訊息）
//
//   2. `/` 或 `/login`（乘客端入口）
//      - roles=[]                       → /login（edge case — 已 sign in 但 role 載入失敗 / Firestore 阻擋）
//      - entryEnd='driver' 且 approved  → /driver/dashboard（司機 OA 進站，見 entryEnd 說明）
//      - 其他一律                        → /home
//
//      ⚠ 2026-08-29：拿掉「多角色時 admin 優先」與「approved driver 優先」兩條。
//
//      原本的規則是**用角色決定端別**：只要身上有 admin，不管你怎麼進來的，一律丟去
//      /admin/orders。實際後果是「在網址列打 https://…/ 卻跳到 /admin」——
//      使用者明明指定了乘客端的網址，系統用他的身分把他的選擇蓋掉。
//
//      正確的模型是**用入口決定端別，不是用角色**：
//        - `/` 與 `/login` 是**乘客端**的入口 → 落點就是乘客端 /home
//        - 司機端有自己的入口（`/driver/auth`、司機 OA richmenu）
//        - Admin 端有自己的入口（`/admin/*`），而且乘客端頂欄常駐一顆 ADMIN 鈕
//          （CommonHeaderUser 規則 1），要過去是一個點擊的事，不需要被強制帶過去
//        - LIFF 深連結另有 liffTarget 走 resolveDestination，不受這條影響
//
//      entryEnd='driver' 那條保留：司機 OA 的 LIFF endpoint 也是 `/`，
//      path 本身分不出端別，只能靠 entry-intent 記下的來源（見 2026-08-17 那次事故）。

export interface AuthTargetInput {
  entryPath: string;
  isSignIn: boolean;
  roles: readonly string[];
  approved: boolean;
  /**
   * 進站端別（司機 OA / 乘客 OA）。有值時優先於「多重身分 admin 優先」的預設。
   *
   * 為何需要：`/` 只說明「落在哪個 path」，說明不了「從哪個 OA 進來」。多重身分者
   * （admin + approved driver）從司機 OA 的 richmenu 進站也會落在 `/`，若只看 path
   * 就會被 admin 優先規則丟去 /admin/orders。來源見 shared/auth/entry-intent.ts。
   */
  entryEnd?: 'driver' | 'passenger';
}

// i18n 是 prefix_except_default：預設繁中無前綴，英日是 /en、/ja。
//
// 2026-08-29：入口比對前先剝語系前綴。在此之前 `/en` 與 `/ja/login` 都**不算入口**，
// 於是英日語系的已登入使用者打首頁完全不會被分流 —— 停在行銷 landing 上。
// 本機瀏覽器是 zh-TW 所以一直沒人踩到；是新增的 e2e（Playwright 預設 en-US）抓出來的。
// 剝掉之後目標也要把前綴接回去，否則英日使用者會被順手切回中文。
const LOCALE_PREFIX_PATTERN = /^\/(?:en|ja)(?=\/|$)/;

function _localePrefixOf(path: string): string {
  return path.match(LOCALE_PREFIX_PATTERN)?.[0] ?? '';
}

function _stripLocale(path: string): string {
  const stripped = path.replace(LOCALE_PREFIX_PATTERN, '');
  return stripped === '' ? '/' : stripped;
}

function _isDriverAuthEntry(path: string): boolean {
  const p = _stripLocale(path);
  return p === '/driver/auth' || p.startsWith('/driver/auth/');
}

function _isPassengerEntry(path: string): boolean {
  const p = _stripLocale(path);
  return p === '/' || p === '/login' || p === '/login/';
}

export function isLoginEntry(path: string): boolean {
  return _isPassengerEntry(path) || _isDriverAuthEntry(path);
}

/**
 * 判斷已登入 user 是否有權進入 target path（W2：login-entry 深連結授權校驗）。
 *
 * 用途：LIFF 深連結 `liff.state` 把目標塞進 URL，但 SDK 不驗身分。若目標是 `/driver/*`
 * 或 `/admin/*` 而 user 無對應角色，過去 role.ts 會盲目導過去 → 被守衛彈回 → 無限迴圈。
 * 導向前先用本函式校驗，未授權就不進，改走 resolveAuthTarget 的授權落點。
 *
 * 規則（與 middleware/role guard 對齊）：
 *   - /driver/auth、/driver/register：公開司機入口，任何已登入者可進
 *   - 其餘 /driver/*：需 driver role 且 approved
 *   - /admin/2fa/*：永遠放行（避免自鎖）
 *   - 其餘 /admin/*：需 admin role
 *   - 其他（乘客頁）：任何已登入者可進
 */
export function isPathAuthorized(path: string, roles: readonly string[], approved: boolean): boolean {
  if (_isDriverAuthEntry(path)) return true;
  if (path === '/driver/register' || path.startsWith('/driver/register/')) return true;
  if (path.startsWith('/driver')) return roles.includes('driver') && approved;
  if (path.startsWith('/admin/2fa')) return true;
  if (path.startsWith('/admin')) return roles.includes('admin');
  return true;
}

export interface DestinationInput extends AuthTargetInput {
  /** LIFF 深連結解析出的目標 path（resolveLiffTarget 的結果）；無則空字串 */
  liffTarget: string;
}

/**
 * login-entry 的最終導向目的地（W2 單一 SSOT，middleware/role 與登入頁共用）。
 *
 * 邏輯：
 *   1. 未登入 → 空字串（顯示登入按鈕）
 *   2. 有深連結目標且「該 user 有權進入」→ 用深連結目標（正常司機/乘客深連結）
 *   3. 否則 → resolveAuthTarget 的授權落點（未授權深連結會落 register/home，不進去對踢）
 */
export function resolveDestination(input: DestinationInput): string {
  if (!input.isSignIn) return '';

  const { liffTarget, entryPath, roles, approved } = input;
  if (liffTarget && liffTarget !== entryPath && isPathAuthorized(liffTarget, roles, approved)) {
    return liffTarget;
  }

  return resolveAuthTarget({
    entryPath,
    isSignIn: input.isSignIn,
    roles,
    approved,
    entryEnd: input.entryEnd,
  });
}

export function resolveAuthTarget(input: AuthTargetInput): string {
  if (!input.isSignIn) return '';

  const hasDriver = input.roles.includes('driver');
  const hasAdmin = input.roles.includes('admin');
  const driverApproved = hasDriver && input.approved;
  // 進站帶什麼語系，就用什麼語系落地（英日使用者不該被順手切回中文）
  const prefix = _localePrefixOf(input.entryPath);
  const withLocale = (target: string): string => `${prefix}${target}`;

  if (_isDriverAuthEntry(input.entryPath)) {
    if (driverApproved) return withLocale('/driver/dashboard');
    if (hasAdmin && !hasDriver) return withLocale('/admin/orders');
    return withLocale('/driver/register');
  }

  if (_isPassengerEntry(input.entryPath)) {
    if (input.roles.length === 0) return withLocale('/login');
    // 唯一的例外：司機 OA 的 LIFF endpoint 也是 `/`，path 分不出端別，靠 entry-intent 補。
    if (input.entryEnd === 'driver' && driverApproved) return withLocale('/driver/dashboard');
    // 其餘一律回乘客端 —— 入口決定端別，不是角色決定端別（見檔頭 2026-08-29 段落）。
    return withLocale('/home');
  }

  return '';
}
