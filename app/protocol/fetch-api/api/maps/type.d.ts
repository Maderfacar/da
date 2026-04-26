/** 地圖相關型別定義 */

export interface GooglePlace {
  displayName: string; // 顯示用（地點名稱，如「桃園國際機場」）
  address: string;     // API 用（完整地址）
  lat: number;
  lng: number;
  placeId?: string;
}

export interface PlaceSuggestion {
  displayName: string;
  address: string;
  placeId: string;
}

export interface AutocompleteRes {
  suggestions: PlaceSuggestion[];
}
