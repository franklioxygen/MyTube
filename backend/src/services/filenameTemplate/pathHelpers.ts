import {
  IMAGES_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";
import path from "path";
import { resolveSafeChildPath } from "../../utils/security";

const MANAGED_PREFIXES = [
  { webPrefix: "/videos/", rootDir: VIDEOS_DIR },
  { webPrefix: "/images/", rootDir: IMAGES_DIR },
  { webPrefix: "/subtitles/", rootDir: SUBTITLES_DIR },
] as const;

type ManagedPrefix = "/videos" | "/images" | "/subtitles";

function normalizedManagedKey(value: string): string {
  return path
    .normalize(value)
    .replace(/\\/g, "/")
    .normalize("NFKC")
    .toLocaleLowerCase();
}

export function canonicalizeManagedPath(webOrAbsolutePath: string): string {
  let normalized = webOrAbsolutePath.replace(/\\/g, "/");
  if (normalized.startsWith("/videos/")) {
    normalized = normalized.slice("/videos/".length);
  } else if (normalized.startsWith("/images/")) {
    normalized = normalized.slice("/images/".length);
  } else if (normalized.startsWith("/subtitles/")) {
    normalized = normalized.slice("/subtitles/".length);
  } else if (path.isAbsolute(normalized)) {
    for (const root of [VIDEOS_DIR, IMAGES_DIR, SUBTITLES_DIR]) {
      const relative = path.relative(root, normalized).replace(/\\/g, "/");
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        normalized = relative;
        break;
      }
    }
  }

  return normalizedManagedKey(normalized);
}

/**
 * Given a web path like "/videos/Channel/file.mp4", returns the relative
 * path after the managed prefix, e.g. "Channel/file.mp4".
 * Returns null if the path does not start with the given prefix.
 */
export function getManagedRelativePath(
  webPath: string,
  prefix: ManagedPrefix
): string | null {
  if (!webPath || typeof webPath !== "string") return null;
  const p = prefix + "/";
  if (!webPath.startsWith(p)) return null;
  const relative = webPath.slice(p.length);
  return relative || null;
}

/**
 * Resolves a managed web path to its absolute filesystem path and metadata.
 * Returns null for cloud paths, mount paths, or unrecognized formats.
 *
 * Example: "/videos/Channel/file.mp4" → { prefix: "/videos", rootDir, relativePath, absolutePath }
 */
export function resolveManagedWebPath(webPath: string): {
  prefix: ManagedPrefix;
  rootDir: string;
  relativePath: string;
  absolutePath: string;
} | null {
  if (!webPath || typeof webPath !== "string") return null;
  if (webPath.startsWith("cloud:") || webPath.startsWith("mount:")) return null;
  if (webPath.startsWith("http://") || webPath.startsWith("https://")) return null;

  for (const { webPrefix, rootDir } of MANAGED_PREFIXES) {
    if (webPath.startsWith(webPrefix)) {
      const relativePath = webPath.slice(webPrefix.length);
      if (!relativePath) return null;
      // resolveSafeChildPath validates traversal and ensures the resulting
      // absolute path is inside rootDir; throws otherwise.
      let absolutePath: string;
      try {
        absolutePath = resolveSafeChildPath(rootDir, relativePath);
      } catch {
        return null;
      }
      return {
        prefix: webPrefix.slice(0, -1) as ManagedPrefix,
        rootDir,
        relativePath,
        absolutePath,
      };
    }
  }

  return null;
}
