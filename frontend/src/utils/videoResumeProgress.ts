const VIDEO_RESUME_PROGRESS_PREFIX = "mytube:video-resume-progress:";
const LOCAL_PROGRESS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_PROGRESS_FRESHNESS_SLOP_MS = 60 * 1000;
const LOCAL_PROGRESS_REGRESSION_GUARD_SECONDS = 30;

interface StoredVideoResumeProgress {
  progress: number;
  updatedAt: number;
}

const getStorage = (): Storage | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

const getKey = (videoId: string): string =>
  `${VIDEO_RESUME_PROGRESS_PREFIX}${videoId}`;

const isStoredProgressFresh = (
  stored: StoredVideoResumeProgress,
  serverProgressUpdatedAt?: number | null
): boolean => {
  const now = Date.now();
  if (now - stored.updatedAt > LOCAL_PROGRESS_MAX_AGE_MS) {
    return false;
  }

  if (!serverProgressUpdatedAt || !Number.isFinite(serverProgressUpdatedAt)) {
    return true;
  }

  return (
    stored.updatedAt + LOCAL_PROGRESS_FRESHNESS_SLOP_MS >=
    serverProgressUpdatedAt
  );
};

export function readVideoResumeProgress(
  videoId: string | undefined
): StoredVideoResumeProgress | null {
  if (!videoId) {
    return null;
  }

  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(getKey(videoId));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredVideoResumeProgress>;
    const progress =
      typeof parsed.progress === "number" && Number.isFinite(parsed.progress)
        ? Math.max(0, Math.floor(parsed.progress))
        : 0;
    const updatedAt =
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : 0;

    if (progress <= 0 || updatedAt <= 0) {
      storage.removeItem(getKey(videoId));
      return null;
    }

    return { progress, updatedAt };
  } catch {
    storage.removeItem(getKey(videoId));
    return null;
  }
}

export function writeVideoResumeProgress(
  videoId: string | undefined,
  progress: number
): void {
  if (!videoId || !Number.isFinite(progress) || progress <= 0) {
    return;
  }

  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      getKey(videoId),
      JSON.stringify({
        progress: Math.floor(progress),
        updatedAt: Date.now(),
      } satisfies StoredVideoResumeProgress)
    );
  } catch {
    // localStorage can be unavailable or full; backend progress remains primary.
  }
}

export function getBestVideoResumeProgress(
  videoId: string | undefined,
  serverProgress: number | null | undefined,
  serverProgressUpdatedAt?: number | null
): number {
  const normalizedServerProgress =
    typeof serverProgress === "number" && Number.isFinite(serverProgress)
      ? Math.max(0, Math.floor(serverProgress))
      : 0;
  const stored = readVideoResumeProgress(videoId);

  if (!stored || !isStoredProgressFresh(stored, serverProgressUpdatedAt)) {
    return normalizedServerProgress;
  }

  if (
    normalizedServerProgress > LOCAL_PROGRESS_REGRESSION_GUARD_SECONDS &&
    stored.progress + LOCAL_PROGRESS_REGRESSION_GUARD_SECONDS <
      normalizedServerProgress
  ) {
    return normalizedServerProgress;
  }

  return stored.progress;
}
