import type { AutocompleteRes, GooglePlace, PlaceSuggestion } from './type';
import type { FareBreakdownV2, RouteMetrics } from '~shared/pricing';
import methods from '../../methods';

/** 地址自動完成建議（輸入 2 字以上才呼叫） */
export const GetMapsAutocomplete = (params: { input: string; sessiontoken?: string }) =>
  methods.get<AutocompleteRes>('/api/maps/autocomplete', params);

/** 以 placeId 取得完整座標（含台灣圍欄驗證） */
export const GetMapsPlaceDetails = (params: { placeId: string; sessiontoken?: string }) =>
  methods.get<GooglePlace>('/api/maps/place-details', params);

/** 逆向地理編碼：座標 → 地址（Drop Pin 使用） */
export const GetMapsReverseGeocode = (params: { lat: number; lng: number }) =>
  methods.get<GooglePlace>('/api/maps/reverse-geocode', params);

/** 預估距離與車程（起點→終點） */
export const GetMapsDistance = (params: { origin: string; destination: string }) =>
  methods.get<{ distance_km: number; duration_minutes: number; origin: string; destination: string }>(
    '/api/maps/distance',
    params
  );

export interface MapsRouteRes {
  // 幾何（地圖繪製）
  polyline: string;
  bounds: { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } } | null;
  distance_km: number;
  duration_minutes: number;
  // 車資（純幾何模式為 null；帶 vehicleType + pickupTime 才有）
  fareVersion: 'v1' | 'v2' | null;
  fareTotal: number | null;
  fareBreakdown: FareBreakdownV2 | null;
  routeMetrics: RouteMetrics | null;
  static_duration_minutes: number | null;
  pure_jam_minutes: number | null;
}

/**
 * 取得路線。
 * - 純幾何模式（只傳 origin/destination/waypoints）：回 polyline / 距離 / 車程
 * - 車資模式（另傳 vehicleType + pickupTime）：另回 Fare V2 明細 fareBreakdown / routeMetrics
 */
export const GetMapsRoute = (params: {
  origin: string;
  destination: string;
  waypoints?: string;
  vehicleType?: string;
  pickupTime?: string;
  extras?: string;
  /** 行程類型 — 車資模式下供時段規則的行程過濾 */
  orderType?: string;
}) => methods.get<MapsRouteRes>('/api/maps/route', params);

export type { AutocompleteRes, GooglePlace, PlaceSuggestion };
export type { FareBreakdownV2, RouteMetrics } from '~shared/pricing';
