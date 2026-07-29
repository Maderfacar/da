// client_error_logs 保留政策（2026-07-28）
//
// Vercel Cron 每日清理超過保留天數的舊 log，避免 collection 無限成長。
// 保留 7 天（量約 68 筆/天 → 常態僅數百筆；除錯回塑 7 天足夠緩衝晚報的客訴）。

export const ERROR_LOG_RETENTION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 回傳保留邊界時戳：早於此時間的 log 應被清除。
 * @param now 現在時間
 * @param days 保留天數（預設 ERROR_LOG_RETENTION_DAYS）
 */
export function getErrorLogRetentionCutoff(now: Date, days: number = ERROR_LOG_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
