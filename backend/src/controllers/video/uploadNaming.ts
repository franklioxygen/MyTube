import path from "path";
import sanitizeFilename from "sanitize-filename";
import {
  IMAGES_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import { allocateOutputFamilySync } from "../../services/filenameTemplate/outputPathAllocator";
import {
  replaceSegmentSeparators,
  sanitizeSegment,
} from "../../services/filenameTemplate/sanitize";
import { logger } from "../../utils/logger";
import {
  linkSafeSync,
  resolveSafeChildPath,
  unlinkSafeSync,
} from "../../utils/security";
import { SUPPORTED_VIDEO_EXTENSIONS } from "../../utils/videoUpload";

/**
 * Characters dropped from an uploaded filename before it names a file:
 * - \p{Cc}: control characters, C0 and C1 (NUL, CR/LF, ...).
 * - \p{Cf} except ZWNJ/ZWJ: bidi overrides, zero-width space, BOM. These let
 *   a name display as something it is not ("invoice\u202Egpj.mp4" shows as
 *   "invoicemp4.jpg"). ZWNJ/ZWJ stay because Persian and Indic text and emoji
 *   sequences need them.
 * - \p{Zl}\p{Zp}: line and paragraph separators.
 * - "#" and "%": media URLs are built without encoding, so "#" truncates them
 *   and "%" fails to decode; "%" also makes ffmpeg read the thumbnail output
 *   name as an image-sequence pattern.
 * Single character class, so matching is linear in the name length.
 */
const UNSAFE_UPLOAD_FILENAME_CHARS_RE =
  /(?![\u200C\u200D])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}#%]/gu;
const LEADING_DOTS_AND_SPACES_RE = /^[.\s]+/;
const COLLISION_ID_LENGTH = 8;

/**
 * The uploaded filename made safe to store, or null when nothing usable is
 * left (empty, dot-only, or a Windows-reserved name such as CON.mp4).
 * Busboy has already stripped any directory part; the basename and separator
 * replacement here are defense in depth.
 */
export const buildOriginalUploadFilename = (
  originalname: string
): string | null => {
  const name = path.basename(String(originalname ?? ""));
  const extension = path.extname(name).toLowerCase();
  if (!SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
    return null;
  }

  const rawStem = name.slice(0, name.length - extension.length);
  const stem = sanitizeSegment(
    replaceSegmentSeparators(rawStem.normalize("NFC")).replace(
      UNSAFE_UPLOAD_FILENAME_CHARS_RE,
      ""
    )
  ).replace(LEADING_DOTS_AND_SPACES_RE, "");
  if (!stem) {
    return null;
  }

  const filename = `${stem}${extension}`;
  return sanitizeFilename(filename) === filename ? filename : null;
};

export interface UploadFilenamePlacement {
  videoFilename: string;
  thumbnailFilename: string;
  /** Hold until the video row is saved; the row owns the name after that. */
  release: () => void;
}

interface PlaceUploadInput {
  storedFilename: string;
  originalname: string;
  videoId: string;
  moveThumbnailsToVideoFolder: boolean;
  moveSubtitlesToVideoFolder: boolean;
}

/**
 * Moves an upload from its generated temp name to its original filename,
 * appending a short ID only when that name is taken. Returns null, leaving the
 * file where it was, whenever the original name cannot be used: naming must
 * never fail an upload.
 */
export const placeUploadUnderOriginalName = ({
  storedFilename,
  originalname,
  videoId,
  moveThumbnailsToVideoFolder,
  moveSubtitlesToVideoFolder,
}: PlaceUploadInput): UploadFilenamePlacement | null => {
  const preferredFilename = buildOriginalUploadFilename(originalname);
  if (!preferredFilename) {
    logger.warn(
      `Keeping generated upload filename ${storedFilename}: original filename is not usable`
    );
    return null;
  }

  const stem = path.parse(preferredFilename).name;
  let reservation: ReturnType<typeof allocateOutputFamilySync>;
  try {
    reservation = allocateOutputFamilySync({
      videoRelativePath: preferredFilename,
      thumbnailRelativePath: `${stem}.jpg`,
      subtitleBaseRelativePath: stem,
      thumbnailBaseDir: moveThumbnailsToVideoFolder ? VIDEOS_DIR : IMAGES_DIR,
      subtitleBaseDir: moveSubtitlesToVideoFolder ? VIDEOS_DIR : SUBTITLES_DIR,
      identity: {
        platform: "local",
        // Only feeds the collision suffix; never stored on the video row.
        sourceVideoId: videoId
          .replace(/^upload-/, "")
          .slice(0, COLLISION_ID_LENGTH),
        mediaType: "video",
        localVideoId: videoId,
      },
      existingLocalVideoId: videoId,
      thumbnailRequired: true,
      subtitleRequired: true,
    });
  } catch (error) {
    logger.warn(
      `Keeping generated upload filename ${storedFilename}: could not allocate original filename`,
      error
    );
    return null;
  }

  try {
    const sourcePath = resolveSafeChildPath(VIDEOS_DIR, storedFilename);
    const destinationPath = resolveSafeChildPath(
      VIDEOS_DIR,
      reservation.videoRelativePath
    );
    // Both names are in VIDEOS_DIR. A hard link publishes without overwriting
    // an existing file or copying what may be a very large upload.
    linkSafeSync(sourcePath, VIDEOS_DIR, destinationPath, VIDEOS_DIR);
    try {
      unlinkSafeSync(sourcePath, VIDEOS_DIR);
    } catch (error) {
      // Keep the generated-name fallback intact if removing the temp name fails.
      unlinkSafeSync(destinationPath, VIDEOS_DIR);
      throw error;
    }
  } catch (error) {
    reservation.release();
    logger.warn(
      `Keeping generated upload filename ${storedFilename}: could not move upload to its original filename`,
      error
    );
    return null;
  }

  return {
    videoFilename: reservation.videoRelativePath,
    thumbnailFilename: path.basename(reservation.thumbnailRelativePath),
    release: reservation.release,
  };
};
