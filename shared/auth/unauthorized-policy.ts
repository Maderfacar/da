// W3（2026-06-18）：401 處理 state machine — 純函式 + state，不依賴 Pinia/Nuxt，可獨立測。
//
// 舊版（methods.ts）累積 3 次 401 才 SignOut。問題：多個並行 API 在很短時間內 fail，
// 計數秒爆 3 → user 突然被踢到 /login，黑箱無關聯訊息。
//
// 改為業界標準：
//   - 第一次 401（isRetry=false）→ 觸發一次 refresh idToken
//       - refresh 成功（token 非空）→ 回 'retry'，caller 應 retry 同一個 request 一次
//       - refresh 失敗（token 空 / throw）→ state machine 觸發 signOutToLogin 並回 'signed-out'
//   - 已 retry 過（isRetry=true）仍 401 → state machine 觸發 signOutToLogin 並回 'signed-out'
//   - signOut 進行後設 isSigningOut=true，後續 handle 回 'noop' 避免重複 SignOut
//   - 並行 401：兩個 handle(false) 同時呼叫共用一個 refreshInFlight，refresh 只發一次
//   - reset() 用於 2xx response 時清狀態（onResponse 內呼叫），允許下次 401 重新試 refresh

export interface UnauthorizedPolicyDeps {
  /** 刷 Firebase ID token；回非空字串視為成功，空字串 / throw 視為失敗 */
  refreshToken: () => Promise<string>;
  /** SignOut + 推 /login；state machine 確保只觸發一次 */
  signOutToLogin: () => Promise<void>;
}

export type UnauthorizedDecision = 'retry' | 'signed-out' | 'noop';

export interface UnauthorizedPolicy {
  handle: (isRetry: boolean) => Promise<UnauthorizedDecision>;
  reset: () => void;
}

export const createUnauthorizedPolicy = (deps: UnauthorizedPolicyDeps): UnauthorizedPolicy => {
  let refreshInFlight: Promise<boolean> | null = null;
  let isSigningOut = false;

  const handle = async (isRetry: boolean): Promise<UnauthorizedDecision> => {
    if (isSigningOut) return 'noop';

    if (isRetry) {
      isSigningOut = true;
      await deps.signOutToLogin();
      return 'signed-out';
    }

    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const token = await deps.refreshToken();
          return !!token;
        } catch {
          return false;
        }
      })();
    }
    const ok = await refreshInFlight;
    refreshInFlight = null;

    if (!ok) {
      if (isSigningOut) return 'noop';
      isSigningOut = true;
      await deps.signOutToLogin();
      return 'signed-out';
    }
    return 'retry';
  };

  const reset = () => {
    refreshInFlight = null;
    isSigningOut = false;
  };

  return { handle, reset };
};
