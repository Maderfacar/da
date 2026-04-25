/**
 * TinyMCE 圖片上傳 API 骨架
 *
 * 接受 multipart/form-data（欄位名 file），回傳統一響應格式。
 * 本骨架不處理實際檔案儲存，僅回傳 placeholder URL 供整合測試。
 */
import { defineEventHandler, readMultipartFormData, setResponseStatus } from 'h3';

interface UnifiedResponse<T> {
  data: T;
  status: {
    code: number;
    message: {
      zh_tw: string;
      en: string;
      ja: string;
    };
  };
}

const successMessage = { zh_tw: '', en: '', ja: '' };

const missingFileMessage = {
  zh_tw: '未提供圖片檔案',
  en: 'Image file is required',
  ja: '画像ファイルが必要です'
};

export default defineEventHandler(async (event): Promise<UnifiedResponse<{ url: string } | Record<string, never>>> => {
  const formData = await readMultipartFormData(event);
  const filePart = formData?.find((part) => part.name === 'file' && part.filename);

  if (!filePart) {
    setResponseStatus(event, 400);
    return {
      data: {},
      status: {
        code: 400,
        message: missingFileMessage
      }
    };
  }

  const filename = filePart.filename ?? 'image';
  const placeholderUrl = `https://placeholder.example/${Date.now()}-${encodeURIComponent(filename)}`;

  return {
    data: { url: placeholderUrl },
    status: {
      code: 200,
      message: successMessage
    }
  };
});
