/**
 * 路由存在性檢查（2026-08-29）
 *
 * 為什麼需要：深連結目標 / entry-intent 的 target 都是**字串**，沒人保證它對得到頁面。
 * 一個死路由（例：`/profile` —— 乘客個人頁早已併進 `/orders`）被導過去只會 404，
 * 而且在 LIFF 裡會演變成迴圈：404 → 使用者按 LINE 返回鍵 → LIFF 重跑 OAuth（舊 code
 * 被重用 → `code_verifier does not match`）→ middleware 又把 `/` 導回同一個死路由。
 * prod 實測（client_error_logs session `cgl8mn0`）auth resolve 卡了 104 秒。
 *
 * 用 Vue Router 自己的路由表判斷，不維護第二份名單 —— 名單一定會跟頁面目錄漂移，
 * 而這顆 bug 的成因正是「CLAUDE.md 的路由表列了一個不存在的頁」。
 */
import type { Router } from 'vue-router';

/**
 * `path` 是否對得到一個真實頁面。可帶 query / hash。
 * 解析失敗（畸形路徑）一律視為不存在 —— 寧可退回角色預設，也不要把人送去 404。
 */
export function IsKnownRoute(router: Router, path: string): boolean {
  if (typeof path !== 'string' || !path.startsWith('/')) return false;
  try {
    return router.resolve(path).matched.length > 0;
  } catch {
    return false;
  }
}

/** 綁好 router 的判定函式，可直接餵給 entry-intent 的 `routeExists` 參數。 */
export function MakeRouteExists(router: Router): (path: string) => boolean {
  return (path: string) => IsKnownRoute(router, path);
}
