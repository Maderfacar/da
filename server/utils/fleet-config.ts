/**
 * Fleet 計價參數 server 端 helper（P23）
 *
 * Firestore 3 collection：
 *   - fleet_vehicles/{vehicleId}       車型（capacity / luggageSU / baseFare / perKmRate）
 *   - fleet_luggage_types/{typeId}     行李類型 + SU 值
 *   - fleet_extras/{extraId}           加值服務 + 各自單價
 *
 * 公開 GET 端點 `/nuxt-api/config/fleet` 撈三 collection 給 client cache 到 Pinia store；
 * admin endpoints 走 `/nuxt-api/admin/config/{resource}/...` 需 canManageFleet 權限。
 *
 * 首次呼叫 getFleetConfig() 若任一 collection 為空，自動 seed defaults
 * （避免 user 上線後資料庫空白看不到車型）。
 */
import type { Firestore } from 'firebase-admin/firestore';

export interface I18nLabel {
  zh: string;
  en: string;
  ja: string;
}

export interface FleetVehicle {
  id: string;
  label: I18nLabel;
  /** 最大乘客數 */
  capacity: number;
  /** 行李 SU 容量上限 */
  luggageSU: number;
  /** 起跳車資（TWD） */
  baseFare: number;
  /** 每公里費用（TWD） */
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  /** Booking v2：車型卡情境文案三語（optional） */
  tagline?: I18nLabel;
}

export interface FleetLuggageType {
  id: string;
  label: I18nLabel;
  /** 該行李類型佔用 SU 值 */
  su: number;
  sortOrder: number;
}

