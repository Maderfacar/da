/**
 * 設定契約 — 所有環境變數的單一真相（config-contract-gate）
 *
 * **為什麼是 .mjs 而不是 .ts**：build gate 必須在 Nuxt 編譯「之前」以純 node 執行
 * （編譯完才發現設定錯就失去意義），而執行期健檢端點也要用同一份契約。
 * 兩份契約會漂移，而契約漂移正是這類 bug 的來源，所以寧可在此破例用 JS + JSDoc。
 *
 * **為什麼需要這份契約**：2026-08-19 手機瀏覽器登入 100% 失敗，根因是
 * `NUXT_LINE_LOGIN_CHANNEL_ID=2009509209` 被 Nitro 的 destr 轉成 number，
 * 而程式碼用 `as string` 斷言後直接與字串比對。當時專案對設定值的檢查是零。
 *
 * **kind 的意義**：
 *   - `numeric-id`  純數字但語意是字串（channel id / sender id）→ **destr 陷阱高危**，
 *                   讀取端一律須經 `configStr()`；build gate 會靜態掃描強制此事。
 *   - `json`        JSON 字串（destr 會自動 parse 成物件，消費端須容忍兩種型別）
 *   - `hex64`       64 個十六進位字元（AES-256 金鑰）
 *   - `url`         http(s) 起始
 *   - `secret`      憑證類，格式不拘但不可為空
 *   - `text`        自由文字
 *
 * **importance 的定線**：只有「缺了站台本來就是壞的」才是 `required`（硬擋部署）。
 * `.env.dev` 只有 23 個 key、缺 P29 雙 channel 那組，**不是 prod 的可靠鏡像**，
 * 因此無法查證的項目一律 `recommended`（警告不擋），待健檢端點回報 prod 實況後再升級。
 */

/**
 * @typedef {'required' | 'recommended' | 'optional'} Importance
 * @typedef {'numeric-id' | 'json' | 'hex64' | 'url' | 'secret' | 'text'} EnvKind
 * @typedef {'missing' | 'format' | 'type-hazard'} ProblemKind
 *
 * @typedef {object} EnvContract
 * @property {string} env             環境變數名
 * @property {string} path            對應的 runtimeConfig 路徑（`public.` 前綴代表公開設定）
 * @property {EnvKind} kind
 * @property {Importance} importance
 * @property {string} note            壞掉或缺失時會發生什麼
 *
 * @typedef {object} EnvIssue
 * @property {string} env
 * @property {string} path
 * @property {'error' | 'warn'} level
 * @property {ProblemKind} problem
 * @property {string} detail          可讀說明，**永不包含設定值**
 */

/** 各 kind 的格式規則。值為 null 代表只檢查非空。 */
const PATTERNS = {
  'numeric-id': /^\d+$/,
  hex64: /^[0-9a-fA-F]{64}$/,
  url: /^https?:\/\/\S+$/,
  json: null,
  secret: null,
  text: null,
};

