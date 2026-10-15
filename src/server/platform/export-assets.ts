export type ExportAsset = { buffer: Buffer; contentType: string };
export type ExportAssetLoader = (url: string) => Promise<ExportAsset>;
