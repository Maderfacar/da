/**
 * POST /api/line/webhook/passenger
 *
 * Passenger OA 的 LINE webhook endpoint。
 * LINE Developer Console 要把 passenger channel 的 webhook URL 設為此路徑。
 *
 * 邏輯共用 server/utils/line-channel.ts 的 handleLineWebhook（簽名驗 + follow/message reply）
 */
import { handleLineWebhook } from '@@/utils/line-channel';

export default defineEventHandler((event) => handleLineWebhook(event, 'passenger'));
