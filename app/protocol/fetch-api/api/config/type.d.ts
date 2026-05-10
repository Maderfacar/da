// ===== Fleet 計價設定 API（P23）=====
// 與 server/utils/fleet-config.ts 對齊；同型別也存於 shared/pricing.ts 供前後端共用。

interface I18nLabelDto {
  zh: string;
  en: string;
  ja: string;
}

interface FleetVehicleDto {
  id: string;
  label: I18nLabelDto;
  capacity: number;
  luggageSU: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

interface FleetLuggageTypeDto {
  id: string;
  label: I18nLabelDto;
  su: number;
  sortOrder: number;
}

interface FleetExtraDto {
  id: string;
  label: I18nLabelDto;
  price: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

interface GetFleetConfigRes {
  vehicles: FleetVehicleDto[];
  luggageTypes: FleetLuggageTypeDto[];
  extras: FleetExtraDto[];
}

// ===== Admin CRUD payload =====
type FleetResource = 'vehicles' | 'luggage-types' | 'extras';

interface CreateVehiclePayload {
  id?: string;
  label: I18nLabelDto;
  capacity: number;
  luggageSU: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

interface CreateLuggageTypePayload {
  id?: string;
  label: I18nLabelDto;
  su: number;
  sortOrder: number;
}

interface CreateExtraPayload {
  id?: string;
  label: I18nLabelDto;
  price: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}
