import path from "path";
import { AVATARS_DIR } from "../../config/paths";
import { resolveSafeChildPath } from "../../utils/security";
import { resolveManagedWebPath } from "../filenameTemplate/pathHelpers";
import type { Video } from "./types";
import { logger } from "../../utils/logger";

// Keep the absolute root in the key: /videos/a.jpg and /images/a.jpg are
// different files. Case/Unicode folding conservatively protects aliases on
// filesystems that do not distinguish them.
function pathKey(value: string): string {
  return path.normalize(value).replace(/\\/g, "/").normalize("NFKC").toLowerCase();
}

/** Build once from a successful library read, excluding any row being deleted. */
export function createArtifactReferenceGuard(libraryVideos: Video[]): (absolutePath: string) => boolean {
  const paths = new Set<string>();
  const legacyFilenames = new Set<string>();

  const add = (webPath: unknown, filename: unknown): void => {
    if (typeof webPath === "string" && webPath) {
      let absolutePath: string | undefined;
      if (webPath.startsWith("mount:")) {
        absolutePath = webPath.slice("mount:".length);
      } else if (webPath.startsWith("/avatars/")) {
        try {
          absolutePath = resolveSafeChildPath(AVATARS_DIR, webPath.slice("/avatars/".length));
        } catch {
          logger.warn("Ignoring invalid avatar path during ownership checks", { webPath });
        }
      } else {
        absolutePath = resolveManagedWebPath(webPath)?.absolutePath;
      }
      if (absolutePath) {
        paths.add(pathKey(absolutePath));
        return;
      }
    }
    if (typeof filename === "string" && filename) {
      // Legacy rows do not identify a folder. Preserve all possible owners
      // instead of assuming a basename-only row lives at the storage root.
      legacyFilenames.add(pathKey(path.basename(filename.replace(/\\/g, "/"))));
    }
  };

  for (const video of libraryVideos) {
    add(video.videoPath, video.videoFilename);
    add(video.thumbnailPath, video.thumbnailFilename);
    add(video.authorAvatarPath, video.authorAvatarFilename);
    for (const subtitle of video.subtitles ?? []) add(subtitle.path, subtitle.filename);
  }

  return (absolutePath) => paths.has(pathKey(absolutePath)) ||
    legacyFilenames.has(pathKey(path.basename(absolutePath)));
}
