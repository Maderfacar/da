import methods from '@/protocol/fetch-api/methods';

export const UpdateDriverLocation = (driverId: string, params: UpdateLocationParams) =>
  methods.put<{ ok: boolean }>(`/nuxt-api/drivers/${driverId}/location`, params);

export const GetAvailableDrivers = () =>
  methods.get<DriverInfo[]>('/nuxt-api/drivers/available', {});

export const GetDriverStats = (uid: string) =>
  methods.get<DriverStats>(`/nuxt-api/drivers/${uid}/stats`, {});
