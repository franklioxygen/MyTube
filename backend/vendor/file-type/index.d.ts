export interface FileTypeResult {
  ext: string;
  mime: string;
}

export function fromBuffer(
  input: Uint8Array | ArrayBuffer
): Promise<FileTypeResult | undefined>;

export function fromFile(filePath: string): Promise<never>;

export const fileTypeFromBuffer: typeof fromBuffer;
export const fileTypeFromFile: typeof fromFile;
export const supportedExtensions: ReadonlySet<string>;
export const supportedMimeTypes: ReadonlySet<string>;

declare const _default: {
  fromBuffer: typeof fromBuffer;
  fromFile: typeof fromFile;
  fileTypeFromBuffer: typeof fromBuffer;
  fileTypeFromFile: typeof fromFile;
  supportedExtensions: typeof supportedExtensions;
  supportedMimeTypes: typeof supportedMimeTypes;
};

export default _default;
