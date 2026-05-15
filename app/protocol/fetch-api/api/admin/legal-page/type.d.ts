// Admin legal page (會員條款 / 隱私政策) types
//
// 對齊 server/utils/legal-pages.ts LegalPageDto / PutBody

export type LegalPageKey = 'terms' | 'privacy';

export interface LegalPageDto {
  key: LegalPageKey;
  title: string;
  bodyHtml: string;
  updatedBy: string;
  updatedAt: string | null;
  version: number;
}

export interface LegalPageListRes {
  items: LegalPageDto[];
}

export interface PutLegalPageBody {
  title: string;
  bodyHtml: string;
}

export interface PutLegalPageRes {
  key: LegalPageKey;
  version: number;
  updatedAt: string;
}
