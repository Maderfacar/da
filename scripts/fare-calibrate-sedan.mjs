// sedan-suv distanceTier 反推探針
// 給 Brain AI 6 條路線預期金額，逐條拆「現行 prod 算多少」「預期需要純里程多少」「平均單價」
// 並提出 2-3 個 tier 方案模擬。不打 prod、不寫 Firestore。
//
// 用法：node scripts/fare-calibrate-sedan.mjs

const SEDAN = { baseFare: 200, perKmRate: 45 };

// ── prod 現行 fare_rules/v1（2026-06-04 dump）─────────────────────────────
const PROD = {
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
  freeway: { freeKm: 0, ntdPerKm: 1.2 },
  crossCounty: { tieredNtd: [150, 0, 50, 100] },
};

// ── 路線資料（距離 / 國道 / 跨縣市 / 山區 概估，從 Google Routes 經驗值）────
// crossings = 訪問縣市數 - 1，依 tieredNtd 累加
// 北北桃內互跨會 excludeTpeNtpeTyn 排除 → 算 0 跨
const ROUTES = [
  { name: '桃機 ↔ 台北市區',    expected: 1100, km: 40,  freewayKm: 30,  crossings: 0,            note: '前次確認 ok' },
  { name: '桃機 ↔ 竹北',         expected: 1300, km: 55,  freewayKm: 45,  crossings: 1,            note: '新給' },
  { name: '桃機 ↔ 新竹 / 竹東',  expected: 1500, km: 75,  freewayKm: 60,  crossings: 1,            note: '新給' },
  { name: '桃機 ↔ 基隆',         expected: 1500, km: 70,  freewayKm: 50,  crossings: 2,            note: '新給；山區可能觸發' },
  { name: '桃機 ↔ 竹南',         expected: 1800, km: 95,  freewayKm: 80,  crossings: 2,            note: '新給' },
  { name: '桃機 ↔ 台中',         expected: 2900, km: 165, freewayKm: 135, crossings: 3,            note: '新給' },
  { name: '桃機 ↔ 高雄',         expected: 6500, km: 360, freewayKm: 320, crossings: 8,            note: '新給' },
];

// ── helpers ────────────────────────────────────────────────────────────
function computeDistanceFee(distanceKm, perKmRate, rule) {
  if (distanceKm <= 0 || perKmRate <= 0) return 0;
  if (!rule.enabled || rule.tiers.length === 0) return distanceKm * perKmRate;
  const sorted = [...rule.tiers].sort((a, b) => a.fromKm - b.fromKm);
  let fee = 0;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const lower = Math.max(0, cur.fromKm);
    const upper = next ? next.fromKm : Infinity;
    if (distanceKm <= lower) break;
    const segKm = Math.min(distanceKm, upper) - lower;
    if (segKm <= 0) continue;
    const pct = Math.min(100, Math.max(0, cur.discountPct));
    fee += segKm * perKmRate * (1 - pct / 100);
  }
  return fee;
}
function crossCountyFee(crossings, tier) {
  let total = 0;
  for (let i = 0; i < crossings; i++) {
    const idx = Math.min(i, tier.length - 1);
    total += tier[idx] ?? 0;
  }
  return total;
}
function freewayToll(km, rule) {
  return Math.round(Math.max(0, km - rule.freeKm) * rule.ntdPerKm);
}

function calcFare(routeKm, freewayKm, crossings, rules, mountainMul = 1) {
  const distanceFee = computeDistanceFee(routeKm, SEDAN.perKmRate, rules.distanceTier);
  const charged = Math.max(SEDAN.baseFare, distanceFee);
  const variableScaled = charged * mountainMul;
  const cross = crossCountyFee(crossings, rules.crossCounty);
  const tollFee = freewayToll(freewayKm, rules.freeway);
  const raw = variableScaled + cross + tollFee;
  const final = Math.ceil(raw / rules.rounding) * rules.rounding;
  return { distanceFee, charged, variableScaled, cross, tollFee, raw, final };
}

// ── 第 1 表：現行 prod 算出來 vs Brain AI 預期 ─────────────────────────
console.log('═════════════════════════════════════════════════════════════════');
console.log('表 1：現行 prod 規則算出來 vs Brain AI 預期');
console.log('═════════════════════════════════════════════════════════════════');
console.log('路線                          距離   現行算   預期    差     %誤差');
console.log('---------------------------------------------------------------');
for (const r of ROUTES) {
  const c = calcFare(r.km, r.freewayKm, r.crossings, PROD);
  const diff = c.final - r.expected;
  const pct = ((diff / r.expected) * 100).toFixed(1);
  const flag = Math.abs(diff) <= 100 ? '✓' : (diff > 0 ? '↑' : '↓');
  console.log(`${r.name.padEnd(26)} ${String(r.km).padStart(4)}km  ${String(c.final).padStart(5)}   ${String(r.expected).padStart(5)}  ${String(diff).padStart(5)}  ${pct.padStart(6)}% ${flag}`);
}

