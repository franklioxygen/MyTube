import fs from "fs-extra";
import path from "path";

const VIDEO_CONTAINER_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mkv",
  ".avi",
  ".mov",
  ".m4v",
  ".flv",
  ".3gp",
]);

const TEMP_FILE_SUFFIXES = [".part", ".ytdl"];

const isTemporaryFile = (filename: string): boolean =>
  TEMP_FILE_SUFFIXES.some((suffix) => filename.endsWith(suffix));

const isLikelySplitVideoArtifact = (
  filename: string,
  expectedBaseName: string
): boolean => {
  if (!filename.startsWith(`${expectedBaseName}.f`)) {
    return false;
  }

  if (!/\.f\d+\./.test(filename)) {
    return false;
  }

  if (isTemporaryFile(filename)) {
    return false;
  }

  const ext = path.extname(filename).toLowerCase();
  return VIDEO_CONTAINER_EXTENSIONS.has(ext);
};

/**
 * Resolve a playable video file path when the expected merged output is missing.
 * Falls back to yt-dlp split artifacts like `name.f137.mp4`.
 */
export const resolvePlayableVideoFilePath = (
  expectedFilePath: string
): string | null => {
  try {
    if (fs.existsSync(expectedFilePath)) {
      return expectedFilePath;
    }

    const videoDir = path.dirname(expectedFilePath);
    if (!fs.existsSync(videoDir)) {
      return null;
    }

    const expectedBaseName = path.parse(path.basename(expectedFilePath)).name;
    const expectedExt = path.extname(expectedFilePath).toLowerCase();
    const files = fs.readdirSync(videoDir);
    const candidates = files
      .filter((filename) =>
        isLikelySplitVideoArtifact(filename, expectedBaseName)
      )
      .map((filename) => {
        const candidatePath = path.join(videoDir, filename);
        const candidateExt = path.extname(filename).toLowerCase();
        const extensionPriority = candidateExt === expectedExt ? 1 : 0;
        let size = 0;
        try {
          if (fs.existsSync(candidatePath)) {
            size = fs.statSync(candidatePath).size;
          }
        } catch {
          size = 0;
        }
        return { filename, size, extensionPriority };
      })
      .filter((item) => item.size > 0)
      .sort((a, b) => {
        if (b.extensionPriority !== a.extensionPriority) {
          return b.extensionPriority - a.extensionPriority;
        }
        return b.size - a.size;
      });

    if (candidates.length === 0) {
      return null;
    }

    return path.join(videoDir, candidates[0].filename);
  } catch {
    return null;
  }
};
