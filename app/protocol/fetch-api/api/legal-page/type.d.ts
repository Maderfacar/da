// Public legal page (passenger / guest) types

export type LegalPageKey = 'terms' | 'privacy';

export interface LegalPageDto {
  key: LegalPageKey;
  title: string;
  bodyHtml: string;
  updatedBy: string;
  updatedAt: string | null;
  version: number;
}
