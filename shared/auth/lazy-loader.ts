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

export interface LazyLoader {
  ensure: () => Promise<void>;
  reset: () => void;
  isLoaded: () => boolean;
}

export function createLazyLoader(fn: () => Promise<void>): LazyLoader {
  let inFlight: Promise<void> | null = null;
  let loaded = false;

  const ensure = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await fn();
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
