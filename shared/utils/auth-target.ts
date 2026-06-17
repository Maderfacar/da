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
//      - roles=[]         → /login（edge case — 已 sign in 但 role 載入失敗 / Firestore 阻擋）
//      - admin            → /admin/orders（多角色時 admin 優先）
//      - approved driver  → /driver/dashboard
//      - 其他（passenger / pending driver）→ /home

export interface AuthTargetInput {
  entryPath: string;
  isSignIn: boolean;
  roles: readonly string[];
  approved: boolean;
}

function _isDriverAuthEntry(path: string): boolean {
  return path === '/driver/auth' || path.startsWith('/driver/auth/');
}

function _isPassengerEntry(path: string): boolean {
  return path === '/' || path === '/login' || path === '/login/';
}

export function isLoginEntry(path: string): boolean {
  return _isPassengerEntry(path) || _isDriverAuthEntry(path);
}

export function resolveAuthTarget(input: AuthTargetInput): string {
  if (!input.isSignIn) return '';

  const hasDriver = input.roles.includes('driver');
  const hasAdmin = input.roles.includes('admin');
  const driverApproved = hasDriver && input.approved;

  if (_isDriverAuthEntry(input.entryPath)) {
    if (driverApproved) return '/driver/dashboard';
    if (hasAdmin && !hasDriver) return '/admin/orders';
    return '/driver/register';
  }

  if (_isPassengerEntry(input.entryPath)) {
    if (input.roles.length === 0) return '/login';
    if (hasAdmin) return '/admin/orders';
    if (driverApproved) return '/driver/dashboard';
    return '/home';
  }

  return '';
}
