// 地址自動完成 BFF — 前端嚴禁直接呼叫 Maps API，金鑰僅存於伺服器端
// 回傳建議清單（含 placeId）；lat/lng 由後續 place-details 端點取得

interface PlaceSuggestion {
  displayName: string;
  address: string;
  placeId: string;
}

interface AutocompleteData {
  suggestions: PlaceSuggestion[];
}

interface UnifiedResponse<T> {
  data: T;
  status: { code: number; message: { zh_tw: string; en: string; ja: string } };
}

export default defineEventHandler(async (event): Promise<UnifiedResponse<AutocompleteData | Record<string, never>>> => {
  const query = getQuery(event);
  const { input, sessiontoken } = query as { input?: string; sessiontoken?: string };

  if (!input || input.trim().length < 2) {
    return {
      data: { suggestions: [] },
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
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
      input: input.trim(),
      key: apiKey,
      language: 'zh-TW',
      components: 'country:tw',
      // 台灣本島 strictBounds 偏好
      locationbias: 'rectangle:21.8,120.0|25.3,122.0',
      ...(sessiontoken ? { sessiontoken } : {}),
    });

    const res = await $fetch<{
      status: string;
      error_message?: string;
      predictions: Array<{
        place_id: string;
        description: string;
        structured_formatting: { main_text: string; secondary_text?: string };
      }>;
    }>(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`);

    if (res.status !== 'OK' && res.status !== 'ZERO_RESULTS') {
      throw new Error(res.error_message || res.status);
    }

    const suggestions: PlaceSuggestion[] = (res.predictions || []).slice(0, 5).map((p) => ({
      displayName: p.structured_formatting.main_text,
      address: p.description,
      placeId: p.place_id,
    }));

    return {
      data: { suggestions },
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: {},
      status: {
        code: 500,
        message: {
          zh_tw: `地址搜尋失敗：${msg}`,
          en: `Address search failed: ${msg}`,
          ja: `住所検索に失敗しました：${msg}`,
        },
      },
    };
  }
});