// ── 第 2 表：把跨縣市/國道扣掉，看「純里程目標」 ──────────────────────
console.log('\n═════════════════════════════════════════════════════════════════');
console.log('表 2：扣掉跨縣市 + 國道後的「純里程目標」與平均單價');
console.log('═════════════════════════════════════════════════════════════════');
console.log('路線                  距離   預期   跨縣市  國道   純里程   avg/km');
console.log('-----------------------------------------------------------------');
const datapoints = [];
for (const r of ROUTES) {
  const cross = crossCountyFee(r.crossings, PROD.crossCounty);
  const toll = freewayToll(r.freewayKm, PROD.freeway);
  const targetCharged = r.expected - cross - toll;
  const avg = (targetCharged / r.km).toFixed(2);
  datapoints.push({ km: r.km, target: targetCharged, name: r.name });
  console.log(`${r.name.padEnd(20)} ${String(r.km).padStart(4)}km  ${String(r.expected).padStart(5)}  ${String(cross).padStart(5)}   ${String(toll).padStart(4)}   ${String(targetCharged).padStart(5)}   ${avg.padStart(6)}`);
}

// ── 矛盾檢查 ───────────────────────────────────────────────────────────
console.log('\n═════════════════════════════════════════════════════════════════');
console.log('內部一致性檢查（純里程 / 距離 應隨距離單調遞減）');
console.log('═════════════════════════════════════════════════════════════════');
datapoints.sort((a, b) => a.km - b.km);
for (let i = 1; i < datapoints.length; i++) {
  const prev = datapoints[i - 1];
  const cur = datapoints[i];
  const segKm = cur.km - prev.km;
  const segFee = cur.target - prev.target;
  const segAvg = (segFee / segKm).toFixed(2);
  console.log(`${prev.name.split('↔')[1]?.trim().padEnd(15) || prev.name.padEnd(15)} → ${cur.name.split('↔')[1]?.trim().padEnd(15) || cur.name.padEnd(15)} 增 ${String(segKm).padStart(4)}km / +NT$${String(segFee).padStart(5)} / 每 km ${segAvg.padStart(6)}`);
}

// ── 方案 A：純調 distanceTier（守住 prod 跨縣市 + 國道）─────────────
const PLAN_A = {
  rounding: 50,
  distanceTier: {
    enabled: true,
    tiers: [
      { fromKm: 0,   discountPct: 0 },
      { fromKm: 15,  discountPct: 65 },
      { fromKm: 50,  discountPct: 73 },
      { fromKm: 100, discountPct: 70 },
      { fromKm: 200, discountPct: 68 },
    ],
  },
  freeway: PROD.freeway,
  crossCounty: PROD.crossCounty,
};

// ── 方案 B：調 distanceTier + 短程少收跨縣市（第 1 跨改 0）─────────
const PLAN_B = {
  rounding: 50,
  distanceTier: {
    enabled: true,
    tiers: [
      { fromKm: 0,   discountPct: 0 },
      { fromKm: 15,  discountPct: 65 },
      { fromKm: 50,  discountPct: 70 },
      { fromKm: 100, discountPct: 68 },
      { fromKm: 200, discountPct: 65 },
    ],
  },
  freeway: PROD.freeway,
  crossCounty: { tieredNtd: [0, 100, 100, 150] }, // 第 1 跨不收，從第 2 跨開始
};

// ── 方案 C：簡化 3 段 tier ───────────────────────────────────────────
const PLAN_C = {
  rounding: 50,
  distanceTier: {
    enabled: true,
    tiers: [
      { fromKm: 0,   discountPct: 0 },
      { fromKm: 20,  discountPct: 68 },
      { fromKm: 100, discountPct: 68 },
    ],
  },
  freeway: PROD.freeway,
  crossCounty: PROD.crossCounty,
};

function tablePlan(name, plan) {
  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log(`方案 ${name} 試算`);
  console.log(`  distanceTier: ${plan.distanceTier.tiers.map((t) => `[${t.fromKm}km:${t.discountPct}%]`).join(' ')}`);
  console.log(`  crossCounty:  ${JSON.stringify(plan.crossCounty.tieredNtd)}`);
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('路線                          距離   方案算   預期    差     %誤差');
  let absDiffSum = 0;
  for (const r of ROUTES) {
    const c = calcFare(r.km, r.freewayKm, r.crossings, plan);
    const diff = c.final - r.expected;
    absDiffSum += Math.abs(diff);
    const pct = ((diff / r.expected) * 100).toFixed(1);
    const flag = Math.abs(diff) <= 100 ? '✓' : (diff > 0 ? '↑' : '↓');
    console.log(`${r.name.padEnd(26)} ${String(r.km).padStart(4)}km  ${String(c.final).padStart(5)}   ${String(r.expected).padStart(5)}  ${String(diff).padStart(5)}  ${pct.padStart(6)}% ${flag}`);
  }
  console.log(`平均絕對誤差：NT$ ${Math.round(absDiffSum / ROUTES.length)}`);
}

tablePlan('A：純調 distanceTier（守 prod 跨縣市）', PLAN_A);
tablePlan('B：distanceTier + 跨縣市第 1 跨改 0（短程友善）', PLAN_B);
tablePlan('C：簡化 3 段 tier', PLAN_C);