export interface FleetExtra {
  id: string;
  label: I18nLabel;
  price: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

export interface FleetConfig {
  vehicles: FleetVehicle[];
  luggageTypes: FleetLuggageType[];
  extras: FleetExtra[];
}

export type FleetResource = 'vehicles' | 'luggage-types' | 'extras';

const COLLECTION_MAP: Record<FleetResource, string> = {
  'vehicles': 'fleet_vehicles',
  'luggage-types': 'fleet_luggage_types',
  'extras': 'fleet_extras',
};

export const FLEET_RESOURCES: ReadonlyArray<FleetResource> = ['vehicles', 'luggage-types', 'extras'];

export const isFleetResource = (raw: unknown): raw is FleetResource =>
  typeof raw === 'string' && (FLEET_RESOURCES as ReadonlyArray<string>).includes(raw);

export const getCollectionName = (resource: FleetResource): string => COLLECTION_MAP[resource];

// ── Default seeds（admin 上線後可隨時改） ─────────────────────────────────

const DEFAULT_VEHICLES: FleetVehicle[] = [
  {
    id: 'sedan',
    label: { zh: '轎車', en: 'Sedan', ja: 'セダン' },
    capacity: 3,
    luggageSU: 4,
    baseFare: 300,
    perKmRate: 25,
    icon: 'mdi:car',
    sortOrder: 1,
    enabled: true,
  },
  {
    id: 'suv',
    label: { zh: '休旅車', en: 'SUV', ja: 'SUV' },
    capacity: 6,
    luggageSU: 7,
    baseFare: 400,
    perKmRate: 35,
    icon: 'mdi:car-estate',
    sortOrder: 2,
    enabled: true,
  },
  {
    id: 'van',
    label: { zh: '廂型車', en: 'Van', ja: 'バン' },
    capacity: 8,
    luggageSU: 14,
    baseFare: 500,
    perKmRate: 40,
    icon: 'mdi:van-passenger',
    sortOrder: 3,
    enabled: true,
  },
  {
    id: 'premium',
    label: { zh: '豪華轎車', en: 'Premium', ja: 'プレミアム' },
    capacity: 4,
    luggageSU: 4,
    baseFare: 800,
    perKmRate: 60,
    icon: 'mdi:car-sports',
    sortOrder: 4,
    enabled: true,
  },
];

const DEFAULT_LUGGAGE_TYPES: FleetLuggageType[] = [
  {
    id: 'small',
    label: { zh: '20 吋以下登機箱', en: 'Carry-on (≤ 20")', ja: '機内持込（20"以下）' },
    su: 1,
    sortOrder: 1,
  },
  {
    id: 'medium',
    label: { zh: '24-26 吋中型行李', en: 'Medium (24-26")', ja: '中型（24-26"）' },
    su: 2,
    sortOrder: 2,
  },
  {
    id: 'large',
    label: { zh: '28-32 吋大型行李', en: 'Large (28-32")', ja: '大型（28-32"）' },
    su: 3,
    sortOrder: 3,
  },
  {
    id: 'special',
    label: { zh: '特殊物品（高爾夫袋/嬰兒車）', en: 'Special (golf bag / stroller)', ja: '特殊（ゴルフ/ベビーカー）' },
    su: 4,
    sortOrder: 4,
  },
];

const DEFAULT_EXTRAS: FleetExtra[] = [
  {
    id: 'baby-seat',
    label: { zh: '嬰兒座椅', en: 'Baby seat', ja: 'ベビーシート' },
    price: 200,
    icon: 'mdi:baby-face-outline',
    sortOrder: 1,
    enabled: true,
  },
  {
    id: 'wheelchair',
    label: { zh: '輪椅協助', en: 'Wheelchair assist', ja: '車椅子サポート' },
    price: 200,
    icon: 'mdi:wheelchair-accessibility',
    sortOrder: 2,
    enabled: true,
  },
  {
    id: 'pickup-sign',
    label: { zh: '接機舉牌', en: 'Pickup sign', ja: '出迎えサイン' },
    price: 200,
    icon: 'mdi:card-account-details-outline',
    sortOrder: 3,
    enabled: true,
  },
  {
    id: 'flight-tracking',
    label: { zh: '即時航班追蹤', en: 'Flight tracking', ja: 'フライト追跡' },
    price: 200,
    icon: 'mdi:airplane-search',
    sortOrder: 4,
    enabled: true,
  },
];

// ── Validation helpers ───────────────────────────────────────────────────

const isI18nLabel = (raw: unknown): raw is I18nLabel => {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return typeof obj.zh === 'string' && typeof obj.en === 'string' && typeof obj.ja === 'string';
};

const isFiniteNumber = (raw: unknown): raw is number =>
  typeof raw === 'number' && Number.isFinite(raw);

const isPositiveOrZero = (raw: unknown): raw is number =>
  isFiniteNumber(raw) && raw >= 0;

export const validateVehiclePayload = (
  raw: Record<string, unknown>,
): { ok: true; data: Omit<FleetVehicle, 'id'> } | { ok: false; error: string } => {
  if (!isI18nLabel(raw.label)) return { ok: false, error: 'label 必須含 zh/en/ja 三語' };
  if (!Number.isInteger(raw.capacity) || (raw.capacity as number) < 1) return { ok: false, error: 'capacity 必須是正整數' };
  if (!isPositiveOrZero(raw.luggageSU)) return { ok: false, error: 'luggageSU 必須 ≥ 0' };
  if (!isPositiveOrZero(raw.baseFare)) return { ok: false, error: 'baseFare 必須 ≥ 0' };
  if (!isPositiveOrZero(raw.perKmRate)) return { ok: false, error: 'perKmRate 必須 ≥ 0' };
  if (typeof raw.icon !== 'string') return { ok: false, error: 'icon 必須字串' };
  if (!Number.isInteger(raw.sortOrder)) return { ok: false, error: 'sortOrder 必須整數' };
  if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'enabled 必須 boolean' };
  // Booking v2：tagline optional；null / undefined / 三語空字串 → 不寫入欄位（admin 清空亦走此路徑）
  let tagline: I18nLabel | undefined;
  if (raw.tagline !== undefined && raw.tagline !== null) {
    if (!isI18nLabel(raw.tagline)) return { ok: false, error: 'tagline 必須含 zh/en/ja 三語' };
    const t = raw.tagline;
    if (t.zh.trim() || t.en.trim() || t.ja.trim()) tagline = { zh: t.zh, en: t.en, ja: t.ja };
  }
  const data: Omit<FleetVehicle, 'id'> = {
    label: raw.label,
    capacity: raw.capacity as number,
    luggageSU: raw.luggageSU as number,
    baseFare: raw.baseFare as number,
    perKmRate: raw.perKmRate as number,
    icon: raw.icon,
    sortOrder: raw.sortOrder as number,
    enabled: raw.enabled,
  };
  if (tagline) data.tagline = tagline;
  return { ok: true, data };
};

