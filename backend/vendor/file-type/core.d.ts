import type { FileTypeResult } from "./index";

export function fromBuffer(
  input: Uint8Array | ArrayBuffer
): Promise<FileTypeResult | undefined>;

export const fileTypeFromBuffer: typeof fromBuffer;
export const supportedExtensions: ReadonlySet<string>;
export const supportedMimeTypes: ReadonlySet<string>;

declare const _default: {
  fromBuffer: typeof fromBuffer;
  fileTypeFromBuffer: typeof fromBuffer;
  supportedExtensions: typeof supportedExtensions;
  supportedMimeTypes: typeof supportedMimeTypes;
};

export default _default;
