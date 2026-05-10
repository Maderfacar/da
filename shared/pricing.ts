// 車種與計價設定（前後端共用）
//
// P23 後：VEHICLE_CONFIGS / EXTRA_SERVICES / EXTRA_SERVICE_PRICE 全部移到 Firestore
// （fleet_vehicles / fleet_luggage_types / fleet_extras 三個 collection）。
// client 透過 StoreConfig() Pinia store 載入，server 透過 server/utils/fleet-config.ts 載入。
//
// 本檔僅保留：
//   - 型別定義（FleetVehicle / FleetLuggageType / FleetExtra / I18nLabel）
//   - 行程類型固定枚舉（ORDER_TYPES）— 屬產品邏輯非計價設定，沒動到的必要
//   - calculateFare 算法（接 vehicle 物件 + extras 物件陣列）

// VehicleType 在 P23 前是 union literal，現改為 string —— admin 可任意新增車型，
// callers（store-order draft、CreateOrderParams、Firestore orders.vehicleType）皆持有 doc id 字串。
export type VehicleType = string;

export type OrderType = 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';

export interface I18nLabel {
  zh: string;
  en: string;
  ja: string;
}

export interface FleetVehicle {
  id: string;
  label: I18nLabel;
  capacity: number;
  luggageSU: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

export interface FleetLuggageType {
  id: string;
  label: I18nLabel;
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

export const ORDER_TYPES: Array<{ value: OrderType; label: string; labelEn: string; icon: string }> = [
  { value: 'airport-pickup',  label: '接機',   labelEn: 'AIRPORT PICKUP',  icon: 'mdi:airplane-landing' },
  { value: 'airport-dropoff', label: '送機',   labelEn: 'AIRPORT DROPOFF', icon: 'mdi:airplane-takeoff' },
  { value: 'charter',         label: '包車',   labelEn: 'CHARTER',         icon: 'mdi:car-clock' },
  { value: 'transfer',        label: '交通接送', labelEn: 'TRANSFER',       icon: 'mdi:map-marker-path' },
];

/**
 * 計算預估車資（無條件進位至最近 50 元）
 *
 * P23：簽名改為接 vehicle 物件 + extras 物件陣列，前後端皆需先撈 Firestore fleet config
 * 才能呼叫（client 走 StoreConfig，server 走 fleet-config util）。
 */
export const calculateFare = (
  vehicle: Pick<FleetVehicle, 'baseFare' | 'perKmRate'>,
  distanceKm: number,
  extras: ReadonlyArray<Pick<FleetExtra, 'price'>>,
): number => {
  const base = vehicle.baseFare + distanceKm * vehicle.perKmRate;
  const extrasSum = extras.reduce((sum, e) => sum + e.price, 0);
  return Math.ceil((base + extrasSum) / 50) * 50;
};
