// P42：對齊 server/utils/i18n-message.ts `Lang` + line-richmenu-doc.ts `RICHMENU_VALID_LANGS`
export type SelfLang = 'zh_tw' | 'en' | 'ja';

export type SelfRebindChannel = 'passenger' | 'driver';

export interface SelfRebindEntry {
  channel: SelfRebindChannel;
  ok: boolean;
  /** 實際綁定使用的 lang（可能因 fallback chain 不是 user 原 lang）；無 active richmenu 為 null */
  usedLang: SelfLang | null;
  richMenuId: string | null;
  error: string | null;
}

export interface PatchSelfLangResponse {
  lang: SelfLang;
  rebinds: SelfRebindEntry[];
}
