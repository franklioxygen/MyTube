import { spawnSync } from "child_process";
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
const AUDIO_ONLY_YTDLP_FORMAT_IDS = new Set([
  "139",
  "140",
  "141",
  "171",
  "172",
  "233",
  "234",
  "249",
  "250",
  "251",
  "256",
  "258",
  "325",
  "327",
  "328",
  "338",
  "380",
  "599",
  "600",
]);

const isTemporaryFile = (filename: string): boolean =>
  TEMP_FILE_SUFFIXES.some((suffix) => filename.endsWith(suffix));

const extractYtDlpFormatId = (filename: string): string | null => {
  const match = filename.match(/\.f(\d+)\./);
  return match?.[1] ?? null;
};

const isLikelyAudioOnlyFormatId = (filename: string): boolean => {
  const formatId = extractYtDlpFormatId(filename);
  if (!formatId) {
    return false;
  }
  return AUDIO_ONLY_YTDLP_FORMAT_IDS.has(formatId);
};

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

const isFfprobeAvailable = (): boolean => {
  try {
    const result = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
};

const probeHasVideoStream = (filePath: string): boolean | null => {
  try {
    const result = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
      }
    );

    if (result.status !== 0) {
      return null;
    }

    const streamTypes = String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);

    if (streamTypes.length === 0) {
      return null;
    }

    return streamTypes.includes("video");
  } catch {
    return null;
  }
};

type CandidateFile = {
  candidatePath: string;
  extensionPriority: number;
  size: number;
  likelyAudioOnly: boolean;
  hasVideoStream: boolean | null;
};

const sortCandidates = (a: CandidateFile, b: CandidateFile): number => {
  if (b.extensionPriority !== a.extensionPriority) {
    return b.extensionPriority - a.extensionPriority;
  }

  if (a.likelyAudioOnly !== b.likelyAudioOnly) {
    return a.likelyAudioOnly ? 1 : -1;
  }

  return b.size - a.size;
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
    const ffprobeAvailable = isFfprobeAvailable();

    const candidates: CandidateFile[] = files
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

        const hasVideoStream = ffprobeAvailable
          ? probeHasVideoStream(candidatePath)
          : null;

        return {
          candidatePath,
          size,
          extensionPriority,
          likelyAudioOnly: isLikelyAudioOnlyFormatId(filename),
          hasVideoStream,
        };
      })
      .filter((item) => item.size > 0)
      .sort(sortCandidates);

    if (candidates.length === 0) {
      return null;
    }

    if (!ffprobeAvailable) {
      return candidates[0].candidatePath;
    }

    const confirmedVideoCandidates = candidates.filter(
      (candidate) => candidate.hasVideoStream === true
    );
    if (confirmedVideoCandidates.length > 0) {
      return confirmedVideoCandidates[0].candidatePath;
    }

    const unknownCandidates = candidates.filter(
      (candidate) => candidate.hasVideoStream === null
    );
    if (unknownCandidates.length > 0) {
      return unknownCandidates[0].candidatePath;
    }

    // ffprobe confirmed all candidates as non-video streams.
    return null;
  } catch {
    return null;
  }
};
