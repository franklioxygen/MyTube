import { AVATARS_DIR, IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { resolveMountFilePath } from "../../controllers/video/mountVideo";
import { resolveSafeChildPath, statTrusted, validateCloudThumbnailCachePath } from "../../utils/security";
import { getCachedThumbnail } from "../cloudStorage/cloudThumbnailCache";
import { CLOUD_PREFIX, getCloudStorageOrigin, type CloudFileType } from "./cloudAssetProxy";
import {
  LOCAL_ASSET_PREFIXES,
  MOUNT_PREFIX,
  servableSubtitles,
  type ExportRow,
} from "./libraryExport";

/**
 * Locates the bytes behind a federation asset request (design §7.1).
 *
 * Paths come only from the video's stored references; the consumer supplies
 * nothing but an asset kind and, for subtitles, an opaque track id.
 */

export const FEDERATION_ASSET_KINDS = ["media", "thumbnail", "avatar", "subtitle"] as const;
export type FederationAssetKind = (typeof FEDERATION_ASSET_KINDS)[number];

export const isFederationAssetKind = (value: unknown): value is FederationAssetKind =>
  (FEDERATION_ASSET_KINDS as readonly unknown[]).includes(value);

const LOCAL_ROOTS: Record<string, string> = {
  "/videos/": VIDEOS_DIR,
  "/images/": IMAGES_DIR,
  "/subtitles/": SUBTITLES_DIR,
  "/avatars/": AVATARS_DIR,
};

const SUBTITLE_CONTENT_TYPES: Record<string, string> = {
  vtt: "text/vtt; charset=utf-8",
  srt: "application/x-subrip; charset=utf-8",
  ass: "text/x-ssa; charset=utf-8",
  ssa: "text/x-ssa; charset=utf-8",
};

export type LocatedAsset =
  | {
      type: "file";
      absolutePath: string;
      /** Overrides the extension-based type where browsers need a precise one. */
      contentType?: string;
    }
  | { type: "cloud"; filename: string; fileType: CloudFileType };

const resolveLocal = (webPath: string | null, prefixes: readonly string[]): string | null => {
  const prefix = webPath ? prefixes.find((candidate) => webPath.startsWith(candidate)) : undefined;
  if (!webPath || !prefix) return null;
  try {
    return resolveSafeChildPath(LOCAL_ROOTS[prefix], webPath.slice(prefix.length));
  } catch {
    return null;
  }
};

const file = (absolutePath: string | null, contentType?: string): LocatedAsset | null =>
  absolutePath
    ? { type: "file", absolutePath, ...(contentType ? { contentType } : {}) }
    : null;

const cloud = (reference: string, fileType: CloudFileType): LocatedAsset | null => {
  const filename = reference.slice(CLOUD_PREFIX.length);
  return filename ? { type: "cloud", filename, fileType } : null;
};

/** A cloud thumbnail this instance already cached locally. */
const cachedCloudThumbnail = (reference: string): string | null => {
  try {
    const cached = getCachedThumbnail(reference);
    return cached ? validateCloudThumbnailCachePath(cached) : null;
  } catch {
    return null;
  }
};

/** Where the asset lives, or null when this instance does not serve it. */
export function locateFederationAsset(
  row: ExportRow,
  kind: FederationAssetKind,
  trackId?: string
): LocatedAsset | null {
  switch (kind) {
    case "media": {
      const reference = row.videoPath;
      if (reference?.startsWith(MOUNT_PREFIX)) {
        try {
          return file(resolveMountFilePath(reference.slice(MOUNT_PREFIX.length)));
        } catch {
          return null;
        }
      }
      if (reference?.startsWith(CLOUD_PREFIX)) {
        return cloud(reference, row.mediaType === "audio" ? "audio" : "video");
      }
      return file(resolveLocal(reference, LOCAL_ASSET_PREFIXES.media));
    }
    case "thumbnail": {
      const reference = row.thumbnailPath;
      if (reference?.startsWith(CLOUD_PREFIX)) {
        // Served only while cloud storage is configured, cached copy included,
        // matching what the export advertises without probing the cache.
        if (getCloudStorageOrigin() === null) return null;
        return file(cachedCloudThumbnail(reference)) ?? cloud(reference, "thumbnail");
      }
      return file(resolveLocal(reference, LOCAL_ASSET_PREFIXES.thumbnail));
    }
    case "avatar":
      // The row carries the author's effective avatar, custom override first.
      return file(resolveLocal(row.authorAvatarPath, LOCAL_ASSET_PREFIXES.avatar));
    case "subtitle": {
      const track = servableSubtitles(row.subtitles).find((entry) => entry.trackId === trackId);
      if (!track) return null;
      return file(
        resolveLocal(track.path, LOCAL_ASSET_PREFIXES.subtitle),
        SUBTITLE_CONTENT_TYPES[track.format]
      );
    }
  }
}

export async function isRegularFile(absolutePath: string): Promise<boolean> {
  try {
    return (await statTrusted(absolutePath)).isFile();
  } catch {
    return false;
  }
}
