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

    // ── 資料解析度偵測 ───────────────────────────────────────────
    // 是否有真實的航廈分項（T1/T2 資料與 all 不同）
    const hasT1Data = payload.hours.some(h => h.terminal === 'T1' && h.forecastCount > 0);
    const hasT2Data = payload.hours.some(h => h.terminal === 'T2' && h.forecastCount > 0);
    const hasTerminalBreakdown = hasT1Data || hasT2Data;

    // 是否有真實的方向分項（arrival/departure 值與彼此不同）
    const arrRows = payload.hours.filter(h => h.direction === 'arrival');
    const depRows = payload.hours.filter(h => h.direction === 'departure');
    const hasDirectionalBreakdown = arrRows.length > 0
      && depRows.length > 0
      && arrRows.some((a, i) => a.forecastCount !== (depRows[i]?.forecastCount ?? a.forecastCount));

    // ── 航廈篩選 ────────────────────────────────────────────────
    let terminalFiltered = terminal === 'all'
      ? payload.hours
      : payload.hours.filter(h => h.terminal === terminal);

    let terminalFallback = false;
    if (terminal !== 'all' && terminalFiltered.length === 0) {
      terminalFiltered = payload.hours.filter(h => h.terminal === 'all');
      terminalFallback = true;
    }
    // 有 T1/T2 列但與 all 值完全相同，也視為 fallback
    if (!terminalFallback && terminal !== 'all' && !hasTerminalBreakdown) {
      terminalFallback = true;
    }

    // ── 方向篩選 ─────────────────────────────────────────────────
    let directionFiltered: typeof terminalFiltered;
    let directionFallback = false;

    if (direction === 'all') {
      const withAll = terminalFiltered.filter(h => h.direction === 'all');
      directionFiltered = withAll.length > 0
        ? withAll
        : terminalFiltered.filter(h => h.direction === undefined || h.direction === null);
    } else {
      const specific = terminalFiltered.filter(h => h.direction === direction);
      if (specific.length > 0 && hasDirectionalBreakdown) {
        directionFiltered = specific;
      } else {
        // 找不到分項資料，或分項值與合計相同 → fallback
        directionFallback = true;
        const withAll = terminalFiltered.filter(h => h.direction === 'all');
        directionFiltered = withAll.length > 0
          ? withAll
          : terminalFiltered.filter(h => h.direction === undefined || h.direction === null);
      }
    }

    // ── 依小時彙總 ───────────────────────────────────────────────
    const hours = Array.from({ length: 24 }, (_, i) => {
      const matched = directionFiltered.filter(h => h.hour === i);
      const forecastCount = matched.reduce((sum, h) => sum + (h.forecastCount ?? 0), 0);
      return { hour: i, forecastCount, actualCount: null };
    });

    return {
      data: {
        date,
        hours,
        isMock: false,
        terminalFallback,
        directionFallback,
        hasTerminalBreakdown,
        hasDirectionalBreakdown,
      },
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
  return { date, hours, isMock: true, terminalFallback: false, directionFallback: false, hasTerminalBreakdown: false, hasDirectionalBreakdown: false };
}
