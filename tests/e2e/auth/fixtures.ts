import { test as base, expect, type Page } from '@playwright/test';

// 5 種登入身份（+anonymous 對應未登入場景，Tier A 已涵蓋大部分）
// fixture 與 app/plugins/auth.client.ts 內 `isMockMode` 分支配合：
//   - window.__E2E_MODE__ = true → plugin 跳過 LIFF / Firebase init
//   - window.__E2E_ROLES__ = ['passenger'|'driver'|'admin', ...] → MockSignIn 角色
//   - window.__E2E_PATCH__ = { approved?, admin2faEnrolled?, admin2faSessionVerified? }
//
// 風險共用：與既有 testMode='T' 後門共用同一道閘；prod 不該有人注入 window.__E2E_MODE__
export type Identity =
  | 'passenger'
  | 'driverApproved'
  | 'driverPending'
  | 'adminNo2fa'
  | 'adminEnrolledNoSession'
  | 'adminWith2fa'
  // 2026-08-17：司機 OA 進站閃 500 的回報者身分 —— passenger + driver + admin 三合一。
  // 既有 6 種身分全是單一角色，完全涵蓋不到多重身分的分流路徑（正是出事的那條）。
  | 'multiRoleDriverAdmin';

type IdentityPayload = {
  roles: ('passenger' | 'driver' | 'admin')[];
  patch: {
    approved?: boolean;
    admin2faEnrolled?: boolean;
    admin2faSessionVerified?: boolean;
  };
  // localStorage 預塞（如 admin 2FA session token）
  localStorage?: Record<string, string>;
};

const IDENTITIES: Readonly<Record<Identity, IdentityPayload>> = {
  passenger: {
    roles: ['passenger'],
    patch: { approved: true },
  },
  driverApproved: {
    roles: ['driver'],
    patch: { approved: true },
  },
  driverPending: {
    roles: ['driver'],
    patch: { approved: false },
  },
  adminNo2fa: {
    roles: ['admin'],
    patch: { approved: true, admin2faEnrolled: false, admin2faSessionVerified: false },
  },
  adminEnrolledNoSession: {
    // 已綁 TOTP secret 但今天 session 過期 — 每天首次進 admin 的最常見場景
    roles: ['admin'],
    patch: { approved: true, admin2faEnrolled: true, admin2faSessionVerified: false },
  },
  adminWith2fa: {
    roles: ['admin'],
    patch: { approved: true, admin2faEnrolled: true, admin2faSessionVerified: true },
    localStorage: { da_admin_2fa_session: 'e2e-mock-2fa-session-token' },
  },
  multiRoleDriverAdmin: {
    roles: ['passenger', 'driver', 'admin'],
    patch: { approved: true, admin2faEnrolled: true, admin2faSessionVerified: true },
    localStorage: { da_admin_2fa_session: 'e2e-mock-2fa-session-token' },
  },
};