/** @type {ReadonlyArray<EnvContract>} */
export const ENV_CONTRACTS = [
  // ── 核心：缺了站台本來就是壞的（硬擋部署不可能擋掉一個正常的部署）──────────
  {
    env: 'NUXT_FIREBASE_SERVICE_ACCOUNT_JSON',
    path: 'firebaseServiceAccountJson',
    kind: 'json',
    importance: 'required',
    note: '缺失則所有 server 端功能不可用（認證 / 訂單 / 通知）',
  },
  {
    env: 'NUXT_PUBLIC_FIREBASE_API_KEY',
    path: 'public.firebaseApiKey',
    kind: 'secret',
    importance: 'required',
    note: '缺失則 client 端完全無法認證',
  },
  {
    env: 'NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    path: 'public.firebaseAuthDomain',
    kind: 'text',
    importance: 'required',
    note: '缺失則 Firebase Auth 初始化失敗',
  },
  {
    env: 'NUXT_PUBLIC_FIREBASE_PROJECT_ID',
    path: 'public.firebaseProjectId',
    kind: 'text',
    importance: 'required',
    note: '缺失則 Firebase 初始化失敗',
  },
  {
    env: 'NUXT_PUBLIC_FIREBASE_APP_ID',
    path: 'public.firebaseAppId',
    kind: 'text',
    importance: 'required',
    note: '缺失則 Firebase 初始化失敗',
  },
  {
    env: 'NUXT_LINE_LOGIN_CHANNEL_ID',
    path: 'lineLoginChannelId',
    kind: 'numeric-id',
    importance: 'required',
    note: '瀏覽器登入的 OAuth client_id；型別錯會讓登入 100% 失敗（2026-08-19 事故）',
  },
  {
    env: 'NUXT_LINE_LOGIN_CHANNEL_SECRET',
    path: 'lineLoginChannelSecret',
    kind: 'secret',
    importance: 'required',
    note: '缺失則瀏覽器登入無法換 token',
  },
  {
    env: 'NUXT_PUBLIC_LINE_LIFF_ID_PASSENGER',
    path: 'public.lineLiffIdPassenger',
    kind: 'text',
    importance: 'required',
    note: '缺失則乘客 LIFF 進站失敗',
  },
  {
    env: 'NUXT_PUBLIC_LINE_LIFF_ID_DRIVER',
    path: 'public.lineLiffIdDriver',
    kind: 'text',
    importance: 'required',
    note: '缺失則司機 LIFF 進站失敗',
  },
  {
    env: 'NUXT_GOOGLE_MAPS_API_KEY',
    path: 'googleMapsApiKey',
    kind: 'secret',
    importance: 'required',
    note: '缺失則訂車流程算不出路線與車資',
  },
  {
    env: 'NUXT_TOTP_ENC_KEY',
    path: 'totpEncKey',
    kind: 'hex64',
    importance: 'required',
    note: 'admin 2FA secret 的 AES-256-GCM 金鑰；缺失或長度錯則後台全鎖',
  },

  // ── 無法查證 prod 狀態：警告不擋，待健檢端點回報後再升級（見 design.md）────
  {
    env: 'NUXT_LINE_CHANNEL_ID',
    path: 'lineChannelId',
    kind: 'numeric-id',
    importance: 'recommended',
    note: 'LIFF token 的跨 channel 防護；未設則該防護短路失效（承諾 2 Phase D）',
  },
  {
    env: 'NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    path: 'public.firebaseMessagingSenderId',
    kind: 'numeric-id',
    importance: 'recommended',
    note: '純數字，同屬 destr 型別陷阱高危群',
  },
  {
    env: 'NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    path: 'public.firebaseStorageBucket',
    kind: 'text',
    importance: 'recommended',
    note: '缺失則檔案上傳走預設 bucket',
  },
  {
    env: 'NUXT_LINE_CHANNEL_ACCESS_TOKEN_PASSENGER',
    path: 'lineChannelAccessTokenPassenger',
    kind: 'secret',
    importance: 'recommended',
    note: 'P29 乘客 OA 推播；缺失則乘客收不到 LINE 通知',
  },
  {
    env: 'NUXT_LINE_CHANNEL_SECRET_PASSENGER',
    path: 'lineChannelSecretPassenger',
    kind: 'secret',
    importance: 'recommended',
    note: 'P29 乘客 OA webhook 簽章驗證',
  },
  {
    env: 'NUXT_LINE_CHANNEL_ACCESS_TOKEN_DRIVER',
    path: 'lineChannelAccessTokenDriver',
    kind: 'secret',
    importance: 'recommended',
    note: 'P29 司機 OA 推播；缺失則司機收不到派單通知',
  },
  {
    env: 'NUXT_LINE_CHANNEL_SECRET_DRIVER',
    path: 'lineChannelSecretDriver',
    kind: 'secret',
    importance: 'recommended',
    note: 'P29 司機 OA webhook 簽章驗證',
  },
  {
    env: 'CRON_SECRET',
    path: 'cronSecret',
    kind: 'secret',
    importance: 'recommended',
    note: '未設則 cron 與健檢端點無保護；GitHub Actions 排程也需要同一值',
  },
  {
    env: 'NUXT_PUBLIC_SITE_URL',
    path: 'public.siteUrl',
    kind: 'url',
    importance: 'recommended',
    note: '登入 redirect_uri 與 SEO canonical 的來源；錯了會導致 redirect_uri 不符',
  },
  {
    env: 'NUXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY',
    path: 'public.googleMapsBrowserKey',
    kind: 'secret',
    importance: 'recommended',
    note: '缺失則前端地圖不顯示',
  },
  {
    env: 'NUXT_PUBLIC_LINE_OA_ADD_URL',
    path: 'public.lineOaAddUrl',
    kind: 'url',
    importance: 'optional',
    note: '加好友連結；缺失只影響引導',
  },
  {
    env: 'NUXT_PUBLIC_LINE_OA_ADD_URL_DRIVER',
    path: 'public.lineOaAddUrlDriver',
    kind: 'url',
    importance: 'optional',
    note: '司機 OA 加好友連結',
  },
  {
    env: 'NUXT_INTERNAL_API_KEY',
    path: 'internalApiKey',
    kind: 'secret',
    importance: 'optional',
    note: 'n8n 內部 API 認證',
  },
  {
    env: 'NUXT_CWA_API_KEY',
    path: 'cwaApiKey',
    kind: 'secret',
    importance: 'optional',
    note: '氣象資料；缺失則天氣功能降級',
  },
  {
    env: 'NUXT_AVIATION_EDGE_KEY',
    path: 'aviationEdgeKey',
    kind: 'secret',
    importance: 'optional',
    note: '航班時刻；缺失則航班查詢降級',
  },
  {
    env: 'NUXT_TDX_CLIENT_ID',
    path: 'tdxClientId',
    kind: 'secret',
    importance: 'optional',
    note: 'TDX 運輸資料',
  },
  {
    env: 'NUXT_TDX_CLIENT_SECRET',
    path: 'tdxClientSecret',
    kind: 'secret',
    importance: 'optional',
    note: 'TDX 運輸資料',
  },
];

