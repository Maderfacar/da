// 計費反推探針 — 用 prod 真實 fare_rules/v1 與 fleet_vehicles，逐距離試算 sedan-suv
// 不打 prod API、不寫 Firestore。
// 用法：node scripts/fare-probe.mjs

// ── prod 真實參數（從 Firestore 2026-06-04 dump）────────────────────────────
const SEDAN_SUV = { baseFare: 200, perKmRate: 45 };

const RULES = {
  rounding: 50,
  distanceTier: {
    enabled: true,
    tiers: [
      { fromKm: 0,   discountPct: 0  },
      { fromKm: 15,  discountPct: 65 },
      { fromKm: 50,  discountPct: 45 },
      { fromKm: 100, discountPct: 80 },
      { fromKm: 160, discountPct: 55 },
    ],
  },
};

// ── 公式 — 復刻 shared/pricing.ts computeDistanceFee + calculateFareV2 core
function computeDistanceFee(distanceKm, perKmRate, rule) {
  if (distanceKm <= 0 || perKmRate <= 0) return 0;
  if (!rule.enabled || rule.tiers.length === 0) return distanceKm * perKmRate;

  const sorted = [...rule.tiers].sort((a, b) => a.fromKm - b.fromKm);
  let fee = 0;
  const segments = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const lower = Math.max(0, cur.fromKm);
    const upper = next ? next.fromKm : Infinity;
    if (distanceKm <= lower) break;
    const segKm = Math.min(distanceKm, upper) - lower;
    if (segKm <= 0) continue;
    const pct = Math.min(100, Math.max(0, cur.discountPct));
    const effectiveRate = perKmRate * (1 - pct / 100);
    const segFee = segKm * effectiveRate;
    fee += segFee;
    segments.push({ from: lower, to: lower + segKm, km: segKm, discountPct: pct, effectiveRate, segFee });
  }
  return { fee, segments };
}

// 簡化版 calculateFareV2 — 沒山區/跨縣市/國道/塞車/時段（這些靠 Google API 才有）
function quickFare(distanceKm) {
  const { fee: distanceFee, segments } = computeDistanceFee(distanceKm, SEDAN_SUV.perKmRate, RULES.distanceTier);
  const chargedDistanceFee = Math.max(SEDAN_SUV.baseFare, distanceFee);
  const raw = chargedDistanceFee;  // 純里程，無加成
  const final = Math.ceil(raw / RULES.rounding) * RULES.rounding;
  return { distanceKm, distanceFee, chargedDistanceFee, final, segments };
}

// ── 探針：跑常見路線距離（純里程，未含跨縣市/國道/山區）─────────────────
const PROBES = [
  { name: '台北市區→桃機（含國道）', km: 40 },
  { name: '新竹→桃機',              km: 65 },
  { name: '台中→桃機',              km: 165 },
  { name: '台南→桃機',              km: 290 },
  { name: '高雄→桃機',              km: 360 },
  // 邊界
  { name: '15km 邊界',  km: 15 },
  { name: '50km 邊界',  km: 50 },
  { name: '100km 邊界', km: 100 },
  { name: '160km 邊界', km: 160 },
];

console.log('═══ sedan-suv（baseFare=200, perKmRate=45）prod 現行 distanceTier 純里程拆解 ═══');
console.log('注意：以下「純里程車資」不含 跨縣市補貼 / 國道 / 山區係數 / 時段加價，');
console.log('      實際沙盒值會再加上這些加成（跨縣市 150 + 0 + 50 + 100 NTD/級，國道 1.2/km，山區 ×1.1/1.15）。');
console.log('');

for (const p of PROBES) {
  const r = quickFare(p.km);
  console.log(`▸ ${p.name}（${p.km} km）`);
  console.log('  里程分段拆：');
  for (const s of r.segments) {
    console.log(`    [${s.from}–${s.to}km] ${s.km}km × ${s.effectiveRate.toFixed(2)} = ${s.segFee.toFixed(0)}（折 ${s.discountPct}%）`);
  }
  console.log(`  distanceFee = ${r.distanceFee.toFixed(0)}`);
  console.log(`  chargedDistanceFee (max(baseFare, distanceFee)) = ${r.chargedDistanceFee.toFixed(0)}`);
  console.log(`  純里程進位後 = NT$ ${r.final}`);
  console.log('');
}

// ── 加成範例（台中→桃機）─────────────────────────────────────────────
console.log('═══ 台中→桃機 165km 完整加成示意（sedan-suv，平日早上 09:00 非顛峰）═══');
const c = quickFare(165);
const crossCountyFee = 150 + 50 + 100; // 跨 3 縣市（台中→苗栗→新竹→桃園 = 3 跨）= [150,0,50,100] 取前 3 階
const freewayToll = (135 - 0) * 1.2;   // 國道 ~135km × 1.2，freeKm=0
const mountainMul = 1;                  // 平地不套
const variableScaled = c.chargedDistanceFee * mountainMul;
const raw = variableScaled + crossCountyFee + freewayToll;
const final = Math.ceil(raw / 50) * 50;
console.log(`  純里程小計：${c.chargedDistanceFee.toFixed(0)}`);
console.log(`  跨縣市補貼（3 跨）：${crossCountyFee}`);
console.log(`  國道 (135km × 1.2)：${freewayToll.toFixed(0)}`);
console.log(`  raw = ${raw.toFixed(0)}`);
console.log(`  進位後 = NT$ ${final}`);
console.log('');
console.log('（若沙盒實測台中→桃機顯著 > 這個數字，要查塞車費或時段加成是否誤觸發）');
