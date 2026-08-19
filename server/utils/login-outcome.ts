/**
 * 登入結果埋點 — 讓「登入成功率」成為可計算的指標（login-health-observability Phase A）
 *
 * 為什麼需要這支：2026-08-19 手機瀏覽器登入 100% 失敗躲了 5 天沒被發現，直接原因是
 * 監控盯的是「特定幾種錯誤的筆數」。要改盯成功率就必須有分母，而分母需要「成功」也被記錄——
 * 現況兩條登入路徑一條只記錯誤（browser-oauth）、一條完全沒有埋點（liff）。
 *
 * 因此兩條路徑統一寫同一組事件，靠 metadata.route 分組：
 *   - `auth.login.ok`   severity=info  （成功；info 不會污染 deny-by-default 的 error/warn 偵測）
 *   - `auth.login.fail` severity=warn  （失敗；metadata.stage 指出失敗環節）
 *
 * 設計：`buildLoginOutcomeLog` 為純函式（可單測，不碰 Firestore），`writeLoginOutcome` 只負責寫入。
 * 沿用 writeAuthErrorLog → 同一個 client_error_logs collection、同一套 7 天保留 cron，不新增資料表。
 * 永不 throw：埋點失敗絕不能阻斷登入。
 */
import { writeAuthErrorLog, type ServerAuthLogInput } from '@@/utils/server-auth-log';
import type { Firestore } from 'firebase-admin/firestore';

/** 登入路徑 = 成功率的分組維度。新增入口時必須同步擴充，否則該入口的成功率無人看管。 */
export type LoginRoute = 'liff' | 'browser-oauth';

export const LOGIN_ROUTES: readonly LoginRoute[] = ['liff', 'browser-oauth'] as const;

export const LOGIN_EVENT_OK = 'auth.login.ok';
export const LOGIN_EVENT_FAIL = 'auth.login.fail';

/** 跨 channel token 不符（Phase D 觀測模式；不在良性清單內 → 會被未知事件規則告警）。 */
export const LOGIN_EVENT_CHANNEL_MISMATCH = 'auth.login.channel-mismatch';

/**
 * 跨 channel 檢查是否「擋下」不符的 token。
 *
 * 現況 false（觀測模式）：不符只記錄 `auth.login.channel-mismatch` 並放行。
 *
 * 為什麼不直接擋：這道防護原本讀取未宣告於 runtimeConfig 的欄位、永遠 undefined，
 * **自上線起一次都沒執行過**。若補上宣告就直接 enforce，而實際 client_id 與預期不符，
 * 會把 LIFF 主登入路徑整條砍掉（三端最大宗入口）。
 *
 * 翻開條件：prod 觀察數日，確認 `auth.login.channel-mismatch` 筆數為 0（代表實際值相符）
 * → 改為 true 並上版。不符的話會先被 deny-by-default 未知事件規則告警，不會靜默。
 *
 * 刻意用程式碼常數而非環境變數：多一個未經驗證的環境變數，正是 4ce6071 那顆事故的來源。
 */
export const LOGIN_CHANNEL_ENFORCE = false;

export interface LoginOutcomeInput {
  outcome: 'ok' | 'fail';
  route: LoginRoute;
  end: 'passenger' | 'driver' | 'admin';
  message: string;
  /** 請求路徑（已去 querystring） */
  path: string;
  userAgent?: string;
  appVersion?: string;
  lineUserId?: string | null;
  /** 失敗環節：token / verify / provision / session / cookie / userinfo / ratelimit */
  stage?: string;
  /** 機器可讀的失敗原因 */
  reason?: string;
  /** 額外欄位（會與 route/stage/reason 合併，同名以後者為準） */
  metadata?: Record<string, unknown>;
}

/**
 * 把登入結果轉成 client_error_logs 的寫入 payload。純函式，供單測驗證事件名與 severity 對應。
 * route 一律寫進 metadata —— 少了它就無法分路徑統計，等同這筆紀錄對成功率沒有貢獻。
 */
export function buildLoginOutcomeLog(input: LoginOutcomeInput): ServerAuthLogInput {
  const isOk = input.outcome === 'ok';
  return {
    event: isOk ? LOGIN_EVENT_OK : LOGIN_EVENT_FAIL,
    severity: isOk ? 'info' : 'warn',
    message: input.message,
    end: input.end,
    path: input.path,
    userAgent: input.userAgent,
    appVersion: input.appVersion,
    lineUserId: input.lineUserId ?? null,
    metadata: {
      route: input.route,
      ...(input.stage ? { stage: input.stage } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.metadata ?? {}),
    },
  };
}

/** 寫一筆登入結果。永不 throw（writeAuthErrorLog 已內建 try-catch）。 */
export async function writeLoginOutcome(db: Firestore, input: LoginOutcomeInput): Promise<void> {
  await writeAuthErrorLog(db, buildLoginOutcomeLog(input));
}

export interface ChannelMismatchInput {
  end: 'passenger' | 'driver' | 'admin';
  path: string;
  userAgent?: string;
  appVersion?: string;
  /** 是否已擋下（false = 觀測模式放行） */
  enforced: boolean;
  /** 診斷用型別資訊；**不得**寫入 client_id 實際值（屬憑證資訊） */
  actualType: string;
  expectedType: string;
}

/**
 * 跨 channel token 不符的紀錄。severity='error' 且不在良性清單內
 * → 一定會被 deny-by-default 未知事件規則抓到並告警。
 * 只記型別，不記實際 client_id 值。
 */
export function buildChannelMismatchLog(input: ChannelMismatchInput): ServerAuthLogInput {
  return {
    event: LOGIN_EVENT_CHANNEL_MISMATCH,
    severity: 'error',
    message: input.enforced
      ? 'LINE token channel mismatch — 已擋下'
      : 'LINE token channel mismatch — 觀測模式放行',
    end: input.end,
    path: input.path,
    userAgent: input.userAgent,
    appVersion: input.appVersion,
    lineUserId: null,
    metadata: {
      route: 'liff',
      stage: 'verify',
      reason: 'channel-mismatch',
      enforced: input.enforced,
      actualType: input.actualType,
      expectedType: input.expectedType,
    },
  };
}

/** 寫一筆跨 channel 不符紀錄。永不 throw。 */
export async function writeChannelMismatch(db: Firestore, input: ChannelMismatchInput): Promise<void> {
  await writeAuthErrorLog(db, buildChannelMismatchLog(input));
}