/** 純數字識別碼契約 —— destr 陷阱高危群，讀取端必須經 configStr()。 */
export const DESTR_HAZARD_CONTRACTS = ENV_CONTRACTS.filter((c) => c.kind === 'numeric-id');

/** runtimeConfig 路徑的最後一段（靜態掃描用的 key 名）。 */
export function configKeyOf(path) {
  const parts = path.split('.');
  return parts[parts.length - 1];
}

/**
 * 驗證環境變數值（缺失 + 格式）。純函式。
 * @param {Record<string, string | undefined>} env
 * @param {ReadonlyArray<EnvContract>} [contracts]
 * @returns {EnvIssue[]}
 */
export function validateEnvValues(env, contracts = ENV_CONTRACTS) {
  /** @type {EnvIssue[]} */
  const issues = [];

  for (const c of contracts) {
    const raw = env[c.env];
    const present = typeof raw === 'string' && raw.trim() !== '';

    if (!present) {
      if (c.importance === 'optional') continue;
      issues.push({
        env: c.env,
        path: c.path,
        level: c.importance === 'required' ? 'error' : 'warn',
        problem: 'missing',
        detail: c.note,
      });
      continue;
    }

    const pattern = PATTERNS[c.kind];
    if (pattern && !pattern.test(raw.trim())) {
      issues.push({
        env: c.env,
        path: c.path,
        level: 'error', // 值存在卻不合格式一律 error —— 不可能擋掉本來正常的部署
        problem: 'format',
        detail: `不符 ${c.kind} 格式：${c.note}`,
      });
    }
  }

  return issues;
}

/**
 * 讀 runtimeConfig 的巢狀路徑（`public.x` → config.public.x）。
 * @param {Record<string, unknown>} config
 * @param {string} path
 */
export function readConfigPath(config, path) {
  return path.split('.').reduce(
    (acc, key) => (acc && typeof acc === 'object' ? /** @type {Record<string, unknown>} */ (acc)[key] : undefined),
    /** @type {unknown} */ (config),
  );
}

/**
 * 檢查「實際的 runtimeConfig」型別危害。
 *
 * build 期讀到的 process.env 永遠是字串，**看不出 Nitro 注入後 destr 會轉成什麼**——
 * 這正是 2026-08-19 事故躲過所有檢查的原因。因此此函式只能在執行期跑。
 *
 * @param {Record<string, unknown>} config 實際的 runtimeConfig
 * @param {ReadonlyArray<EnvContract>} [contracts]
 * @returns {EnvIssue[]}
 */
export function validateRuntimeConfigTypes(config, contracts = DESTR_HAZARD_CONTRACTS) {
  /** @type {EnvIssue[]} */
  const issues = [];

  for (const c of contracts) {
    const value = readConfigPath(config, c.path);
    if (value === undefined || value === null || value === '') continue; // 缺失由 validateEnvValues 負責
    if (typeof value === 'string') continue;

    issues.push({
      env: c.env,
      path: c.path,
      level: 'warn', // 讀取端若已用 configStr 就無害；靜態掃描負責保證這件事
      problem: 'type-hazard',
      detail: `runtimeConfig 實際型別為 ${typeof value} 而非 string（Nitro destr 轉型）；`
        + '讀取端必須經 configStr()，否則與外部 API 回傳的字串比對必然不相等',
    });
  }

  return issues;
}

/** 依 level 統計。 */
export function summarizeIssues(issues) {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warn: issues.filter((i) => i.level === 'warn').length,
  };
}
