// admin legal page API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  LegalPageListRes,
  PutLegalPageBody,
  PutLegalPageRes,
  LegalPageKey,
} from './type.d';

export type {
  LegalPageDto,
  LegalPageKey,
  LegalPageListRes,
  PutLegalPageBody,
  PutLegalPageRes,
} from './type.d';

/** 列出 'terms' + 'privacy' 兩 doc（不存在則回 placeholder） */
export const GetAdminLegalPages = () =>
  methods.get<LegalPageListRes>('/nuxt-api/admin/legal-pages');

/** Upsert legal page（自動 +version） */
export const PutAdminLegalPage = (key: LegalPageKey, body: PutLegalPageBody) =>
  methods.put<PutLegalPageRes>(
    `/nuxt-api/admin/legal-pages/${encodeURIComponent(key)}`,
    body as unknown as Record<string, unknown>,
  );
