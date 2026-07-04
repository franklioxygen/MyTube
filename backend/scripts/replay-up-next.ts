import Database from "better-sqlite3";

interface VideoRow {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  videoFilename: string | null;
  addedAt: string | null;
  date: string | null;
  tags: string | null;
  seriesTitle: string | null;
  partNumber: number | null;
  rating: number | null;
  viewCount: number | null;
  progress: number | null;
  lastPlayedAt: number | null;
}

interface CollectionVideoRow {
  collectionId: string;
  videoId: string;
  orderValue: number | null;
}

interface PlayEventRow {
  sessionId: string | null;
  videoId: string | null;
  recordedAt: number;
}

interface VideoModel extends VideoRow {
  parsedTags: string[];
}

interface Transition {
  fromVideoId: string;
  toVideoId: string;
}

interface Metrics {
  total: number;
  hit3: number;
  hit10: number;
  mrr: number;
}

const args = process.argv.slice(2);

function getArg(name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return null;
  return args[index + 1];
}

function parseLimit(): number {
  const raw = getArg("--limit");
  if (!raw) return 5000;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5000;
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function tokenize(value: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/i, " ")
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length > 1)
  );
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let overlap = 0;
  for (const item of aSet) {
    if (bSet.has(item)) overlap += 1;
  }
  return overlap / new Set([...aSet, ...bSet]).size;
}

function loadVideos(db: Database.Database): Map<string, VideoModel> {
  const rows = db
    .prepare(
      `SELECT id,
              title,
              author,
              source,
              video_filename AS videoFilename,
              added_at AS addedAt,
              date,
              tags,
              series_title AS seriesTitle,
              part_number AS partNumber,
              rating,
              view_count AS viewCount,
              progress,
              last_played_at AS lastPlayedAt
       FROM videos`
    )
    .all() as VideoRow[];

  return new Map(
    rows.map((row) => [
      row.id,
      {
        ...row,
        parsedTags: parseTags(row.tags),
      },
    ])
  );
}

