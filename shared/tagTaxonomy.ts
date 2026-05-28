// 車輛 / 司機標籤 Taxonomy（前後端共用）
//
// Phase 1A：定義群組常數、scope 對應、語系顯示 helper。
// 群組（group）與其 multiplicity / scope / sortOrder 為「程式常數」不入 DB；
// 個別標籤（Tag）才寫入 Firestore `tags` collection。

export type TagGroup =
  | 'power'
  | 'vehicleType'
  | 'origin'
  | 'interior'
  | 'equipment'
  | 'driverSkill';

export type TagScope = 'driver' | 'vehicle';

export type TagMultiplicity = 'single' | 'multi';

export type TagLang = 'zh_tw' | 'en' | 'ja';

export interface TagGroupMeta {
  multiplicity: TagMultiplicity;
  scope: TagScope;
  label: { zh_tw: string; en: string; ja: string };
  sortOrder: number;
}

export const TAG_GROUPS: Record<TagGroup, TagGroupMeta> = {
  power:       { multiplicity: 'single', scope: 'vehicle', sortOrder: 1, label: { zh_tw: '動力',     en: 'Power',         ja: '動力' } },
  vehicleType: { multiplicity: 'single', scope: 'vehicle', sortOrder: 2, label: { zh_tw: '車型',     en: 'Type',          ja: '車種' } },
  origin:      { multiplicity: 'single', scope: 'vehicle', sortOrder: 3, label: { zh_tw: '產地',     en: 'Origin',        ja: '産地' } },
  interior:    { multiplicity: 'multi',  scope: 'vehicle', sortOrder: 4, label: { zh_tw: '設備',     en: 'Equipment',     ja: '装備' } },
  equipment:   { multiplicity: 'multi',  scope: 'vehicle', sortOrder: 5, label: { zh_tw: '服務',     en: 'Service',       ja: 'サービス' } },
  driverSkill: { multiplicity: 'multi',  scope: 'driver',  sortOrder: 6, label: { zh_tw: '司機能力', en: 'Driver Skills', ja: 'ドライバー' } },
};

export const TAG_GROUPS_ORDERED: ReadonlyArray<readonly [TagGroup, TagGroupMeta]> =
  (Object.entries(TAG_GROUPS) as [TagGroup, TagGroupMeta][])
    .sort(([, a], [, b]) => a.sortOrder - b.sortOrder);

export interface TagNameI18n {
  zh_tw: string;
  en?: string;
  ja?: string;
}

/**
 * 取本地化標籤名稱，缺對應語系時 fallback 繁中。
 */
export function localizedTagName(tag: { name: TagNameI18n }, lang: TagLang): string {
  return tag.name[lang]?.trim() || tag.name.zh_tw;
}

/**
 * 預載種子（24 標籤）— 由 server seed endpoint 寫入 `tags` collection。
 * `surchargeAmount` 全 0，admin 後續微調；`sortOrder` 依陣列順序 1, 2, 3...（每 group 獨立計數）。
 */
export interface TagSeed {
  group: TagGroup;
  scope: TagScope;
  name: { zh_tw: string; en: string; ja: string };
}

export const TAG_SEEDS: ReadonlyArray<TagSeed> = [
  // power（4）
  { group: 'power', scope: 'vehicle', name: { zh_tw: '純電', en: 'EV',       ja: 'EV' } },
  { group: 'power', scope: 'vehicle', name: { zh_tw: '油電', en: 'Hybrid',   ja: 'ハイブリッド' } },
  { group: 'power', scope: 'vehicle', name: { zh_tw: '汽油', en: 'Gasoline', ja: 'ガソリン' } },
  { group: 'power', scope: 'vehicle', name: { zh_tw: '柴油', en: 'Diesel',   ja: 'ディーゼル' } },
  // vehicleType（5）
  { group: 'vehicleType', scope: 'vehicle', name: { zh_tw: 'MPV',       en: 'MPV',         ja: 'MPV' } },
  { group: 'vehicleType', scope: 'vehicle', name: { zh_tw: 'SUV',       en: 'SUV',         ja: 'SUV' } },
  { group: 'vehicleType', scope: 'vehicle', name: { zh_tw: 'CUV',       en: 'CUV',         ja: 'CUV' } },
  { group: 'vehicleType', scope: 'vehicle', name: { zh_tw: '轎車',     en: 'Sedan',       ja: 'セダン' } },
  { group: 'vehicleType', scope: 'vehicle', name: { zh_tw: '9人座Van', en: '9-seat Van',  ja: '9人乗りバン' } },
  // origin（2）
  { group: 'origin', scope: 'vehicle', name: { zh_tw: '進口', en: 'Imported', ja: '輸入' } },
  { group: 'origin', scope: 'vehicle', name: { zh_tw: '國產', en: 'Domestic', ja: '国産' } },
  // interior（3）
  { group: 'interior', scope: 'vehicle', name: { zh_tw: '獨立航空椅', en: 'Captain Chairs', ja: 'キャプテンシート' } },
  { group: 'interior', scope: 'vehicle', name: { zh_tw: '真皮座椅',   en: 'Leather Seats',  ja: '本革シート' } },
  { group: 'interior', scope: 'vehicle', name: { zh_tw: '隔音改裝',   en: 'Soundproof',     ja: '防音改造' } },
  // equipment（3）
  { group: 'equipment', scope: 'vehicle', name: { zh_tw: '兒童座椅',   en: 'Child Seat',      ja: 'チャイルドシート' } },
  { group: 'equipment', scope: 'vehicle', name: { zh_tw: '寵物友善',   en: 'Pet Friendly',    ja: 'ペット可' } },
  { group: 'equipment', scope: 'vehicle', name: { zh_tw: '無障礙坡道', en: 'Wheelchair Ramp', ja: 'バリアフリー' } },
  // driverSkill（4）
  { group: 'driverSkill', scope: 'driver', name: { zh_tw: '英文',       en: 'English',          ja: '英語' } },
  { group: 'driverSkill', scope: 'driver', name: { zh_tw: '日文',       en: 'Japanese',         ja: '日本語' } },
  { group: 'driverSkill', scope: 'driver', name: { zh_tw: '商務接待',   en: 'Business Service', ja: 'ビジネス対応' } },
  { group: 'driverSkill', scope: 'driver', name: { zh_tw: '女性司機',   en: 'Female Driver',    ja: '女性ドライバー' } },
];
