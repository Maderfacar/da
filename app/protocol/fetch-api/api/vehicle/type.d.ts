// 車輛公開檔案 API 型別（Phase 1C）

import type { TagGroup } from '~shared/tagTaxonomy';

export type { TagGroup } from '~shared/tagTaxonomy';

export interface VehiclePublicTagDto {
  id: string;
  /** 已 localized 名稱（依 query lang；缺翻譯 fallback 繁中） */
  name: string;
  group: TagGroup;
  sortOrder: number;
}

export interface VehiclePublicDto {
  driverDisplayName: string;
  completedOrders: number;
  driverSkillTags: VehiclePublicTagDto[];
  vehicleProfile: {
    photos: string[];
    tags: VehiclePublicTagDto[];
    /** ISO timestamp */
    verifiedAt: string;
  };
}

export type GetVehiclePublicLang = 'zh_tw' | 'en' | 'ja';
