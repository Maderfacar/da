import methods from '@/protocol/fetch-api/methods';

/** P23：取得整份 fleet config（公開端點，無需 auth） */
export const GetFleetConfig = () =>
  methods.get<GetFleetConfigRes>('/nuxt-api/config/fleet', {});

/** 乘客端季節主題：取得當前生效主題（公開端點，無需 auth） */
export const GetSiteTheme = () =>
  methods.get<GetSiteThemeRes>('/nuxt-api/config/theme', {});

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

// ===== Admin 季節主題管理（W2，canManageThemes / 預設僅 super）=====

/** 列出全部季節主題包（含 disabled）+ 目前生效指標 */
export const GetAdminThemes = () =>
  methods.get<GetAdminThemesRes>('/nuxt-api/admin/config/themes', {});

/** 切換乘客端生效主題（目標須 enabled，否則 400） */
export const PutActiveTheme = (activeThemeId: string) =>
  methods.put<{ activeThemeId: string }>('/nuxt-api/admin/config/themes/active', { activeThemeId });

/** 啟用 / 停用主題（default 主題不可停用） */
export const PatchThemeEnabled = (id: string, enabled: boolean) =>
  methods.patch<{ id: string; enabled: boolean }>(`/nuxt-api/admin/config/themes/${id}/enabled`, { enabled });

/** 設定 / 清除主題 Hero 主圖（bgImage=null 清除） */
export const PatchThemeHero = (id: string, bgImage: string | null) =>
  methods.patch<{ id: string; bgImage: string | null }>(`/nuxt-api/admin/config/themes/${id}/hero`, { bgImage });

/** 覆寫主題色票（--da-* 白名單 12 個，值須為 hex；後台色票編輯器用） */
export const PatchThemeTokens = (id: string, tokens: Record<string, string>) =>
  methods.patch<{ id: string; tokens: Record<string, string> }>(`/nuxt-api/admin/config/themes/${id}/tokens`, { tokens });

/** 上傳 Hero 主圖到 Storage，回傳可注入的網址（前端接著呼叫 PatchThemeHero 持久化） */
export const UploadThemeHeroImage = (file: File, themeId: string) =>
  methods.formData<UploadHeroImageRes>('/nuxt-api/admin/config/themes/upload-hero-image', { file, themeId });
