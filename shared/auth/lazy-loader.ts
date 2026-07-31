// W4（2026-06-18）：sticky-promise lazy loader factory（純函式，無 Pinia/Nuxt 依賴）。
//
// 用途：把 user-specific Firestore doc 讀取包成「第一次需要時才 fire、in-flight dedup、
// 成功後不重發、失敗允許下次再試」的 lazy action。
// store-auth.ts 內 4 個 EnsureXxxLoaded 共用此 factory。
//
// 設計重點：
//   - in-flight 共用：並行 ensure() 共用同一個 promise（不會發兩次 Firestore read）
//   - 成功 sticky：resolved 後再 ensure() 立即 return（不重發）
//   - 失敗清狀態：rejected 後 in-flight 清掉，下次 ensure() 重發 fn
//   - reset()：SignOut 或 user 切換時清快取，下一個 user 不會看到上個 user 的資料
//
// F2 修（2026-07-31）：fn 可回傳 `false` 表示「前置條件未就緒（如 firebase app / user 尚未
// 備妥）」——此時**不標記 loaded**、清掉 in-flight，讓下次 ensure() 重試。過去 fn 提前
// `return`（等同回 undefined）會被當成功而永久標 loaded，導致 _LoadUserDoc 整個 session
// 不再執行、roles 卡空且不報錯（「看似登出」靜默根因之一）。

export interface LazyLoader {
  ensure: () => Promise<void>;
  reset: () => void;
  isLoaded: () => boolean;
}

/**
 * @param fn 實際載入邏輯；回傳 `false` = 前置未就緒、不算完成（可重試），
 *           回傳 `undefined`/`true`（或無回傳值）= 視為成功並 sticky。
 */
export function createLazyLoader(fn: () => Promise<boolean | undefined>): LazyLoader {
  let inFlight: Promise<void> | null = null;
  let loaded = false;

  const ensure = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const ready = await fn();
        if (ready === false) {
          // 前置未就緒 → 不標 loaded，清 in-flight 讓下次 ensure() 重試
          inFlight = null;
          return;
        }
        loaded = true;
      } catch (err) {
        inFlight = null;
        throw err;
      }
    })();
    return inFlight;
  };

  const reset = (): void => {
    inFlight = null;
    loaded = false;
  };

  const isLoaded = (): boolean => loaded;

  return { ensure, reset, isLoaded };
}
