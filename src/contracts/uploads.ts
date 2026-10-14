export const DOCUMENT_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,.pdf";
export type UploadedPage = { id: string; url: string; name: string; size: number; page: number };
export type DocumentUploadResult = {
  id: string;
  url: string;
  pages: UploadedPage[];
  pageCount: number;
};
export type PreparedScanPage = { assetUrl: string; name: string; size: number };
export type ScanUploadPage = File | PreparedScanPage;
