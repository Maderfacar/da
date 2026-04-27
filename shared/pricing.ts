// 車種與計價設定（前後端共用）

export type VehicleType = 'sedan' | 'suv' | 'van' | 'premium';
export type OrderType = 'airport-pickup' | 'airport-dropoff' | 'charter' | 'transfer';
export type ExtraService = 'baby-seat' | 'wheelchair' | 'pickup-sign' | 'flight-tracking';

export interface VehicleConfig {
  type: VehicleType;
  label: string;
  labelEn: string;
  capacity: number;
  luggageCapacity: number;
  baseFare: number;
  perKmRate: number;
}

export const VEHICLE_CONFIGS: Record<VehicleType, VehicleConfig> = {
  sedan:   { type: 'sedan',   label: '轎車',   labelEn: 'Sedan',   capacity: 3, luggageCapacity: 2, baseFare: 300, perKmRate: 25 },
  suv:     { type: 'suv',     label: '休旅車', labelEn: 'SUV',     capacity: 6, luggageCapacity: 4, baseFare: 400, perKmRate: 35 },
  van:     { type: 'van',     label: '廂型車', labelEn: 'Van',     capacity: 8, luggageCapacity: 6, baseFare: 500, perKmRate: 40 },
  premium: { type: 'premium', label: '豪華轎車', labelEn: 'Premium', capacity: 4, luggageCapacity: 3, baseFare: 800, perKmRate: 60 },
};

export const EXTRA_SERVICE_PRICE = 200;

export const EXTRA_SERVICES: Array<{ value: ExtraService; label: string; icon: string }> = [
  { value: 'baby-seat',       label: '嬰兒座椅',   icon: 'mdi:baby-face-outline' },
  { value: 'wheelchair',      label: '輪椅協助',   icon: 'mdi:wheelchair-accessibility' },
  { value: 'pickup-sign',     label: '接機舉牌',   icon: 'mdi:card-account-details-outline' },
  { value: 'flight-tracking', label: '即時航班追蹤', icon: 'mdi:airplane-search' },
];

export const ORDER_TYPES: Array<{ value: OrderType; label: string; labelEn: string; icon: string }> = [
  { value: 'airport-pickup',  label: '接機',   labelEn: 'AIRPORT PICKUP',  icon: 'mdi:airplane-landing' },
  { value: 'airport-dropoff', label: '送機',   labelEn: 'AIRPORT DROPOFF', icon: 'mdi:airplane-takeoff' },
  { value: 'charter',         label: '包車',   labelEn: 'CHARTER',         icon: 'mdi:car-clock' },
  { value: 'transfer',        label: '交通接送', labelEn: 'TRANSFER',       icon: 'mdi:map-marker-path' },
];

/** 計算預估車資（無條件進位至最近 50 元） */
export const calculateFare = (
  vehicleType: VehicleType,
  distanceKm: number,
  extraServices: ExtraService[],
): number => {
  const cfg = VEHICLE_CONFIGS[vehicleType];
  const base = cfg.baseFare + distanceKm * cfg.perKmRate;
  const extras = extraServices.length * EXTRA_SERVICE_PRICE;
  return Math.ceil((base + extras) / 50) * 50;
};
