/**
 * 本機 plain-HTTP 的安全標頭鬆綁（2026-08-29）
 *
 * `nuxt.config.ts` 的 `routeRules` 把 security headers 靜態烤進建置產物，所以本機
 * `node .output/server/index.mjs` 也會送 HSTS 與 `upgrade-insecure-requests`。
 * WebKit（Playwright 的 iPhone project）對 localhost 不網開一面，會把所有 `/static/*`
 * 升成 https → 全數 `SSL connect error` → JS 從沒載入。理由與判定條件詳見
 * `@@/utils/security-headers` 的 `relaxHeadersForLocalHttp`。
 *
 * 用 `beforeResponse` hook 而不是 `server/middleware/`：routeRules 的 headers 是在
 * 回應階段套上的，middleware 先寫的值會被它蓋掉；`beforeResponse` 跑在最後。
 *
 * 條件只看 host 是否 localhost —— prod 永遠不成立，線上行為零改變。
 */
import { isLocalHost, relaxHeadersForLocalHttp } from '@@/utils/security-headers';

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    // 兩道條件都成立才鬆綁：① 不在 Vercel 上 ② host 是本機。
    // host 是 client 送的，理論上可偽造；Vercel 上根本路由不到這個 host，但
    // 「拿掉安全標頭」這種事不值得只靠一個可偽造的訊號，加一道環境判斷成本是零。
    if (process.env.VERCEL) return;
    if (!isLocalHost(getHeader(event, 'host'))) return;

    const current = getResponseHeaders(event) as Record<string, string>;
    const hsts = current['strict-transport-security'];
    const csp = current['content-security-policy'];
    if (!hsts && !csp) return;

    const relaxed = relaxHeadersForLocalHttp({
      ...(hsts ? { 'strict-transport-security': String(hsts) } : {}),
      ...(csp ? { 'content-security-policy': String(csp) } : {}),
    });

    if (hsts) removeResponseHeader(event, 'strict-transport-security');
    if (csp) setResponseHeader(event, 'content-security-policy', relaxed['content-security-policy']!);
  });
});
