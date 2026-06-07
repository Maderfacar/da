// P40 Phase 2：admin bot replies type 定義
// 2026-06-08：.follow 升級 welcome sequence（多則 text/flex 混搭，最多 5 則）

export type BotReplyClient = 'passenger' | 'driver';
export type BotReplyType = 'follow' | 'text';
export type BotReplyKey = `${BotReplyClient}.${BotReplyType}`;

export type WelcomeLang = 'zh_tw' | 'en' | 'ja';
export type WelcomeLangText = Record<WelcomeLang, string>;

export interface WelcomeMessageText {
  id: string;
  type: 'text';
  enabled: boolean;
  content: WelcomeLangText;
}

export interface WelcomeMessageFlex {
  id: string;
  type: 'flex';
  enabled: boolean;
  title: WelcomeLangText;
  body: WelcomeLangText;
  coverImageUrl: string | null;
  ctaButton: {
    label: WelcomeLangText;
    url: string;
  } | null;
}

export type WelcomeMessage = WelcomeMessageText | WelcomeMessageFlex;

export interface WelcomeSequence {
  enabled: boolean;
  messages: WelcomeMessage[];
}

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
  /** 僅 .follow 類：歡迎序列；舊 single-text doc 由 server migrate 為 1 則 text */
  welcomeSequence?: WelcomeSequence;
}

export interface BotReplyListRes {
  items: BotReplyItem[];
}

/** .text 類用：單則純文字 */
export interface PutBotReplyTextBody {
  text: string;
  enabled?: boolean;
}

/** .follow 類用：歡迎序列陣列 */
export interface PutBotReplyFollowBody {
  enabled: boolean;
  messages: WelcomeMessage[];
}

export type PutBotReplyBody = PutBotReplyTextBody | PutBotReplyFollowBody;
