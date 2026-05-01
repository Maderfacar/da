export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { date?: string };
  const date = query.date ?? new Date().toISOString().slice(0, 10);

  const { airportForecastGistUrl } = useRuntimeConfig();

  if (!airportForecastGistUrl) {
    return { data: { ..._mockData(date), _debug: 'no_env_var' }, status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
  }

  const rawUrl = `${airportForecastGistUrl.replace(/\/$/, '')}/airport-${date}.json`;

  try {
    // GitHub raw URL 回傳 text/plain，用 responseType: 'text' 取得原始字串再手動 JSON.parse
    const raw = await $fetch<string>(rawUrl, {
      responseType: 'text',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const payload = JSON.parse(raw) as {
      date: string;
      hours: Array<{ hour: number; forecastCount: number; terminal: string }>;
    };

    if (!payload?.hours?.length) {
      return { data: { ..._mockData(date), _debug: 'empty_payload' }, status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
    }

    const hours = Array.from({ length: 24 }, (_, i) => {
      const found = payload.hours.find(h => h.hour === i);
      return { hour: i, forecastCount: found?.forecastCount ?? 0, actualCount: null };
    });

    return {
      data: { date, hours, isMock: false },
      status: { code: 200, message: { zh_tw: '', en: '', ja: '' } },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { data: { ..._mockData(date), _debug: `fetch_error: ${msg.slice(0, 120)}` }, status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
  }
});

function _mockData(date: string) {
  const peak = [0, 0, 0, 50, 120, 280, 450, 520, 480, 400, 380, 350,
    320, 290, 310, 380, 460, 520, 490, 420, 300, 200, 100, 30];
  const hours = peak.map((v, i) => ({ hour: i, forecastCount: v, actualCount: null }));
  return { date, hours, isMock: true };
}
