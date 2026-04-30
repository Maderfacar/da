/**
 * GET /nuxt-api/weather
 *
 * 中央氣象署（CWA）開放資料 BFF 端點
 * 文件：https://opendata.cwa.gov.tw/dist/opendata-swagger.html
 *
 * Query params:
 *   dataset  — 資料集 ID，例如 F-C0032-001（36 小時天氣預報）
 *              預設值：F-C0032-001
 *   locationName — 縣市名稱過濾，例如「桃園市」（可選）
 *
 * 後續業務邏輯依需求擴充。
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  if (!config.cwaApiKey) {
    return {
      data: null,
      status: {
        code: 500,
        message: {
          zh_tw: '氣象 API 金鑰未設定',
          en: 'Weather API key is not configured',
          ja: '気象 API キーが設定されていません',
        },
      },
    };
  }

  const query = getQuery(event) as {
    dataset?: string;
    locationName?: string;
  };

  const dataset = query.dataset ?? 'F-C0032-001';
  const baseUrl = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataset}`;

  const params = new URLSearchParams({
    Authorization: config.cwaApiKey,
    format: 'JSON',
  });

  if (query.locationName) {
    params.set('locationName', query.locationName);
  }

  const fullUrl = `${baseUrl}?${params.toString()}`;
  console.info('[weather/get] 呼叫 CWA API:', baseUrl, '| dataset:', dataset, '| locationName:', query.locationName ?? '未指定');

  try {
    const res = await $fetch<unknown>(fullUrl);
    console.info('[weather/get] CWA API 回應成功');

    return {
      data: res,
      status: {
        code: 200,
        message: { zh_tw: '', en: '', ja: '' },
      },
    };
  } catch (err: any) {
    const status = err?.response?.status ?? 'unknown';
    const body = err?.data ?? err?.message ?? String(err);
    console.error(`[weather/get] CWA API 失敗 (HTTP ${status}):`, body);
    return {
      data: null,
      status: {
        code: 502,
        message: {
          zh_tw: `氣象資料取得失敗（HTTP ${status}）`,
          en: `Failed to fetch weather data (HTTP ${status})`,
          ja: `気象データの取得に失敗しました（HTTP ${status}）`,
        },
      },
    };
  }
});
