// 車輛公開檔案 API methods（Phase 1C）
import methods from '@/protocol/fetch-api/methods';
import type {
  VehiclePublicDto,
  GetVehiclePublicLang,
} from './type.d';

export type {
  VehiclePublicDto,
  VehiclePublicTagDto,
  GetVehiclePublicLang,
} from './type.d';

/**
 * 取車輛公開檔案（公開，passenger / guest 都可呼叫；未驗證 → 404）
 */
export const GetVehiclePublic = (driverId: string, lang?: GetVehiclePublicLang) =>
  methods.get<VehiclePublicDto>(
    `/nuxt-api/vehicles/${encodeURIComponent(driverId)}`,
    lang ? { lang } : {},
  );
