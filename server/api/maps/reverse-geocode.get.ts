// 逆向地理編碼 BFF — Drop Pin 後將座標轉為地址資訊

interface ReverseGeocodeData {
  displayName: string;
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

interface UnifiedResponse<T> {
  data: T;
  status: { code: number; message: { zh_tw: string; en: string; ja: string } };
}

const TW_SW = { lat: 21.8, lng: 120.0 };
const TW_NE = { lat: 25.3, lng: 122.0 };

function isInTaiwan(lat: number, lng: number): boolean {
  return lat >= TW_SW.lat && lat <= TW_NE.lat && lng >= TW_SW.lng && lng <= TW_NE.lng;
}

export default defineEventHandler(async (event): Promise<UnifiedResponse<ReverseGeocodeData | Record<string, never>>> => {
  const query = getQuery(event);
  const { lat: latStr, lng: lngStr } = query as { lat?: string; lng?: string };

  const lat = parseFloat(latStr ?? '');
  const lng = parseFloat(lngStr ?? '');

  if (isNaN(lat) || isNaN(lng)) {
    return {
      data: {},
      status: {
        code: 400,
        message: {
          zh_tw: '缺少或無效的 lat/lng 參數',
          en: 'Missing or invalid lat/lng parameters',
          ja: 'lat/lng パラメータが不足または無効です',
        },
      },
    };
  }

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
      latlng: `${lat},${lng}`,
      key: apiKey,
      language: 'zh-TW',
      result_type: 'establishment|point_of_interest|route|street_address',
    });

    const res = await $fetch<{
      status: string;
      error_message?: string;
      results: Array<{
        place_id: string;
        formatted_address: string;
        address_components: Array<{ long_name: string; types: string[] }>;
        types: string[];
      }>;
    }>(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);

    if (res.status !== 'OK' && res.status !== 'ZERO_RESULTS') {
      throw new Error(res.error_message || res.status);
    }

    if (!res.results?.length) {
      return {
        data: {},
        status: {
          code: 404,
          message: {
            zh_tw: '找不到該座標的地址資訊',
            en: 'No address found for the given coordinates',
            ja: '指定された座標の住所が見つかりません',
          },
        },
      };
    }

    const best = res.results[0];
    // 取最具名稱意義的地址分量作為 displayName
    const nameComp = best.address_components.find((c) =>
      c.types.some((t) => ['establishment', 'point_of_interest', 'route', 'sublocality_level_1'].includes(t))
    );
    const displayName = nameComp?.long_name ?? best.formatted_address.split(',')[0];

    return {
      data: {
        displayName,
        address: best.formatted_address,
        lat,
        lng,
        placeId: best.place_id,
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
          zh_tw: `逆向地理編碼失敗：${msg}`,
          en: `Reverse geocoding failed: ${msg}`,
          ja: `逆ジオコーディングに失敗しました：${msg}`,
        },
      },
    };
  }
});
