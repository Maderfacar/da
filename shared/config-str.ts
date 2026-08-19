/**
 * runtimeConfig 值正規化（字串語意欄位）。
 *
 * 放在 shared/：server 端（`@@/utils/runtime-config` 轉出）與 client 端（`~shared/config-str`）
 * 都會讀到同一批純數字設定（channel id / messaging sender id），兩邊都需要這道正規化。
 *
 * 為什麼需要這支：Nitro 把環境變數注入 runtimeConfig 時會過 `destr()`
 * （nitropack/dist/runtime/internal/utils.env.mjs 的 getEnv），destr 會把「純數字字串」
 * 轉成 number，而且不看 nuxt.config 宣告的預設值型別（宣告 `''` 也一樣被覆寫成 number）。
 *
 * 於是 `NUXT_LINE_LOGIN_CHANNEL_ID=2009509209` 在 server 端拿到的是 number 2009509209，
 * 不是字串 '2009509209'。丟進 URLSearchParams 會自動轉字串（送 API 正常），但只要拿去跟
 * 外部 API 回傳的字串做 `!==` 比對就必然不相等 —— 且兩者印出來一模一樣，log 上看不出差異。
 * 這正是 2026-08-19 手機瀏覽器 LINE 登入 100% 失敗（callback aud 比對）的根因。
 *
 * 規則：凡「值可能是純數字、但語意是字串」的 runtimeConfig 欄位（channel id、sender id、
 * 各種 numeric id），一律先經本函式讀出再使用或比對。
 */
export function configStr(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  return ''; // null / undefined / object / NaN：視為未設定，交給 caller 的 config 檢查分支
}
