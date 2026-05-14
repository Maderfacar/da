// P40 Phase 2：admin bot replies type 定義
//
// 對齊 server/utils/line-channel.ts BotReplyType + server/routes/nuxt-api/admin/bot-replies/*

export type BotReplyClient = 'passenger' | 'driver';
export type BotReplyType = 'follow' | 'text';
export type BotReplyKey = `${BotReplyClient}.${BotReplyType}`;

export interface BotReplyItem {
  replyKey: BotReplyKey;
  client: BotReplyClient;
  type: BotReplyType;
  /** Current effective text — 若 doc 存在且 enabled 則為 doc.text，否則為 defaultText */
  text: string;
  /** Enabled toggle；false 時 webhook 走 fallback default */
  enabled: boolean;
  /** Doc 是否存在（admin 是否自訂過） */
  isCustomized: boolean;
  /** 系統預設 fallback text，admin 對照用 */
  defaultText: string;
  updatedBy: string;
  updatedAt: string | null;
}

export interface BotReplyListRes {
  items: BotReplyItem[];
}

export interface PutBotReplyBody {
  text: string;
  enabled?: boolean;
}
