import { fromBuffer } from "file-type";
import { ValidationError } from "../errors/DownloadErrors";

export const ALLOWED_IMAGE_MIMES: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
  "image/gif": ".gif", "image/avif": ".avif",
};
const ALLOWED_IMAGE_MIME_SET = new Set(Object.keys(ALLOWED_IMAGE_MIMES));

export const validateUploadedImageContent = async (
  uploadedFile: Buffer
): Promise<string> => {
  try {
    const type = await fromBuffer(uploadedFile);
    if (!type?.mime || !ALLOWED_IMAGE_MIME_SET.has(type.mime)) {
      throw new ValidationError(
        "Uploaded file is not a valid supported image",
        "file"
      );
    }

    return type.mime;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(
      "Uploaded file is not a valid supported image",
      "file"
    );
  }
};

