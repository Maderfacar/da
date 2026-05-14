// P40 Phase 2：admin bot replies API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  BotReplyKey,
  BotReplyListRes,
  PutBotReplyBody,
} from './type.d';

export type {
  BotReplyClient,
  BotReplyItem,
  BotReplyKey,
  BotReplyListRes,
  BotReplyType,
  PutBotReplyBody,
} from './type.d';

/** 列出 4 個 bot reply key（doc 不存在回 hard-coded default 預覽） */
export const GetBotReplies = () =>
  methods.get<BotReplyListRes>('/nuxt-api/admin/bot-replies');

/** 編輯 bot reply 文案（upsert） */
export const PutBotReply = (key: BotReplyKey, body: PutBotReplyBody) =>
  methods.put<{ replyKey: BotReplyKey; updated: boolean }>(
    `/nuxt-api/admin/bot-replies/${key}`,
    body as unknown as Record<string, unknown>,
  );
