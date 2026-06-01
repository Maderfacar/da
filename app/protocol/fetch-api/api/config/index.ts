import methods from '@/protocol/fetch-api/methods';

/** P23：取得整份 fleet config（公開端點，無需 auth） */
export const GetFleetConfig = () =>
  methods.get<GetFleetConfigRes>('/nuxt-api/config/fleet', {});

/** P23：admin 新增車型 / 行李類型 / 加值服務 */
export const CreateFleetVehicle = (body: CreateVehiclePayload) =>
  methods.post<FleetVehicleDto>('/nuxt-api/admin/config/vehicles', body as unknown as Record<string, unknown>);

export const CreateFleetLuggageType = (body: CreateLuggageTypePayload) =>
  methods.post<FleetLuggageTypeDto>('/nuxt-api/admin/config/luggage-types', body as unknown as Record<string, unknown>);

export const CreateFleetExtra = (body: CreateExtraPayload) =>
  methods.post<FleetExtraDto>('/nuxt-api/admin/config/extras', body as unknown as Record<string, unknown>);

/** P23：admin 更新（完整覆寫 doc） */
export const UpdateFleetVehicle = (id: string, body: Omit<CreateVehiclePayload, 'id'>) =>
  methods.put<FleetVehicleDto>(`/nuxt-api/admin/config/vehicles/${id}`, body as unknown as Record<string, unknown>);

export const UpdateFleetLuggageType = (id: string, body: Omit<CreateLuggageTypePayload, 'id'>) =>
  methods.put<FleetLuggageTypeDto>(`/nuxt-api/admin/config/luggage-types/${id}`, body as unknown as Record<string, unknown>);

export const UpdateFleetExtra = (id: string, body: Omit<CreateExtraPayload, 'id'>) =>
  methods.put<FleetExtraDto>(`/nuxt-api/admin/config/extras/${id}`, body as unknown as Record<string, unknown>);

/** P23：admin 刪除 */
export const DeleteFleetVehicle = (id: string) =>
  methods.delete<{ id: string }>(`/nuxt-api/admin/config/vehicles/${id}`);

export const DeleteFleetLuggageType = (id: string) =>
  methods.delete<{ id: string }>(`/nuxt-api/admin/config/luggage-types/${id}`);

export const DeleteFleetExtra = (id: string) =>
  methods.delete<{ id: string }>(`/nuxt-api/admin/config/extras/${id}`);

/** 上傳車型卡圖片（exterior / interior / trunk）；回傳 1 年 TTL signed URL，由前端寫回 images.{slot}。 */
export const UploadAdminFleetVehicleImage = (file: File, slot: VehicleImageSlotDto) =>
  methods.formData<UploadVehicleImageRes>(
    '/nuxt-api/admin/config/upload-vehicle-image',
    { file, slot },
  );
