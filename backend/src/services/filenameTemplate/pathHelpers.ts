import path from "path";
import {
  IMAGES_DIR,
  SUBTITLES_DIR,
  VIDEOS_DIR,
} from "../../config/paths";

const MANAGED_PREFIXES = [
  { webPrefix: "/videos/", rootDir: VIDEOS_DIR },
  { webPrefix: "/images/", rootDir: IMAGES_DIR },
  { webPrefix: "/subtitles/", rootDir: SUBTITLES_DIR },
] as const;

type ManagedPrefix = "/videos" | "/images" | "/subtitles";

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
      // Security: reject traversal
      if (relativePath.includes("..")) return null;
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const absolutePath = path.join(rootDir, relativePath);
      // Verify the resolved path is inside the root directory
      const rel = path.relative(rootDir, absolutePath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
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
