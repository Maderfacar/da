export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { date?: string };
  const date = query.date ?? new Date().toISOString().slice(0, 10);

  const { airportForecastGistUrl } = useRuntimeConfig();

  if (!airportForecastGistUrl) {
    return { data: _mockData(date), status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
  }

  try {
    // 從 Gist 讀取指定日期的資料（raw URL base + /airport-{date}.json）
    const rawUrl = `${airportForecastGistUrl.replace(/\/$/, '')}/airport-${date}.json`;
    const payload = await $fetch<{
      date: string;
      hours: Array<{ hour: number; forecastCount: number; terminal: string }>;
    }>(rawUrl, { headers: { 'Cache-Control': 'no-cache' } });

    if (!payload?.hours?.length) {
      return { data: _mockData(date), status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
    }

    const hours = Array.from({ length: 24 }, (_, i) => {
      const found = payload.hours.find(h => h.hour === i);
      return { hour: i, forecastCount: found?.forecastCount ?? 0, actualCount: null };
    });

    return {
      data: { date, hours, isMock: false },
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  } catch {
    return { data: _mockData(date), status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
  }
});

function _mockData(date: string) {
  const peak = [0, 0, 0, 50, 120, 280, 450, 520, 480, 400, 380, 350,
    320, 290, 310, 380, 460, 520, 490, 420, 300, 200, 100, 30];
  const hours = peak.map((v, i) => ({ hour: i, forecastCount: v, actualCount: null }));
  return { date, hours, isMock: true };
}
