import methods from '@/protocol/fetch-api/methods';
import type { SelfLang, PatchSelfLangResponse } from './type.d';

export type { SelfLang, SelfRebindChannel, SelfRebindEntry, PatchSelfLangResponse } from './type.d';

/**
 * PATCH /nuxt-api/self/lang — user 切換語系（P42 Phase 2）
 *
 * 任何已登入 user（passenger / driver / admin）皆可呼。
 * 後端 update `users/{lineUid}.lang` + 依 roles 對對應 channel(s) 重綁該 lang richmenu。
 * 失敗的 per channel rebind 進 `rebinds[i].error`，整體 status code 仍綠（fail-open）。
 */
export const PatchSelfLang = (body: { lang: SelfLang }) =>
  methods.patch<PatchSelfLangResponse>('/nuxt-api/self/lang', body);
