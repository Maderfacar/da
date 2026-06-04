// 全車型 × 7 路線試算 — 用 prod 已寫入的方案 B fare_rules
// 不打 prod、純本機算。用法：node scripts/fare-all-vehicles.mjs

const VEHICLES = [
  { id: 'sedan-suv',       label: 'Sedan/SUV 經濟轎車',  baseFare: 200, perKmRate: 45  },
  { id: 'mpv-family',      label: '家庭 MPV',             baseFare: 200, perKmRate: 50  },
  { id: 'van-9',           label: '九人廂型',             baseFare: 300, perKmRate: 55  },
  { id: 'sedan-business',  label: '商務轎車',             baseFare: 300, perKmRate: 66  },
  { id: 'mpv-vip',         label: '禮賓 MPV',             baseFare: 500, perKmRate: 103 },
  { id: 'van-9-business',  label: '商務九人',             baseFare: 500, perKmRate: 110 },
];

// 方案 B（已寫入 prod fare_rules/v1）
const RULES = {
  rounding: 50,
  distanceTier: {
    enabled: true,
    tiers: [
      { fromKm: 0,   discountPct: 0  },
      { fromKm: 15,  discountPct: 65 },
      { fromKm: 50,  discountPct: 70 },
      { fromKm: 100, discountPct: 68 },
      { fromKm: 200, discountPct: 65 },
    ],
  },
  freeway: { freeKm: 0, ntdPerKm: 1.2 },
  crossCounty: { tieredNtd: [0, 100, 100, 150] },
};

const ROUTES = [
  { name: '台北車站',     km: 40,  freewayKm: 30,  crossings: 0 },
  { name: '竹北車站',     km: 55,  freewayKm: 45,  crossings: 1 },
  { name: '新竹車站',     km: 75,  freewayKm: 60,  crossings: 1 },
  { name: '基隆車站',     km: 70,  freewayKm: 50,  crossings: 2 },
  { name: '竹南車站',     km: 95,  freewayKm: 80,  crossings: 2 },
  { name: '台中車站',     km: 165, freewayKm: 135, crossings: 3 },
  { name: '高雄左營',     km: 360, freewayKm: 320, crossings: 8 },
];

function computeDistanceFee(km, perKm, rule) {
  if (km <= 0 || perKm <= 0) return 0;
  if (!rule.enabled || rule.tiers.length === 0) return km * perKm;
  const sorted = [...rule.tiers].sort((a, b) => a.fromKm - b.fromKm);
  let fee = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const lower = Math.max(0, cur.fromKm);
    const upper = next ? next.fromKm : Infinity;
    if (km <= lower) break;
    const segKm = Math.min(km, upper) - lower;
    if (segKm <= 0) continue;
    const pct = Math.min(100, Math.max(0, cur.discountPct));
    fee += segKm * perKm * (1 - pct / 100);
  }
  return fee;
}
function crossFee(crossings, tier) {
  let total = 0;
  for (let i = 0; i < crossings; i++) {
    const idx = Math.min(i, tier.length - 1);
    total += tier[idx] ?? 0;
  }
  return total;
}
function tollFee(km, rule) {
  return Math.round(Math.max(0, km - rule.freeKm) * rule.ntdPerKm);
}
function calc(v, r) {
  const df = computeDistanceFee(r.km, v.perKmRate, RULES.distanceTier);
  const charged = Math.max(v.baseFare, df);
  const cf = crossFee(r.crossings, RULES.crossCounty.tieredNtd);
  const tf = tollFee(r.freewayKm, RULES.freeway);
  const raw = charged + cf + tf;
  return Math.ceil(raw / RULES.rounding) * RULES.rounding;
}

// ── 大表 ──────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════════════════════');
console.log('全車型 × 7 路線試算（方案 B 已寫入 prod，平日早上非顛峰、無山區、無時段加成）');
console.log('═══════════════════════════════════════════════════════════════════════════════════════');

// 表頭
let header = '路線（↔ 桃機）'.padEnd(15);
for (const v of VEHICLES) header += v.label.padStart(14);
console.log(header);
console.log(''.padEnd(15 + 14 * VEHICLES.length, '─'));

for (const r of ROUTES) {
  let row = `${r.name}（${r.km}km）`.padEnd(15);
  for (const v of VEHICLES) {
    const fare = calc(v, r);
    row += `NT$${String(fare).padStart(6)}`.padStart(14);
  }
  console.log(row);
}

// ── 車型間倍率分析 ─────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════════════════════════════');
console.log('車型間相對倍率（以 sedan-suv 為基準）');
console.log('═══════════════════════════════════════════════════════════════════════════════════════');
let h = '路線'.padEnd(15);
for (const v of VEHICLES) h += v.label.padStart(14);
console.log(h);
console.log(''.padEnd(15 + 14 * VEHICLES.length, '─'));
for (const r of ROUTES) {
  const base = calc(VEHICLES[0], r);
  let row = `${r.name}（${r.km}km）`.padEnd(15);
  for (const v of VEHICLES) {
    const fare = calc(v, r);
    const ratio = (fare / base).toFixed(2);
    row += `×${ratio}`.padStart(14);
  }
  console.log(row);
}

// ── 商務款預估提示 ─────────────────────────────────────────────────
console.log('\n參考：商務款 perKmRate 約是經濟款 1.5×（商務轎車）到 2.4×（禮賓 MPV / 商務九人）');
console.log('短程倍率較低（baseFare floor 拉低），長程倍率接近 perKmRate 比例');
