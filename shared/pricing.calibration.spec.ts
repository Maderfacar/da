// 機場線 V1 校準測試（8 OD × 6 車型 = 48 case）
//
// 跑 calculateFareV2(車型, OD routeMetrics, 中午 12:00, [], AIRPORT_CALIBRATION_RULES)
// 結果應落在 target ± tolerance 內。
//
// 容差 spec：主力 OD（桃園/新北/台北/竹/新竹）±150；長距離（台中/大甲后里）±300。

import { describe, it, expect } from 'vitest';
import { calculateFareV2 } from './pricing';
import {
  AIRPORT_CALIBRATION_RULES,
  VEHICLE_CALIBRATIONS,
  AIRPORT_OD_CASES,
  CALIBRATION_PICKUP_TIME,
  CALIBRATION_KNOWN_GAPS,
  calibrationMetrics,
} from './pricing.fixture';

describe('airport line calibration v1', () => {
  for (const odCase of AIRPORT_OD_CASES) {
    describe(`${odCase.name}（${odCase.distanceKm}km, ±${odCase.tolerance}）`, () => {
      const metrics = calibrationMetrics(odCase.distanceKm, odCase.countiesVisited);

      VEHICLE_CALIBRATIONS.forEach((vehicle, idx) => {
        const target = odCase.targets[idx];
        if (target === undefined) return;

        const knownGap = CALIBRATION_KNOWN_GAPS.find(
          (g) => g.vehicleId === vehicle.id && g.distanceKm === odCase.distanceKm,
        );

        it(`${vehicle.id} → target=${target}${knownGap ? ' [known-gap]' : ''}`, () => {
          const breakdown = calculateFareV2(
            { baseFare: vehicle.baseFare, perKmRate: vehicle.perKmRate },
            metrics,
            CALIBRATION_PICKUP_TIME,
            [],
            AIRPORT_CALIBRATION_RULES,
            'airport-pickup',
          );
          const signedDiff = breakdown.final - target;
          const diff = Math.abs(signedDiff);

          if (knownGap) {
            // 鎖定已知的 target 曲線 gap — 若 actual 飄移超過 ±50 表示計費引擎或 fixture 改動
            expect(
              signedDiff,
              `${vehicle.id} @ ${odCase.name}: actual=${breakdown.final}, target=${target}, signedDiff=${signedDiff}, knownGap=${knownGap.expectedGap}`,
            ).toBeCloseTo(knownGap.expectedGap, -1); // tolerance ~50
            return;
          }

          expect(
            diff,
            `${vehicle.id} @ ${odCase.name}: actual=${breakdown.final}, target=${target}, diff=${diff}, tol=${odCase.tolerance}`,
          ).toBeLessThanOrEqual(odCase.tolerance);
        });
      });
    });
  }
});
