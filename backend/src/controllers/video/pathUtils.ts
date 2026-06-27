import path from "path";
import { VIDEOS_DIR } from "../../config/paths";

// Extract language code from filename (e.g. "movie.en.vtt" -> "en")
export const getLanguageFromFilename = (filename: string): string | null => {
  const parts = filename.split(".");
  if (parts.length < 2) return null;
  const langCode = parts[parts.length - 2];
  if (/^[a-z]{2,3}(-[A-Z]{2})?$/i.test(langCode)) return langCode;
  return null;
};

export const resolveVideoWebPath = (
  absoluteVideoPath: string
): string | null => {
  const videosRoot = path.resolve(VIDEOS_DIR);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const normalizedPath = path.resolve(absoluteVideoPath);

  if (
    normalizedPath !== videosRoot &&
    !normalizedPath.startsWith(`${videosRoot}${path.sep}`)
  ) {
    return null;
  }

  const relativePath = path.relative(videosRoot, normalizedPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return null;
  }

  return `/videos/${relativePath.split(path.sep).join("/")}`;
};
