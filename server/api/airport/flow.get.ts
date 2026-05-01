export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { date?: string; terminal?: string; direction?: string };
  const date = query.date ?? new Date().toISOString().slice(0, 10);
  const terminal = query.terminal ?? 'all';
  const direction = query.direction ?? 'all';

  const { airportForecastGistUrl } = useRuntimeConfig();

  if (!airportForecastGistUrl) {
    return { data: _mockData(date), status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
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
      hours: Array<{ hour: number; forecastCount: number; terminal: string; direction?: string }>;
    };

    if (!payload?.hours?.length) {
      return { data: _mockData(date), status: { code: 200, message: { zh_tw: '', en: '', ja: '' } } };
    }

    // 過濾 terminal：'all' 時接受所有資料（包含 terminal==='all' 的合計列）
    // 若指定 T1/T2，只取 terminal 完全吻合的列
    const terminalFiltered = terminal === 'all'
      ? payload.hours
      : payload.hours.filter(h => h.terminal === terminal);

    // 過濾 direction：'all' 時不限制；指定時篩選 direction 欄位
    const directionFiltered = direction === 'all'
      ? terminalFiltered
      : terminalFiltered.filter(h => h.direction === direction);

    // 依小時彙總（同一小時可能有多列 → 加總）
    const hours = Array.from({ length: 24 }, (_, i) => {
      const matched = directionFiltered.filter(h => h.hour === i);
      const forecastCount = matched.reduce((sum, h) => sum + (h.forecastCount ?? 0), 0);
      return { hour: i, forecastCount, actualCount: null };
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
