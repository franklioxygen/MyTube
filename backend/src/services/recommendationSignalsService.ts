import { sqlite } from "../db";
import { parseDurationSeconds } from "./statistics/normalizers";
import { isStatisticsEnabled } from "./statistics/collector";

const SIGNAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const WATCH_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;
const COPLAY_HALF_LIFE_MS = 120 * 24 * 60 * 60 * 1000;
const COPLAY_SHRINK_K = 3;
const TOP_NEIGHBOR_LIMIT = 20;

export interface RecommendationSignals {
  computedAt: number;
  perVideo: Record<string, {
    ws: number;
    cr: number;
    ar: number;
    lf: number | null;
    rw: number;
    nb: [string, number][];
  }>;
  authorAffinity: Record<string, number>;
  tagAffinity: Record<string, number>;
  durationBands: number[];
}

type VisibilityRole = "admin" | "visitor";

interface VideoSignalRow {
  id: string;
  author: string | null;
  channelUrl: string | null;
  tags: string | null;
  duration: string | null;
  rating: number | null;
  viewCount: number | null;
  progress: number | null;
  lastPlayedAt: number | null;
  visibility: number | null;
}

interface SubscriptionSignalRow {
  author: string | null;
  authorUrl: string | null;
}

interface StatisticsSignalEventRow {
  eventType: "video_play_started" | "video_watch_chunk_recorded";
  recordedAt: number;
  sessionId: string | null;
  videoId: string;
  durationSeconds: number | null;
}

interface SessionPlay {
  videoId: string;
  recordedAt: number;
  rawSeconds: number;
  lastRecordedAt: number;
}

interface MutableVideoStats {
  watchSeconds: number;
  rawWatchSeconds: number;
  sessions: number;
  abandonedSessions: number;
  lastFinishedAt: number | null;
}

interface CachedSignals {
  expiresAt: number;
  value: RecommendationSignals | null;
}

const cacheByRole = new Map<VisibilityRole, CachedSignals>();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeKey = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

const getAuthorKey = (video: VideoSignalRow): string =>
  normalizeKey(video.channelUrl || video.author);

const getSubscriptionKeys = (subscription: SubscriptionSignalRow): string[] =>
  [subscription.authorUrl, subscription.author]
    .map(normalizeKey)
    .filter(Boolean);

const parseTags = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(
      parsed
        .filter((tag): tag is string => typeof tag === "string")
        .map(normalizeKey)
        .filter(Boolean)
    ));
  } catch {
    return [];
  }
};

const decay = (recordedAt: number, now: number, halfLifeMs: number): number => {
  const age = Math.max(0, now - recordedAt);
  return Math.pow(2, -age / halfLifeMs);
};

const getDurationBand = (durationSeconds: number | null): number => {
  if (!durationSeconds || durationSeconds < 5 * 60) return 0;
  if (durationSeconds < 15 * 60) return 1;
  if (durationSeconds < 45 * 60) return 2;
  return 3;
};

const getSessionVideoKey = (sessionId: string, videoId: string): string =>
  `${sessionId}\u0000${videoId}`;

const isVisibleForRole = (video: VideoSignalRow, role: VisibilityRole): boolean =>
  role !== "visitor" || video.visibility !== 0;

const queryVideos = (): VideoSignalRow[] =>
  sqlite
    .prepare(
      `SELECT id,
              author,
              channel_url AS channelUrl,
              tags,
              duration,
              rating,
              view_count AS viewCount,
              progress,
              last_played_at AS lastPlayedAt,
              visibility
       FROM videos`
    )
    .all() as VideoSignalRow[];

const querySubscriptions = (): SubscriptionSignalRow[] =>
  sqlite
    .prepare(
      `SELECT author, author_url AS authorUrl
       FROM subscriptions
       WHERE COALESCE(paused, 0) = 0`
    )
    .all() as SubscriptionSignalRow[];

const queryStatisticsEvents = (): StatisticsSignalEventRow[] =>
  sqlite
    .prepare(
      `SELECT event_type AS eventType,
              recorded_at AS recordedAt,
              session_id AS sessionId,
              video_id AS videoId,
              duration_seconds AS durationSeconds
       FROM usage_statistics_events
       WHERE event_type IN ('video_play_started', 'video_watch_chunk_recorded')
         AND video_id IS NOT NULL
       ORDER BY COALESCE(session_id, ''), recorded_at ASC`
    )
    .all() as StatisticsSignalEventRow[];

const createStats = (): MutableVideoStats => ({
  watchSeconds: 0,
  rawWatchSeconds: 0,
  sessions: 0,
  abandonedSessions: 0,
  lastFinishedAt: null,
});

