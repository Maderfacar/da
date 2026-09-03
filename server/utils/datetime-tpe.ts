// 台灣時區時間格式化（server 端專用）
//
// 為什麼需要這支：Vercel serverless 跑 UTC，任何在 server 端組出來「給人看」的時間字串
// （LINE 推播、admin 通知）不轉時區就會差 8 小時。client 端跟瀏覽器時區走，不經過這裡。
//
// ⚠️ pickupDateTime 在 Firestore 是混合格式（歷史因素，兩邊 client 寫法不同）：
//   - 乘客下單：datetime-local 原字串（無時區，如 '2026-09-04T10:00'）＝台灣在地時間
//   - admin 建單/編輯：$dayjs(...).toISOString()（帶 Z 的 UTC）
// 判定規則與 orders/index.post.ts 的 parseTaiwanTime 一致：
// 無時區 → 視為台灣在地時間照字面輸出；帶 Z / offset → 轉 Asia/Taipei。
import dayjs from 'dayjs';
// Vercel Node 22 ESM 嚴格：dayjs subpath 必須帶 .js 副檔名（package.json exports 只列 .js 版本）
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TPE_TZ = 'Asia/Taipei';

/** 字串尾端帶 Z 或 ±HH:mm / ±HHmm 視為有時區資訊 */
const HAS_ZONE_REGEX = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * ISO / datetime-local 字串 → 台灣時區格式化字串。
 * 空值回 ''；無法解析回原字串（與舊 _formatDateTime 的 fallback 行為一致）。
 */
export const formatDateTimeTpe = (
  iso: string | null | undefined,
  fmt = 'YYYY-MM-DD HH:mm',
): string => {
  if (!iso) return '';
  const d = dayjs(iso);
  if (!d.isValid()) return iso;
  // 無時區字串：dayjs 以「執行環境時區」解析，format 原樣輸出牆鐘欄位 —— 不可再 .tz() 轉換
  return HAS_ZONE_REGEX.test(iso) ? d.tz(TPE_TZ).format(fmt) : d.format(fmt);
};
