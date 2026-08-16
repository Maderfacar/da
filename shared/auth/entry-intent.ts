/**
 * 進站意圖保存（2026-08-17 修：司機 OA 深連結在 LIFF init 後被第二輪解析蓋掉）
 *
 * 問題現場（prod client_error_logs 實測）：
 *   18:33:25  liff=-     / → /booking?liff.hback=2   liffTarget 有值 ✓
 *   18:33:26  liff=true  / → /driver/dashboard        liffTarget=null ← 1.6 秒後蓋掉
 *
 * 成因：login-entry 導向決策後 stripDeepLinkParams() 把 liff.state 從 URL 剝掉（防迴圈，
 * 本身是對的）；但 LIFF SDK init 完成後 middleware 會在 `/` 再解析一次，此時 URL 已無深
 * 連結 → resolveLiffTarget 回空 → 落回 resolveAuthTarget 的角色預設。對「admin + driver」
 * 多重身分者，角色預設是 /admin/orders，於是從司機 OA 進來卻被丟到 admin 端。
 *
 * 解法：深連結被消費時同步記進本模組。URL 可以被剝乾淨，意圖仍在，第二輪解析照樣導對。
 *
 * 防迴圈與防挾持：
 *   - TTL 2 分鐘：過期即失效，不會挾持使用者稍後的手動導覽
 *   - 一離開 login-entry（真正落地）就清除，不跨頁殘留
 *   - 記憶體為主、sessionStorage 為輔：兩輪解析本就同一個 JS context（同一次頁面載入），
 *     記憶體必定命中；sessionStorage 只是 LINE webview 意外重載時的備援，失敗靜默略過
 *     （該環境的儲存不可靠正是本次認證根治的前提）
 */

export type EntryEnd = 'driver' | 'passenger';

export interface EntryIntent {
  /**
   * 深連結目標 path（呼叫端須已用 resolveLiffTarget 淨化）。
   * 空字串＝只知端別、還沒有目標（來源：實際成功 init 的 LIFF ID）。
   */
  target: string;
  /** 入口端別：由目標推導，或由成功 init 的 LIFF ID 直接得知 */
  end: EntryEnd;
  /** 建立時間（epoch ms） */
  at: number;
}

/** 意圖有效期：涵蓋 LIFF init（8s timeout）+ 認證 bootstrap，取寬鬆但不致挾持的 2 分鐘。 */
export const ENTRY_INTENT_TTL_MS = 2 * 60 * 1000;

const STORAGE_KEY = 'da_entry_intent';

/** 目標 path → 入口端別。`/driver/*` 視為司機端，其餘皆乘客端。 */
export function entryEndOf(target: string): EntryEnd {
  return target === '/driver' || target.startsWith('/driver/') ? 'driver' : 'passenger';
}

/** 由目標建立意圖；target 非站內相對路徑時回 null（呼叫端應已淨化，此處為防禦性）。 */
export function makeEntryIntent(target: string, now: number = Date.now()): EntryIntent | null {
  if (typeof target !== 'string') return null;
  const t = target.trim();
  if (!t.startsWith('/') || t.startsWith('//')) return null;
  return { target: t, end: entryEndOf(t), at: now };
}

/** 意圖是否仍在有效期內。 */
export function isEntryIntentFresh(intent: EntryIntent | null, now: number = Date.now()): boolean {
  if (!intent) return false;
  const age = now - intent.at;
  return age >= 0 && age < ENTRY_INTENT_TTL_MS;
}

// ── client 端儲存（記憶體為主、sessionStorage 為輔）─────────────────────────
let _memoryIntent: EntryIntent | null = null;

function _write(intent: EntryIntent): void {
  _memoryIntent = intent;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // LINE webview 儲存不可靠 → 記憶體那份已足夠涵蓋同一次頁面載入的第二輪解析
  }
}

/** 記住這次進站的深連結意圖（stripDeepLinkParams 之前 / 之後呼叫皆可）。 */
export function rememberEntryIntent(target: string, now: number = Date.now()): void {
  const intent = makeEntryIntent(target, now);
  if (!intent) return;
  _write(intent);
}

/**
 * 只記端別、不帶目標。來源是**實際成功 liff.init 的 LIFF ID**——
 * 司機 OA 進站時 pathname 仍是 `/`、深連結也還沒出現，這是當下唯一可信的端別訊號。
 *
 * 不覆蓋既有「已帶目標」的意圖：深連結資訊比端別精確，不可被降級。
 */
export function rememberEntryEnd(end: EntryEnd, now: number = Date.now()): void {
  const existing = readEntryIntent(now);
  if (existing?.target) return;
  _write({ target: '', end, at: now });
}

/** 讀取仍在有效期內的意圖；過期或不存在回 null（過期會順手清掉）。 */
export function readEntryIntent(now: number = Date.now()): EntryIntent | null {
  let intent = _memoryIntent;
  if (!intent && typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<EntryIntent>;
        const okEnd = parsed?.end === 'driver' || parsed?.end === 'passenger';
        if (typeof parsed?.at === 'number' && typeof parsed?.target === 'string' && okEnd) {
          // target 空＝只知端別；有值則須為站內相對路徑（防 open redirect）
          intent = parsed.target
            ? makeEntryIntent(parsed.target, parsed.at)
            : { target: '', end: parsed.end, at: parsed.at };
        }
      }
    } catch {
      intent = null;
    }
  }
  if (!isEntryIntentFresh(intent, now)) {
    if (intent) clearEntryIntent();
    return null;
  }
  return intent;
}

/** 清除意圖（真正落地到非 login-entry 路徑後呼叫，避免跨頁殘留）。 */
export function clearEntryIntent(): void {
  _memoryIntent = null;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 清不掉也無妨：TTL 會讓它自然失效
  }
}

/** 測試用：重置模組內記憶體狀態。 */
export function _resetEntryIntentForTest(): void {
  _memoryIntent = null;
}
