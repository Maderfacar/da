/** 地圖相關型別定義 */

export interface GooglePlace {
  displayName: string; // 顯示用（地點名稱，如「桃園國際機場」）
  address: string;     // API 用（完整地址）
  lat: number;
  lng: number;
  placeId?: string;
  /** 縣市過濾用：administrative_area_level_1 中文名（如「台北市」「桃園市」） */
  city?: string;
  /** 縣市過濾用：administrative_area_level_2 / level_3 中文名（如「中正區」「龜山區」） */
  district?: string;
}

export interface PlaceSuggestion {
  displayName: string;
  address: string;
  placeId: string;
}

export interface AutocompleteRes {
  suggestions: PlaceSuggestion[];
}
