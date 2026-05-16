// admin 折扣碼 API methods
import methods from '@/protocol/fetch-api/methods';
import type {
  DiscountCodeListRes,
  CreateDiscountCodeBody,
  DiscountCodeWriteBody,
} from './type.d';

export type {
  DiscountCodeDto,
  DiscountCodeListRes,
  DiscountCodeWriteBody,
  CreateDiscountCodeBody,
} from './type.d';

/** 列出所有折扣碼 */
export const GetDiscountCodes = () =>
  methods.get<DiscountCodeListRes>('/nuxt-api/admin/discount-codes');

/** 建立折扣碼 */
export const CreateDiscountCode = (body: CreateDiscountCodeBody) =>
  methods.post<{ code: string }>(
    '/nuxt-api/admin/discount-codes',
    body as unknown as Record<string, unknown>,
  );

/** 更新折扣碼（含切換 enabled） */
export const UpdateDiscountCode = (code: string, body: DiscountCodeWriteBody) =>
  methods.put<{ code: string }>(
    `/nuxt-api/admin/discount-codes/${encodeURIComponent(code)}`,
    body as unknown as Record<string, unknown>,
  );
