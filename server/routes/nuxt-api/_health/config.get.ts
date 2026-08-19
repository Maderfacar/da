// GET /nuxt-api/_health/config — 設定契約執行期健檢（config-contract-gate Phase C）
//
// 為什麼 build gate 不夠：build 期讀到的 process.env 永遠是字串，**看不出 Nitro 注入
// runtimeConfig 之後 destr 會把它轉成什麼**。2026-08-19 那顆事故（channel id 變 number）
// 就是這樣躲過所有檢查的。要驗「注入後是不是還是字串」只能在執行期做。
//
// 另一個 build gate 涵蓋不到的：prod 究竟設了哪些環境變數。.env.dev 不是 prod 的可靠鏡像，
// 本端點是唯一能回答「prod 現在到底缺什麼」的地方，也是把 recommended 升級為 required 的依據。
//
// 保護：與 cron 端點同範式 —— 有設 CRON_SECRET 才驗 Authorization: Bearer <secret>。
// 輸出**只含設定名稱、路徑、層級與問題種類，永不含值**（設定值多為憑證；即使 Bearer 保護
// 失效，洩漏的也只是「哪一項沒設好」而非憑證本身）。
import {
  validateEnvValues,
  validateRuntimeConfigTypes,
  summarizeIssues,
  ENV_CONTRACTS,
} from '~shared/env-contract.mjs';

export default defineEventHandler((event) => {
  const config = useRuntimeConfig();

  // ⚠️ fail-closed：沒設 CRON_SECRET 就拒絕輸出，而不是「沒設就放行」。
  // 2026-08-20 首次部署後實測發現 prod 根本沒設 CRON_SECRET，導致本端點對外完全公開。
  // 它雖不含設定值，但會揭露「哪些保護沒設好」（例如 CRON_SECRET 未設 = cron 端點無保護），
  // 這是可直接利用的偵察情報。診斷端點的預設必須是關的。
  const secret = (config as { cronSecret?: string }).cronSecret;
  if (!secret) {
    return {
      data: {},
      status: {
        code: 503,
        message: {
          zh_tw: '健檢端點未設定保護（CRON_SECRET），拒絕輸出',
          en: 'Health endpoint protection not configured (CRON_SECRET); refusing to report',
          ja: 'ヘルスエンドポイントの保護が未設定（CRON_SECRET）のため出力しません',
        },
      },
    };
  }
  const authz = getHeader(event, 'authorization') ?? '';
  if (authz !== `Bearer ${secret}`) {
    return { data: {}, status: { code: 401, message: { zh_tw: '未授權', en: 'Unauthorized', ja: '未承認' } } };
  }

  // 1) 環境變數層：缺失與格式
  const envIssues = validateEnvValues(process.env as Record<string, string | undefined>);
  // 2) runtimeConfig 層：destr 型別危害（build 期看不到的那一半）
  const typeIssues = validateRuntimeConfigTypes(config as unknown as Record<string, unknown>);

  const issues = [...envIssues, ...typeIssues];
  const summary = summarizeIssues(issues);

  return successResponse({
    ok: summary.error === 0,
    checkedAt: new Date().toISOString(),
    contracts: ENV_CONTRACTS.length,
    summary,
    issues, // detail 由契約撰寫，不含任何設定值
  });
});
