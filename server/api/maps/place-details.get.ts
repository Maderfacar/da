// 地點詳情 BFF — 以 placeId 取得完整座標資訊（供 UiGooglePlaceInput onSelect 使用）

interface PlaceDetailData {
  displayName: string;
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

interface UnifiedResponse<T> {
  data: T;
  status: { code: number; message: { zh_tw: string; en: string; ja: string } };
}

// 台灣本島邊界
const TW_SW = { lat: 21.8, lng: 120.0 };
const TW_NE = { lat: 25.3, lng: 122.0 };

function isInTaiwan(lat: number, lng: number): boolean {
  return lat >= TW_SW.lat && lat <= TW_NE.lat && lng >= TW_SW.lng && lng <= TW_NE.lng;
}

export default defineEventHandler(async (event): Promise<UnifiedResponse<PlaceDetailData | Record<string, never>>> => {
  const query = getQuery(event);
  const { placeId, sessiontoken } = query as { placeId?: string; sessiontoken?: string };

  if (!placeId) {
    return {
      data: {},
      status: {
        code: 400,
        message: {
          zh_tw: '缺少 placeId 參數',
          en: 'Missing placeId parameter',
          ja: 'placeId パラメータが不足しています',
        },
      },
    };
  }

  const apiKey = useRuntimeConfig().googleMapsApiKey;
  if (!apiKey) {
    return {
      data: {},
      status: {
        code: 500,
        message: {
          zh_tw: '伺服器 Maps API Key 未設定',
          en: 'Server Maps API Key not configured',
          ja: 'サーバー Maps API Key が設定されていません',
        },
      },
    };
  }

  try {
    const params = new URLSearchParams({
      place_id: placeId,
      key: apiKey,
      fields: 'name,formatted_address,geometry',
      language: 'zh-TW',
      ...(sessiontoken ? { sessiontoken } : {}),
    });

    const res = await $fetch<{
      status: string;
      error_message?: string;
      result: {
        name: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
      };
    }>(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`);

    if (res.status !== 'OK') {
      throw new Error(res.error_message || res.status);
    }

    const { lat, lng } = res.result.geometry.location;

    if (!isInTaiwan(lat, lng)) {
      return {
        data: {},
        status: {
          code: 400,
          message: {
            zh_tw: '所選地點不在台灣本島服務範圍內',
            en: 'Selected location is outside Taiwan service area',
            ja: '選択した場所は台湾本島のサービスエリア外です',
          },
        },
      };
    }

    return {
      data: {
        displayName: res.result.name,
        address: res.result.formatted_address,
        lat,
        lng,
        placeId,
      },
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: {},
      status: {
        code: 500,
        message: {
          zh_tw: `地點詳情取得失敗：${msg}`,
          en: `Failed to get place details: ${msg}`,
          ja: `地点の詳細取得に失敗しました：${msg}`,
        },
      },
    };
  }
});
