// Admin fare-rules API methods（Fare V2 車資進階規則）
//
// 對齊 server/routes/nuxt-api/admin/fare-rules/index.{get,patch}.ts 的 FareRulesRes。
// FareRules 型別直接取自 ~shared/pricing（前後端共用，單一來源）。

import methods from '@/protocol/fetch-api/methods';
import type { FareRules } from '~shared/pricing';

export type { FareRules } from '~shared/pricing';

export interface FareRulesDto {
  rules: FareRules;
  updatedBy: string | null;
  updatedAt: string | null;
  /** true = 顯示的是預設值（尚未存過 fare_rules/v1） */
  isDefault: boolean;
}

/** 取得目前車資進階規則（super only） */
export const GetAdminFareRules = () =>
  methods.get<FareRulesDto>('/nuxt-api/admin/fare-rules');

/** 全量更新車資進階規則（super only） */
export const PatchAdminFareRules = (rules: FareRules) =>
  methods.patch<FareRulesDto>(
    '/nuxt-api/admin/fare-rules',
    rules as unknown as Record<string, unknown>,
  );