export const validateLuggageTypePayload = (
  raw: Record<string, unknown>,
): { ok: true; data: Omit<FleetLuggageType, 'id'> } | { ok: false; error: string } => {
  if (!isI18nLabel(raw.label)) return { ok: false, error: 'label 必須含 zh/en/ja 三語' };
  if (!isPositiveOrZero(raw.su)) return { ok: false, error: 'su 必須 ≥ 0' };
  if (!Number.isInteger(raw.sortOrder)) return { ok: false, error: 'sortOrder 必須整數' };
  return {
    ok: true,
    data: {
      label: raw.label,
      su: raw.su as number,
      sortOrder: raw.sortOrder as number,
    },
  };
};

export const validateExtraPayload = (
  raw: Record<string, unknown>,
): { ok: true; data: Omit<FleetExtra, 'id'> } | { ok: false; error: string } => {
  if (!isI18nLabel(raw.label)) return { ok: false, error: 'label 必須含 zh/en/ja 三語' };
  if (!isPositiveOrZero(raw.price)) return { ok: false, error: 'price 必須 ≥ 0' };
  if (typeof raw.icon !== 'string') return { ok: false, error: 'icon 必須字串' };
  if (!Number.isInteger(raw.sortOrder)) return { ok: false, error: 'sortOrder 必須整數' };
  if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'enabled 必須 boolean' };
  return {
    ok: true,
    data: {
      label: raw.label,
      price: raw.price as number,
      icon: raw.icon,
      sortOrder: raw.sortOrder as number,
      enabled: raw.enabled,
    },
  };
};

// ── Core operations ──────────────────────────────────────────────────────

const docToFleetItem = <T extends { id: string }>(doc: FirebaseFirestore.QueryDocumentSnapshot): T =>
  ({ id: doc.id, ...doc.data() } as T);

/** 撈三 collection 並回傳整份 FleetConfig；自動 seed if empty */
export const getFleetConfig = async (db: Firestore): Promise<FleetConfig> => {
  await seedFleetConfigIfEmpty(db);

  const [vehiclesSnap, luggageTypesSnap, extrasSnap] = await Promise.all([
    db.collection('fleet_vehicles').orderBy('sortOrder').get(),
    db.collection('fleet_luggage_types').orderBy('sortOrder').get(),
    db.collection('fleet_extras').orderBy('sortOrder').get(),
  ]);

  return {
    vehicles: vehiclesSnap.docs.map((d) => docToFleetItem<FleetVehicle>(d)),
    luggageTypes: luggageTypesSnap.docs.map((d) => docToFleetItem<FleetLuggageType>(d)),
    extras: extrasSnap.docs.map((d) => docToFleetItem<FleetExtra>(d)),
  };
};

/** 若任一 collection 為空就寫入 defaults；已有資料則略過該 collection */
export const seedFleetConfigIfEmpty = async (db: Firestore): Promise<void> => {
  const [vehiclesSnap, luggageTypesSnap, extrasSnap] = await Promise.all([
    db.collection('fleet_vehicles').limit(1).get(),
    db.collection('fleet_luggage_types').limit(1).get(),
    db.collection('fleet_extras').limit(1).get(),
  ]);

  const batch = db.batch();
  let needsCommit = false;

  if (vehiclesSnap.empty) {
    DEFAULT_VEHICLES.forEach((v) => {
      const { id, ...rest } = v;
      batch.set(db.collection('fleet_vehicles').doc(id), rest);
    });
    needsCommit = true;
  }

  if (luggageTypesSnap.empty) {
    DEFAULT_LUGGAGE_TYPES.forEach((t) => {
      const { id, ...rest } = t;
      batch.set(db.collection('fleet_luggage_types').doc(id), rest);
    });
    needsCommit = true;
  }

  if (extrasSnap.empty) {
    DEFAULT_EXTRAS.forEach((e) => {
      const { id, ...rest } = e;
      batch.set(db.collection('fleet_extras').doc(id), rest);
    });
    needsCommit = true;
  }

  if (needsCommit) await batch.commit();
};