const getAbandonThreshold = (durationSeconds: number | null): number => {
  if (!durationSeconds || durationSeconds <= 0) return 30;
  return Math.min(durationSeconds, Math.max(30, durationSeconds * 0.05));
};

const addToRecord = (
  record: Record<string, number>,
  key: string,
  value: number
): void => {
  if (!key || value <= 0) return;
  record[key] = (record[key] ?? 0) + value;
};

const normalizeRecord = (record: Record<string, number>): Record<string, number> => {
  const total = Object.values(record).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return {};

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, clamp(value / total, 0, 1)])
  );
};

const buildSignals = (role: VisibilityRole, now: number): RecommendationSignals | null => {
  const allVideos = queryVideos();
  const videos = allVideos.filter(video => isVisibleForRole(video, role));
  const videoById = new Map(videos.map(video => [video.id, video]));
  const visibleVideoIds = new Set(videoById.keys());
  const events = queryStatisticsEvents().filter(row => visibleVideoIds.has(row.videoId));

  if (events.length === 0) return null;

  const statsByVideoId = new Map<string, MutableVideoStats>();
  const sessionPlays = new Map<string, SessionPlay[]>();
  const latestPlayBySessionVideo = new Map<string, SessionPlay>();
  const decayedWatchByVideoId = new Map<string, number>();
  const durationBands = [0, 0, 0, 0];

  for (const row of events) {
    const video = videoById.get(row.videoId);
    if (!video) continue;
    const durationSeconds = parseDurationSeconds(video.duration);

    if (row.eventType === "video_play_started") {
      const sessionId = row.sessionId || `play:${row.videoId}:${row.recordedAt}`;
      const plays = sessionPlays.get(sessionId) ?? [];
      const play = {
        videoId: row.videoId,
        recordedAt: row.recordedAt,
        rawSeconds: 0,
        lastRecordedAt: row.recordedAt,
      };
      plays.push(play);
      sessionPlays.set(sessionId, plays);
      latestPlayBySessionVideo.set(getSessionVideoKey(sessionId, row.videoId), play);
      const stats = statsByVideoId.get(row.videoId) ?? createStats();
      stats.sessions += 1;
      statsByVideoId.set(row.videoId, stats);
      continue;
    }

    const durationSecondsWatched = row.durationSeconds ?? 0;
    if (durationSecondsWatched <= 0) continue;

    const decayedSeconds = durationSecondsWatched * decay(row.recordedAt, now, WATCH_HALF_LIFE_MS);
    decayedWatchByVideoId.set(
      row.videoId,
      (decayedWatchByVideoId.get(row.videoId) ?? 0) + decayedSeconds
    );
    durationBands[getDurationBand(durationSeconds)] += decayedSeconds;

    if (!row.sessionId) continue;
    const key = getSessionVideoKey(row.sessionId, row.videoId);
    const play = latestPlayBySessionVideo.get(key);
    if (!play) continue;
    play.rawSeconds += durationSecondsWatched;
    play.lastRecordedAt = Math.max(play.lastRecordedAt, row.recordedAt);
  }

  for (const [videoId, watchSeconds] of decayedWatchByVideoId.entries()) {
    const stats = statsByVideoId.get(videoId) ?? createStats();
    stats.watchSeconds = watchSeconds;
    statsByVideoId.set(videoId, stats);
  }

  for (const plays of sessionPlays.values()) {
    for (const play of plays) {
      const video = videoById.get(play.videoId);
      if (!video) continue;

      const durationSeconds = parseDurationSeconds(video.duration);
      const rawSeconds = play.rawSeconds;
      const stats = statsByVideoId.get(play.videoId) ?? createStats();
      stats.rawWatchSeconds += rawSeconds;

      if (rawSeconds < getAbandonThreshold(durationSeconds)) {
        stats.abandonedSessions += 1;
      }

      if (durationSeconds && rawSeconds / durationSeconds >= 0.9) {
        stats.lastFinishedAt = Math.max(
          stats.lastFinishedAt ?? 0,
          play.lastRecordedAt
        );
      }

      statsByVideoId.set(play.videoId, stats);
    }
  }

  const edgeWeights = new Map<string, Map<string, number>>();
  const edgeTotals = new Map<string, number>();

  for (const plays of sessionPlays.values()) {
    const qualifiedPlays = plays.filter(play => {
      const video = videoById.get(play.videoId);
      if (!video) return false;
      return play.rawSeconds >= getAbandonThreshold(parseDurationSeconds(video.duration));
    });

    for (let sourceIndex = 0; sourceIndex < qualifiedPlays.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < qualifiedPlays.length; targetIndex += 1) {
        const source = qualifiedPlays[sourceIndex];
        const target = qualifiedPlays[targetIndex];
        if (source.videoId === target.videoId) continue;

        const playsBetween = targetIndex - sourceIndex - 1;
        const weight = Math.pow(2, -playsBetween) *
          decay(target.recordedAt, now, COPLAY_HALF_LIFE_MS);
        const neighbors = edgeWeights.get(source.videoId) ?? new Map<string, number>();
        neighbors.set(target.videoId, (neighbors.get(target.videoId) ?? 0) + weight);
        edgeWeights.set(source.videoId, neighbors);
        edgeTotals.set(source.videoId, (edgeTotals.get(source.videoId) ?? 0) + weight);
      }
    }
  }

  const authorWatch: Record<string, number> = {};
  const tagWatch: Record<string, number> = {};
  const ratingByAuthor = new Map<string, { total: number; count: number }>();

  for (const video of videos) {
    const authorKey = getAuthorKey(video);
    if (authorKey && typeof video.rating === "number") {
      const current = ratingByAuthor.get(authorKey) ?? { total: 0, count: 0 };
      current.total += video.rating;
      current.count += 1;
      ratingByAuthor.set(authorKey, current);
    }

    const watchSeconds = decayedWatchByVideoId.get(video.id) ?? 0;
    if (watchSeconds <= 0) continue;

    addToRecord(authorWatch, authorKey, watchSeconds);
    for (const tag of parseTags(video.tags)) {
      addToRecord(tagWatch, tag, watchSeconds);
    }
  }

  const authorAffinity = normalizeRecord(authorWatch);
  for (const subscription of querySubscriptions()) {
    for (const key of getSubscriptionKeys(subscription)) {
      authorAffinity[key] = clamp((authorAffinity[key] ?? 0) + 0.15, 0, 1);
    }
  }

  for (const [authorKey, rating] of ratingByAuthor.entries()) {
    if (rating.count === 0) continue;
    const meanRating = rating.total / rating.count;
    authorAffinity[authorKey] = clamp(
      (authorAffinity[authorKey] ?? 0) + Math.max(0, (meanRating - 3) / 2) * 0.05,
      0,
      1
    );
  }

  const tagAffinity = normalizeRecord(tagWatch);
  const durationTotal = durationBands.reduce((sum, value) => sum + value, 0);
  const normalizedDurationBands = durationTotal > 0
    ? durationBands.map(value => clamp(value / durationTotal, 0, 1))
    : durationBands;

  const perVideo: RecommendationSignals["perVideo"] = {};
  for (const [videoId, stats] of statsByVideoId.entries()) {
    if (stats.sessions <= 0 && stats.watchSeconds <= 0) continue;
    const video = videoById.get(videoId);
    const durationSeconds = parseDurationSeconds(video?.duration ?? null);
    const completionRatio = durationSeconds && stats.sessions > 0
      ? clamp(stats.rawWatchSeconds / (durationSeconds * stats.sessions), 0, 1)
      : 0;
    const abandonRate = stats.sessions > 0
      ? clamp(stats.abandonedSessions / stats.sessions, 0, 1)
      : 0;
    const rewatchRate = stats.sessions > 0
      ? clamp(Math.max(0, stats.sessions - 1) / stats.sessions, 0, 1)
      : 0;
    const outTotal = edgeTotals.get(videoId) ?? 0;
    const neighbors = Array.from(edgeWeights.get(videoId)?.entries() ?? [])
      .map(([neighborId, weight]) => [
        neighborId,
        clamp(weight / (outTotal + COPLAY_SHRINK_K), 0, 1),
      ] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_NEIGHBOR_LIMIT);

    perVideo[videoId] = {
      ws: Math.round(stats.watchSeconds),
      cr: Number(completionRatio.toFixed(4)),
      ar: Number(abandonRate.toFixed(4)),
      lf: stats.lastFinishedAt,
      rw: Number(rewatchRate.toFixed(4)),
      nb: neighbors.map(([neighborId, score]) => [
        neighborId,
        Number(score.toFixed(4)),
      ]),
    };
  }

  return {
    computedAt: now,
    perVideo,
    authorAffinity,
    tagAffinity,
    durationBands: normalizedDurationBands.map(value => Number(value.toFixed(4))),
  };
};

export const invalidateRecommendationSignalsCache = (): void => {
  cacheByRole.clear();
};

export const getRecommendationSignals = (
  role: "admin" | "visitor" | undefined = "admin"
): RecommendationSignals | null => {
  if (!isStatisticsEnabled()) return null;

  const cacheKey: VisibilityRole = role === "visitor" ? "visitor" : "admin";
  const now = Date.now();
  const cached = cacheByRole.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = buildSignals(cacheKey, now);
  cacheByRole.set(cacheKey, { value, expiresAt: now + SIGNAL_CACHE_TTL_MS });
  return value;
};