// API mock 路由表 — 大部分 endpoint 對 e2e 來說只要回 envelope code=200 即可
// 個別 endpoint 需要不同 response 時，spec 內可用 page.route() 覆蓋（後註冊優先）
const MOCK_RESPONSES: Readonly<Record<string, (identity: Identity) => unknown>> = {
  // 後端 fallback envelope 格式（與 server/utils/response.ts 對齊）
  '/nuxt-api/announcements/unread-count': () => ({
    data: { unread: 0 },
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  }),
  '/nuxt-api/orders/upcoming': () => ({
    data: null,
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  }),
  // 季節主題：必須回「結構完整」的 ResolvedTheme。
  // 用萬用的 { data: {} } 會讓 buildThemeCss 取 tokens[key] / hero.stripeYellow 時炸掉，
  // 整個乘客 / 行銷 layout 變 500 —— 那是 fixture 造成的假陽性，會蓋掉真正要找的錯誤。
  // 內容對齊 prod GET /nuxt-api/config/theme 的實際回應。
  '/nuxt-api/config/theme': () => ({
    data: {
      activeThemeId: 'default',
      name: { zh: '經典（預設）', en: 'Classic (Default)', ja: 'クラシック（既定）' },
      // 色值必須與 shared/site-theme.ts 的 DEFAULT_TOKENS 一致。
      // 這是色票的**第四個同步點**（另三個：_theme-colors.css / shared/site-theme.ts /
      // prod Firestore site_themes）。不同步的話，乘客端 e2e 與視覺基線會拍到舊色，
      // 而 admin/driver 拍到新色 —— 是 fixture 造成的假象，不是真的破圖。
      tokens: {
        'da-cream': '#EAE7E0', 'da-off-white': '#F5F3EE', 'da-amber': '#7E6330',
        'da-amber-light': '#C9A961', 'da-amber-pale': '#F0E8D6', 'da-dark': '#1A1917',
        'da-dark-mid': '#26241F', 'da-gray': '#6D6A62', 'da-gray-light': '#868073',
        'da-gray-pale': '#D6D1C7', 'da-stripe-yellow': '#B79A5E', 'da-stripe-dark': '#26241F',
      },
      // 深色盤同樣是同步點：不同步的話，深色模式的視覺基線會拍到跟 prod 不同的顏色。
      tokensDark: {
        'da-cream': '#121110', 'da-off-white': '#1C1A18', 'da-amber': '#C9A961',
        'da-amber-light': '#DCC188', 'da-amber-pale': '#2B2519', 'da-dark': '#EDEAE3',
        'da-dark-mid': '#C6C1B7', 'da-gray': '#A29D93', 'da-gray-light': '#7E7A71',
        'da-gray-pale': '#34312C', 'da-stripe-yellow': '#6E5C36', 'da-stripe-dark': '#171613',
      },
      hero: { stripeYellow: '#B79A5E', stripeDark: '#26241F', tagColor: '#7E6330' },
    },
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  }),
  // 回陣列的列表端點：萬用 { data: {} } 會讓頁面的 orders.value.filter(...) 炸掉，
  // 同樣是 fixture 造成的假陽性。凡 consumer 預期陣列者一律回 []。
  '/nuxt-api/driver/dispatched-orders': () => ({
    data: [], status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  }),
  '/nuxt-api/orders/assigned': () => ({
    data: [], status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  }),
  '/nuxt-api/orders/history': () => ({
    data: [], status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  }),
  '/nuxt-api/driver/announcements': () => ({
    data: [], status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  }),
  // Admin 總覽：頁面直接讀 summary.orderCounts.pendingConfirm，萬用 { data: {} } 會炸
  // （TypeError: Cannot read properties of undefined）。形狀對齊
  // app/protocol/fetch-api/api/admin/dashboard/type.d.ts 的 DashboardSummaryRes。
  '/nuxt-api/admin/dashboard/summary': () => ({
    data: {
      passengers: { count: 0, list: [] },
      drivers: { count: 0, list: [] },
      orderCounts: { pendingConfirm: 0, inProgress: 0 },
      discountCodes: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
    status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
  }),
  '/nuxt-api/admin/2fa/session-check': (identity) => ({
    data: {},
    status: {
      code: identity === 'adminWith2fa' ? 200 : 401,
      message: { zh_tw: '', en: '', ja: '' },
    },
  }),
};

const DEFAULT_RESPONSE = {
  data: {},
  status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
};

async function installAuthMocks(page: Page, identity: Identity): Promise<void> {
  const payload = IDENTITIES[identity];

  // Step 1：plugin boot 前注入 window flag + localStorage
  // addInitScript 在每個 navigation 都會跑，spec 內 page.goto 後 reload / 跨頁都生效
  await page.addInitScript((args) => {
    const w = window as unknown as Record<string, unknown>;
    w.__E2E_MODE__ = true;
    w.__E2E_ROLES__ = args.roles;
    w.__E2E_PATCH__ = args.patch;
    if (args.localStorage) {
      for (const [k, v] of Object.entries(args.localStorage)) {
        try { localStorage.setItem(k, v); } catch { /* 隱私模式 fixture 不模擬 */ }
      }
    }
  }, { roles: payload.roles, patch: payload.patch, localStorage: payload.localStorage ?? null });

  // Step 2：攔截所有 /nuxt-api/* 餵假 response
  // 個別 spec 若需要特殊 response（401 模擬、5s timeout 模擬）可在 spec 內 page.route 覆蓋
  await page.route('**/nuxt-api/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const matched = Object.keys(MOCK_RESPONSES).find((key) => pathname.includes(key));
    const body = matched ? MOCK_RESPONSES[matched](identity) : DEFAULT_RESPONSE;
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body),
    });
  });

  // Step 3：攔 Firebase / Google 認證相關 API
  // plugin 在 isMockMode 為 true 時已 return 不跑 InitAuthFlow，但 safety net 攔截避免任何
  // 漏網 SDK 啟動（例如未來改 import 結構）打真實 API。abort 比 fulfill 簡單，反正不用回真實內容
  await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
  await page.route('**/securetoken.googleapis.com/**', (route) => route.abort());
  await page.route('**/firestore.googleapis.com/**', (route) => route.abort());
}

export type AuthFixtures = {
  loginAs: (identity: Identity) => Promise<void>;
};

export const test = base.extend<AuthFixtures>({
  loginAs: async ({ page }, use) => {
    // caller 必須在 page.goto 之前呼叫 loginAs；plugin boot 只發生在第一次導航
    await use((identity) => installAuthMocks(page, identity));
  },
});

// 直接 re-export expect 方便 spec import 一個來源
export { expect };

// 共用 helper：偵測 redirect 軌跡（後續 spec 用來判斷是否被踢去 /login）
export async function trackNavigations(page: Page): Promise<{ visited: string[] }> {
  const visited: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url());
  });
  return { visited };
}
