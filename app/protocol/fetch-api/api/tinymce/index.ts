import * as mock from './mock';
import methods from '@/protocol/fetch-api/methods';

const IsMock = () => {
  const { public: { testMode } } = useRuntimeConfig();
  return testMode === 'T';
};

// -----------------------------------------------------------------------------------------------

/** TinyMCE 圖片上傳（骨架 API） */
export const ApiTinymceUpload = (params: TinymceUploadParams) => {
  if (IsMock()) return mock.UploadImage(params); // Mock
  return methods.formData<TinymceUploadRes>(tinymceUploadUrl, params);
};
