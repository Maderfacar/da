// Public legal page API methods（無 auth required）
import methods from '@/protocol/fetch-api/methods';
import type { LegalPageDto, LegalPageKey } from './type.d';

export type { LegalPageDto, LegalPageKey } from './type.d';

/** 公開讀取會員條款 / 隱私政策（30s edge cache） */
export const GetLegalPage = (key: LegalPageKey) =>
  methods.get<LegalPageDto>(`/nuxt-api/legal-pages/${encodeURIComponent(key)}`);