function loadCollections(db: Database.Database): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT collection_id AS collectionId,
              video_id AS videoId,
              "order" AS orderValue
       FROM collection_videos
       ORDER BY collection_id ASC, COALESCE("order", 0) ASC`
    )
    .all() as CollectionVideoRow[];
  const byCollection = new Map<string, string[]>();

  for (const row of rows) {
    const list = byCollection.get(row.collectionId) ?? [];
    list.push(row.videoId);
    byCollection.set(row.collectionId, list);
  }

  return byCollection;
}

function loadTransitions(
  db: Database.Database,
  videos: Map<string, VideoModel>,
  limit: number
): Transition[] {
  const rows = db
    .prepare(
      `SELECT session_id AS sessionId,
              video_id AS videoId,
              recorded_at AS recordedAt
       FROM usage_statistics_events
       WHERE event_type = 'video_play_started'
         AND session_id IS NOT NULL
         AND video_id IS NOT NULL
       ORDER BY session_id ASC, recorded_at ASC
       LIMIT ?`
    )
    .all(limit) as PlayEventRow[];
  const transitions: Transition[] = [];
  let previous: PlayEventRow | null = null;

  for (const row of rows) {
    if (
      previous &&
      previous.sessionId === row.sessionId &&
      previous.videoId &&
      row.videoId &&
      previous.videoId !== row.videoId &&
      videos.has(previous.videoId) &&
      videos.has(row.videoId)
    ) {
      transitions.push({
        fromVideoId: previous.videoId,
        toVideoId: row.videoId,
      });
    }
    previous = row;
  }

  return transitions;
}

function getCollectionIds(
  videoId: string,
  collections: Map<string, string[]>
): string[] {
  const ids: string[] = [];
  for (const [collectionId, videoIds] of collections.entries()) {
    if (videoIds.includes(videoId)) ids.push(collectionId);
  }
  return ids;
}

function legacyScore(
  current: VideoModel,
  candidate: VideoModel,
  videos: VideoModel[],
  collections: Map<string, string[]>
): number {
  const currentCollections = getCollectionIds(current.id, collections);
  const candidateCollections = getCollectionIds(candidate.id, collections);
  const sameCollection = currentCollections.some((id) => candidateCollections.includes(id));
  const sorted = [...videos].sort((a, b) =>
    (a.videoFilename ?? a.title).localeCompare(b.videoFilename ?? b.title, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  const currentIndex = sorted.findIndex((video) => video.id === current.id);
  const nextGlobalId = currentIndex >= 0 ? sorted[currentIndex + 1]?.id : null;

  return (
    (sameCollection || current.seriesTitle === candidate.seriesTitle ? 0.4 : 0) +
    (current.author && current.author === candidate.author ? 0.3 : 0) +
    jaccard(current.parsedTags, candidate.parsedTags) * 0.35 +
    (current.source && current.source === candidate.source ? 0.08 : 0) +
    (candidate.id === nextGlobalId ? 0.25 : 0)
  );
}

function redesignedScore(
  current: VideoModel,
  candidate: VideoModel,
  collections: Map<string, string[]>
): number {
  let score = 0;
  if (
    current.seriesTitle &&
    current.seriesTitle === candidate.seriesTitle &&
    current.partNumber !== null &&
    candidate.partNumber === current.partNumber + 1
  ) {
    score += 1;
  }

  const currentCollections = getCollectionIds(current.id, collections);
  for (const collectionId of currentCollections) {
    const ids = collections.get(collectionId) ?? [];
    const currentIndex = ids.indexOf(current.id);
    const candidateIndex = ids.indexOf(candidate.id);
    if (currentIndex >= 0 && candidateIndex > currentIndex) {
      score += 0.5 / Math.max(1, candidateIndex - currentIndex);
    }
  }

  score += current.author && current.author === candidate.author ? 0.25 : 0;
  score += jaccard(current.parsedTags, candidate.parsedTags) * 0.2;
  score += current.source && current.source === candidate.source ? 0.05 : 0;
  score += ((candidate.rating ?? 3) - 3) * 0.05;
  return score;
}

function rank(
  current: VideoModel,
  videos: VideoModel[],
  collections: Map<string, string[]>,
  mode: "legacy" | "redesigned"
): string[] {
  return videos
    .filter((candidate) => candidate.id !== current.id)
    .map((candidate) => ({
      id: candidate.id,
      score:
        mode === "legacy"
          ? legacyScore(current, candidate, videos, collections)
          : redesignedScore(current, candidate, collections),
      name: candidate.videoFilename ?? candidate.title,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }))
    .slice(0, 10)
    .map((item) => item.id);
}

function evaluate(
  transitions: Transition[],
  videos: Map<string, VideoModel>,
  collections: Map<string, string[]>,
  mode: "legacy" | "redesigned"
): Metrics {
  const allVideos = Array.from(videos.values());
  const metrics: Metrics = { total: 0, hit3: 0, hit10: 0, mrr: 0 };

  for (const transition of transitions) {
    const current = videos.get(transition.fromVideoId);
    if (!current) continue;
    const ranked = rank(current, allVideos, collections, mode);
    const index = ranked.indexOf(transition.toVideoId);
    metrics.total += 1;
    if (index >= 0 && index < 3) metrics.hit3 += 1;
    if (index >= 0 && index < 10) metrics.hit10 += 1;
    if (index >= 0) metrics.mrr += 1 / (index + 1);
  }

  return metrics;
}

function formatMetrics(metrics: Metrics): string {
  if (metrics.total === 0) return "no transitions";
  return [
    `n=${metrics.total}`,
    `hit@3=${(metrics.hit3 / metrics.total).toFixed(3)}`,
    `hit@10=${(metrics.hit10 / metrics.total).toFixed(3)}`,
    `mrr=${(metrics.mrr / metrics.total).toFixed(3)}`,
  ].join(" ");
}

const dbPath = getArg("--db");
if (!dbPath) {
  console.error("Usage: ts-node scripts/replay-up-next.ts --db /path/to/mytube.db [--limit 5000]");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const videos = loadVideos(db);
  const collections = loadCollections(db);
  const transitions = loadTransitions(db, videos, parseLimit());
  const legacy = evaluate(transitions, videos, collections, "legacy");
  const redesigned = evaluate(transitions, videos, collections, "redesigned");

  console.log(`legacy     ${formatMetrics(legacy)}`);
  console.log(`redesigned ${formatMetrics(redesigned)}`);
} finally {
  db.close();
}
