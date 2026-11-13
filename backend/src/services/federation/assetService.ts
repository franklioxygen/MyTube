import { AVATARS_DIR, IMAGES_DIR, SUBTITLES_DIR, VIDEOS_DIR } from "../../config/paths";
import { resolveMountFilePath } from "../../controllers/video/mountVideo";
import { resolveSafeChildPath, statTrusted } from "../../utils/security";
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

export interface LocatedAsset {
  absolutePath: string;
  /** Overrides the extension-based type where browsers need a precise one. */
  contentType?: string;
}

const resolveLocal = (webPath: string | null, prefixes: readonly string[]): string | null => {
  const prefix = webPath ? prefixes.find((candidate) => webPath.startsWith(candidate)) : undefined;
  if (!webPath || !prefix) return null;
  try {
    return resolveSafeChildPath(LOCAL_ROOTS[prefix], webPath.slice(prefix.length));
  } catch {
    return null;
  }
};

const located = (absolutePath: string | null, contentType?: string): LocatedAsset | null =>
  absolutePath ? { absolutePath, ...(contentType ? { contentType } : {}) } : null;

/** Where the asset lives, or null when this instance does not serve it. */
export function locateFederationAsset(
  row: ExportRow,
  kind: FederationAssetKind,
  trackId?: string
): LocatedAsset | null {
  switch (kind) {
    case "media": {
      if (row.videoPath?.startsWith(MOUNT_PREFIX)) {
        try {
          return located(resolveMountFilePath(row.videoPath.slice(MOUNT_PREFIX.length)));
        } catch {
          return null;
        }
      }
      return located(resolveLocal(row.videoPath, LOCAL_ASSET_PREFIXES.media));
    }
    case "thumbnail":
      return located(resolveLocal(row.thumbnailPath, LOCAL_ASSET_PREFIXES.thumbnail));
    case "avatar":
      // The row carries the author's effective avatar, custom override first.
      return located(resolveLocal(row.authorAvatarPath, LOCAL_ASSET_PREFIXES.avatar));
    case "subtitle": {
      const track = servableSubtitles(row.subtitles).find((entry) => entry.trackId === trackId);
      if (!track) return null;
      return located(
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
