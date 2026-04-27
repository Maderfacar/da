import type { AutocompleteRes, GooglePlace, PlaceSuggestion } from './type';
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

/** 取得路線 encoded polyline（供地圖繪製使用，Server Key 呼叫 Directions API） */
export const GetMapsRoute = (params: { origin: string; destination: string; waypoints?: string }) =>
  methods.get<{
    polyline: string;
    bounds: { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } };
    distance_km: number;
    duration_minutes: number;
  }>('/api/maps/route', params);

export type { AutocompleteRes, GooglePlace, PlaceSuggestion };
