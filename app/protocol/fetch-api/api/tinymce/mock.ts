import * as mockRes from '@/protocol/fetch-api/mock-res';

// 上傳圖片（TinyMCE）---------------------------------------------------------
export const UploadImage = (params: TinymceUploadParams) => {
  const filename = params.file?.name ?? 'image';
  const data: TinymceUploadRes = {
    url: `https://placeholder.example/${Date.now()}-${encodeURIComponent(filename)}`
  };
  return mockRes.CreateRes(data);
};
