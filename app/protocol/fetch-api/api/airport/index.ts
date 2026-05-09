import methods from '@/protocol/fetch-api/methods';

// 新 endpoint /api/airport/flow 的原始回應 data 結構
interface FlowApiResponseData {
  date: string;
  hours: Array<{ hour: number; forecastCount: number; actualCount: number | null }>;
  isMock?: boolean;
  mockReason?: string;
}

/**
 * 取桃園機場每日航班人流預報。
 * 後端：GET /api/airport/flow（lazy fetch + Firestore cache）
 * 此 facade 將原始 hours[] 加總出 totalForecast / peakHour / peakCount，補齊 widget 既有期望欄位。
 */
export const GetAirportForecast = async (params: { date?: string } = {}): Promise<ApiRes<AirportForecastData>> => {
  const date = params.date ?? new Date().toISOString().slice(0, 10);
  const res = await methods.get<FlowApiResponseData>('/api/airport/flow', {
    date,
    terminal: 'all',
    direction: 'all',
  });

  const flowData = res?.data as FlowApiResponseData | undefined;
  if (!flowData?.hours?.length) {
    return res as unknown as ApiRes<AirportForecastData>;
  }

  const hours = flowData.hours;
  const total = hours.reduce((sum, h) => sum + (h.forecastCount ?? 0), 0);
  let peakHour = 0;
  let peakCount = 0;
  for (const h of hours) {
    if (h.forecastCount > peakCount) {
      peakCount = h.forecastCount;
      peakHour = h.hour;
    }
  }

  const data: AirportForecastData = {
    date: flowData.date,
    hours: hours.map((h) => ({ hour: h.hour, forecastCount: h.forecastCount, terminal: 'all' })),
    totalForecast: total,
    peakHour,
    peakCount,
    sourceFile: '',
    updatedAt: Date.now(),
    isMock: flowData.isMock,
    mockReason: flowData.mockReason,
  };

  return { ...res, data } as ApiRes<AirportForecastData>;
};

export const GetWeather = (params: { dataset?: string; locationName?: string } = {}) =>
  methods.get<unknown>('/nuxt-api/weather', {
    dataset: 'F-C0032-001',
    locationName: '桃園市',
    ...params,
  });
