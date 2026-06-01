// ===== Fleet 計價設定 API（P23）=====
// 與 server/utils/fleet-config.ts 對齊；同型別也存於 shared/pricing.ts 供前後端共用。

interface I18nLabelDto {
  zh: string;
  en: string;
  ja: string;
}

// ===== Charter Fare V1：包車三檔時長套餐 =====
// 與 shared/pricing.ts::CharterPlan 對齊；W1 鎖介面，W2 server 端 plumbing。
type CharterPlanKeyDto = '4h' | '8h' | '10h';

interface CharterPlanDto {
  key: CharterPlanKeyDto;
  durationHours: number;
  basePrice: number;
  includedKm: number;
  extraKmRate: number;
  overtimeRatePer30min: number;
  enabled: boolean;
}

interface FleetVehicleDto {
  id: string;
  label: I18nLabelDto;
  capacity: number;
  /** @deprecated SU 系統已停用（airport-calibration wave）；保留欄位向後相容既有資料 */
  luggageSU?: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  /** Booking v2：車型卡情境文案三語（optional） */
  tagline?: I18nLabelDto;
  /** 行李容量與適用情境的市面描述（三語；UI 取代 SU 對照表） */
  luggageDescription?: I18nLabelDto;
  /** 車卡圖庫（exterior 為主圖；interior / trunk 補充） */
  images?: VehicleImagesDto;
  /** Charter Fare V1：包車三檔時長套餐（optional；缺省時 charter 訂單 fallback fare-v2） */
  charterPlans?: Partial<Record<CharterPlanKeyDto, CharterPlanDto>>;
}

interface VehicleImagesDto {
  exterior?: string;
  interior?: string;
  trunk?: string;
}

type VehicleImageSlotDto = 'exterior' | 'interior' | 'trunk';

interface UploadVehicleImageRes {
  url: string;
  objectPath: string;
  slot: VehicleImageSlotDto;
  sizeBytes: number;
  mime: string;
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
  /** Fare V2 進階規則（server 側來自 fare_rules/v1 或預設）— 型別實為 FareRules（~shared/pricing），呼叫端自行 cast */
  fareRules: Record<string, unknown>;
}

// ===== Admin CRUD payload =====
type FleetResource = 'vehicles' | 'luggage-types' | 'extras';

interface CreateVehiclePayload {
  id?: string;
  label: I18nLabelDto;
  capacity: number;
  /** @deprecated 保留向後相容；可省略或填 0 */
  luggageSU?: number;
  baseFare: number;
  perKmRate: number;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  /** Booking v2：車型卡情境文案三語（optional；null 表示清除） */
  tagline?: I18nLabelDto | null;
  /** 行李容量與適用情境的市面描述（三語；optional，null 表示清除） */
  luggageDescription?: I18nLabelDto | null;
  /** 車卡圖庫（optional；null 表示清除整個物件） */
  images?: VehicleImagesDto | null;
  /** Charter Fare V1：包車三檔時長套餐（optional；null 表示清除整個 map） */
  charterPlans?: Partial<Record<CharterPlanKeyDto, CharterPlanDto>> | null;
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
