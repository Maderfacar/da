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
  | 'adminWith2fa';

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
