import path from "path";
import { VIDEOS_DIR } from "../../../config/paths";
import { ValidationError } from "../../../errors/DownloadErrors";
import { pathExistsSafeSync, resolveSafeChildPath } from "../../../utils/security";
import { MEDIA_FILE_EXTENSIONS } from "../../../utils/videoExtensions";

export function stripTrailingExtension(
  value: string,
  extension: string
): string {
  return value.endsWith(extension) ? value.slice(0, -extension.length) : value;
}

export function createYtDlpOutputTemplate(outputPath: string): string {
  const outputDir = path.dirname(outputPath);
  const outputFilename = path.basename(outputPath, path.extname(outputPath));
  return resolveSafeChildPath(outputDir, `${outputFilename}.%(ext)s`);
}

export function pathExistsWithAnyKnownMediaExtension(basePath: string): boolean {
  return MEDIA_FILE_EXTENSIONS.some((extension) =>
    pathExistsSafeSync(`${basePath}${extension}`, VIDEOS_DIR)
  );
}

// Kept for callers that use the old video-specific name. The collision check
// is intentionally media-wide so an audio and video download cannot reuse the
// same stem and confuse later resolution.
export const pathExistsWithAnyKnownVideoExtension =
  pathExistsWithAnyKnownMediaExtension;

export function isExpectedTwitchMetadataError(error: unknown): boolean {
  if (error instanceof ValidationError) {
    return true;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { status?: number } }).response?.status ===
      "number"
  ) {
    return (error as { response?: { status?: number } }).response?.status === 429;
  }

  return (
    error instanceof Error &&
    error.message.includes("Twitch API is temporarily rate limited")
  );
}
