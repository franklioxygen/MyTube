import { and, desc, eq, lt } from "drizzle-orm";
import fs from "fs-extra";
import path from "path";
import {
    DATA_DIR,
    IMAGES_DIR,
    STATUS_DATA_PATH,
    SUBTITLES_DIR,
    UPLOADS_DIR,
    VIDEOS_DIR,
} from "../config/paths";
import { db, sqlite } from "../db";
import {
    collections,
    collectionVideos,
    downloadHistory,
    downloads,
    settings,
    videoDownloads,
    videos,
} from "../db/schema";
import { formatVideoFilename } from "../utils/helpers";

export interface Video {
  id: string;
  title: string;
  sourceUrl: string;
  videoFilename?: string;
  thumbnailFilename?: string;
  subtitles?: Array<{ language: string; filename: string; path: string }>;
  createdAt: string;
  tags?: string[];
  viewCount?: number;
  progress?: number;
  fileSize?: string;
  description?: string;
  [key: string]: any;
}

export interface Collection {
  id: string;
  title: string;
  videos: string[];
  updatedAt?: string;
  name?: string;
  [key: string]: any;
}

export interface DownloadInfo {
  id: string;
  title: string;
  timestamp: number;
  filename?: string;
  totalSize?: string;
  downloadedSize?: string;
  progress?: number;
  speed?: string;
  sourceUrl?: string;
  type?: string;
}

export interface DownloadHistoryItem {
  id: string;
  title: string;
  author?: string;
  sourceUrl?: string;
  finishedAt: number;
  status: "success" | "failed" | "skipped" | "deleted";
  error?: string;
  videoPath?: string;
  thumbnailPath?: string;
  totalSize?: string;
  videoId?: string; // Reference to the video for skipped items
  downloadedAt?: number; // Original download timestamp for deleted items
  deletedAt?: number; // Deletion timestamp for deleted items
}

export interface VideoDownloadRecord {
  id: string;
  sourceVideoId: string;
  sourceUrl: string;
  platform: string;
  videoId?: string;
  title?: string;
  author?: string;
  status: "exists" | "deleted";
  downloadedAt: number;
  deletedAt?: number;
}

export interface VideoDownloadCheckResult {
  found: boolean;
  status?: "exists" | "deleted";
  videoId?: string;
  title?: string;
  author?: string;
  downloadedAt?: number;
  deletedAt?: number;
}

export interface DownloadStatus {
  activeDownloads: DownloadInfo[];
  queuedDownloads: DownloadInfo[];
}

// Initialize storage directories and files
export function initializeStorage(): void {
  fs.ensureDirSync(UPLOADS_DIR);
  fs.ensureDirSync(VIDEOS_DIR);
  fs.ensureDirSync(IMAGES_DIR);
  fs.ensureDirSync(SUBTITLES_DIR);
  fs.ensureDirSync(DATA_DIR);

  // Initialize status.json if it doesn't exist
  if (!fs.existsSync(STATUS_DATA_PATH)) {
    fs.writeFileSync(
      STATUS_DATA_PATH,
      JSON.stringify({ activeDownloads: [], queuedDownloads: [] }, null, 2)
    );
  } else {
    try {
      const status = JSON.parse(fs.readFileSync(STATUS_DATA_PATH, "utf8"));
      status.activeDownloads = [];
      if (!status.queuedDownloads) status.queuedDownloads = [];
      fs.writeFileSync(STATUS_DATA_PATH, JSON.stringify(status, null, 2));
      console.log("Cleared active downloads on startup");
    } catch (error) {
      console.error("Error resetting active downloads:", error);
      fs.writeFileSync(
        STATUS_DATA_PATH,
        JSON.stringify({ activeDownloads: [], queuedDownloads: [] }, null, 2)
      );
    }
  }

  // Clean up active downloads from database on startup
  try {
    db.delete(downloads).where(eq(downloads.status, "active")).run();
    console.log("Cleared active downloads from database on startup");
  } catch (error) {
    console.error("Error clearing active downloads from database:", error);
  }

  // Check and migrate tags column if needed
  try {
    const tableInfo = sqlite.prepare("PRAGMA table_info(videos)").all();
    const hasTags = (tableInfo as any[]).some(
      (col: any) => col.name === "tags"
    );

    if (!hasTags) {
      console.log("Migrating database: Adding tags column to videos table...");
      sqlite.prepare("ALTER TABLE videos ADD COLUMN tags TEXT").run();
      console.log("Migration successful.");
    }
  } catch (error) {
    console.error("Error checking/migrating tags column:", error);
  }

  // Check and migrate viewCount and progress columns if needed
  try {
    const tableInfo = sqlite.prepare("PRAGMA table_info(videos)").all();
    const columns = (tableInfo as any[]).map((col: any) => col.name);

    if (!columns.includes("view_count")) {
      console.log(
        "Migrating database: Adding view_count column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN view_count INTEGER DEFAULT 0")
        .run();
      console.log("Migration successful: view_count added.");
    }

    if (!columns.includes("progress")) {
      console.log(
        "Migrating database: Adding progress column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN progress INTEGER DEFAULT 0")
        .run();
      console.log("Migration successful: progress added.");
    }

    if (!columns.includes("duration")) {
      console.log(
        "Migrating database: Adding duration column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN duration TEXT").run();
      console.log("Migration successful: duration added.");
    }

    if (!columns.includes("file_size")) {
      console.log(
        "Migrating database: Adding file_size column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN file_size TEXT").run();
      console.log("Migration successful: file_size added.");
    }

    if (!columns.includes("last_played_at")) {
      console.log(
        "Migrating database: Adding last_played_at column to videos table..."
      );
      sqlite
        .prepare("ALTER TABLE videos ADD COLUMN last_played_at INTEGER")
        .run();
      console.log("Migration successful: last_played_at added.");
    }

    if (!columns.includes("subtitles")) {
      console.log(
        "Migrating database: Adding subtitles column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN subtitles TEXT").run();
      console.log("Migration successful: subtitles added.");
    }

    if (!columns.includes("description")) {
      console.log(
        "Migrating database: Adding description column to videos table..."
      );
      sqlite.prepare("ALTER TABLE videos ADD COLUMN description TEXT").run();
      console.log("Migration successful: description added.");
    }

    // Check downloads table columns
    const downloadsTableInfo = sqlite
      .prepare("PRAGMA table_info(downloads)")
      .all();
    const downloadsColumns = (downloadsTableInfo as any[]).map(
      (col: any) => col.name
    );

    if (!downloadsColumns.includes("source_url")) {
      console.log(
        "Migrating database: Adding source_url column to downloads table..."
      );
      sqlite.prepare("ALTER TABLE downloads ADD COLUMN source_url TEXT").run();
      console.log("Migration successful: source_url added.");
    }

    if (!downloadsColumns.includes("type")) {
      console.log(
        "Migrating database: Adding type column to downloads table..."
      );
      sqlite.prepare("ALTER TABLE downloads ADD COLUMN type TEXT").run();
      console.log("Migration successful: type added.");
    }

    // Create video_downloads table if it doesn't exist
    sqlite
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS video_downloads (
        id TEXT PRIMARY KEY NOT NULL,
        source_video_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        platform TEXT NOT NULL,
        video_id TEXT,
        title TEXT,
        author TEXT,
        status TEXT DEFAULT 'exists' NOT NULL,
        downloaded_at INTEGER NOT NULL,
        deleted_at INTEGER
      )
    `
      )
      .run();

    // Create indexes for video_downloads
    try {
      sqlite
        .prepare(
          `CREATE INDEX IF NOT EXISTS video_downloads_source_video_id_idx ON video_downloads (source_video_id)`
        )
        .run();
      sqlite
        .prepare(
          `CREATE INDEX IF NOT EXISTS video_downloads_source_url_idx ON video_downloads (source_url)`
        )
        .run();
    } catch (indexError) {
      // Indexes might already exist, ignore error
    }

    // Check download_history table for video_id, downloaded_at, deleted_at columns
    const downloadHistoryTableInfo = sqlite
      .prepare("PRAGMA table_info(download_history)")
      .all();
    const downloadHistoryColumns = (downloadHistoryTableInfo as any[]).map(
      (col: any) => col.name
    );

    if (!downloadHistoryColumns.includes("video_id")) {
      console.log(
        "Migrating database: Adding video_id column to download_history table..."
      );
      sqlite
        .prepare("ALTER TABLE download_history ADD COLUMN video_id TEXT")
        .run();
      console.log("Migration successful: video_id added to download_history.");
    }

    if (!downloadHistoryColumns.includes("downloaded_at")) {
      console.log(
        "Migrating database: Adding downloaded_at column to download_history table..."
      );
      sqlite
        .prepare(
          "ALTER TABLE download_history ADD COLUMN downloaded_at INTEGER"
        )
        .run();
      console.log(
        "Migration successful: downloaded_at added to download_history."
      );
    }

    if (!downloadHistoryColumns.includes("deleted_at")) {
      console.log(
        "Migrating database: Adding deleted_at column to download_history table..."
      );
      sqlite
        .prepare("ALTER TABLE download_history ADD COLUMN deleted_at INTEGER")
        .run();
      console.log(
        "Migration successful: deleted_at added to download_history."
      );
    }

    // Populate fileSize for existing videos
    const allVideos = db.select().from(videos).all();
    let updatedCount = 0;
    for (const video of allVideos) {
      if (!video.fileSize && video.videoFilename) {
        const videoPath = findVideoFile(video.videoFilename);
        if (videoPath && fs.existsSync(videoPath)) {
          const stats = fs.statSync(videoPath);
          db.update(videos)
            .set({ fileSize: stats.size.toString() })
            .where(eq(videos.id, video.id))
            .run();
          updatedCount++;
        }
      }
    }
    if (updatedCount > 0) {
      console.log(`Populated fileSize for ${updatedCount} videos.`);
    }

    // Backfill video_id in download_history for existing records
    try {
      const result = sqlite
        .prepare(
          `
            UPDATE download_history
            SET video_id = (SELECT id FROM videos WHERE videos.source_url = download_history.source_url)
            WHERE video_id IS NULL AND status = 'success' AND source_url IS NOT NULL
        `
        )
        .run();
      if (result.changes > 0) {
        console.log(
          `Backfilled video_id for ${result.changes} download history items.`
        );
      }
    } catch (error) {
      console.error("Error backfilling video_id in download history:", error);
    }
  } catch (error) {
    console.error(
      "Error checking/migrating viewCount/progress/duration/fileSize columns:",
      error
    );
  }
}

// --- Download Status ---

export function addActiveDownload(id: string, title: string): void {
  try {
    const now = Date.now();
    db.insert(downloads)
      .values({
        id,
        title,
        timestamp: now,
        status: "active",
        // We might want to pass sourceUrl and type here too if available,
        // but addActiveDownload signature currently only has id and title.
        // We will update the signature in a separate step or let updateActiveDownload handle it.
        // Actually, let's update the signature now to be safe, but that breaks callers.
        // For now, let's just insert what we have.
      })
      .onConflictDoUpdate({
        target: downloads.id,
        set: {
          title,
          timestamp: now,
          status: "active",
        },
      })
      .run();
    console.log(`Added/Updated active download: ${title} (${id})`);
  } catch (error) {
    console.error("Error adding active download:", error);
  }
}

export function updateActiveDownload(
  id: string,
  updates: Partial<DownloadInfo>
): void {
  try {
    const updateData: any = {
      timestamp: Date.now(),
    };

    // Explicitly set all fields that might be updated
    if (updates.progress !== undefined) updateData.progress = updates.progress;
    if (updates.totalSize !== undefined)
      updateData.totalSize = updates.totalSize;
    if (updates.downloadedSize !== undefined)
      updateData.downloadedSize = updates.downloadedSize;
    if (updates.speed !== undefined) updateData.speed = updates.speed;
    if (updates.filename !== undefined) updateData.filename = updates.filename;
    if (updates.sourceUrl !== undefined)
      updateData.sourceUrl = updates.sourceUrl;
    if (updates.type !== undefined) updateData.type = updates.type;
    if (updates.title !== undefined) updateData.title = updates.title;

    db.update(downloads).set(updateData).where(eq(downloads.id, id)).run();

    // Debug log for progress updates
    if (updates.progress !== undefined || updates.speed !== undefined) {
      // console.log(
      //   `[Storage] Updated download ${id}: progress=${updates.progress}, speed=${updates.speed}, totalSize=${updates.totalSize}`
      // );
    }
  } catch (error) {
    console.error("Error updating active download:", error);
  }
}

export function removeActiveDownload(id: string): void {
  try {
    db.delete(downloads).where(eq(downloads.id, id)).run();
    console.log(`Removed active download: ${id}`);
  } catch (error) {
    console.error("Error removing active download:", error);
  }
}

export function setQueuedDownloads(queuedDownloads: DownloadInfo[]): void {
  try {
    // Transaction to clear old queued and add new ones
    db.transaction(() => {
      // First, remove all existing queued downloads
      db.delete(downloads).where(eq(downloads.status, "queued")).run();

      // Then insert new ones
      for (const download of queuedDownloads) {
        db.insert(downloads)
          .values({
            id: download.id,
            title: download.title,
            timestamp: download.timestamp,
            status: "queued",
            sourceUrl: download.sourceUrl,
            type: download.type,
          })
          .onConflictDoUpdate({
            target: downloads.id,
            set: {
              title: download.title,
              timestamp: download.timestamp,
              status: "queued",
              sourceUrl: download.sourceUrl,
              type: download.type,
            },
          })
          .run();
      }
    });
  } catch (error) {
    console.error("Error setting queued downloads:", error);
  }
}

export function getDownloadStatus(): DownloadStatus {
  try {
    // Clean up stale ACTIVE downloads (older than 24 hours) - preserve queued downloads
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    db.delete(downloads)
      .where(
        and(lt(downloads.timestamp, oneDayAgo), eq(downloads.status, "active"))
      )
      .run();

    const allDownloads = db.select().from(downloads).all();

    const activeDownloads = allDownloads
      .filter((d) => d.status === "active")
      .map((d) => ({
        id: d.id,
        title: d.title,
        timestamp: d.timestamp || 0,
        filename: d.filename || undefined,
        totalSize: d.totalSize || undefined,
        downloadedSize: d.downloadedSize || undefined,
        progress:
          d.progress !== null && d.progress !== undefined
            ? d.progress
            : undefined,
        speed: d.speed || undefined,
        sourceUrl: d.sourceUrl || undefined,
        type: d.type || undefined,
      }));

    const queuedDownloads = allDownloads
      .filter((d) => d.status === "queued")
      .map((d) => ({
        id: d.id,
        title: d.title,
        timestamp: d.timestamp || 0,
        sourceUrl: d.sourceUrl || undefined,
        type: d.type || undefined,
      }));

    return { activeDownloads, queuedDownloads };
  } catch (error) {
    console.error("Error reading download status:", error);
    return { activeDownloads: [], queuedDownloads: [] };
  }
}

// --- Download History ---

export function addDownloadHistoryItem(item: DownloadHistoryItem): void {
  try {
    db.insert(downloadHistory)
      .values({
        id: item.id,
        title: item.title,
        author: item.author,
        sourceUrl: item.sourceUrl,
        finishedAt: item.finishedAt,
        status: item.status,
        error: item.error,
        videoPath: item.videoPath,
        thumbnailPath: item.thumbnailPath,
        totalSize: item.totalSize,
        videoId: item.videoId,
        downloadedAt: item.downloadedAt,
        deletedAt: item.deletedAt,
      })
      .run();
  } catch (error) {
    console.error("Error adding download history item:", error);
  }
}

export function getDownloadHistory(): DownloadHistoryItem[] {
  try {
    const history = db
      .select()
      .from(downloadHistory)
      .orderBy(desc(downloadHistory.finishedAt))
      .all();
    return history.map((h) => ({
      ...h,
      status: h.status as "success" | "failed" | "skipped" | "deleted",
      author: h.author || undefined,
      sourceUrl: h.sourceUrl || undefined,
      error: h.error || undefined,
      videoPath: h.videoPath || undefined,
      thumbnailPath: h.thumbnailPath || undefined,
      totalSize: h.totalSize || undefined,
      videoId: h.videoId || undefined,
      downloadedAt: h.downloadedAt || undefined,
      deletedAt: h.deletedAt || undefined,
    }));
  } catch (error) {
    console.error("Error getting download history:", error);
    return [];
  }
}

export function removeDownloadHistoryItem(id: string): void {
  try {
    db.delete(downloadHistory).where(eq(downloadHistory.id, id)).run();
  } catch (error) {
    console.error("Error removing download history item:", error);
  }
}

export function clearDownloadHistory(): void {
  try {
    db.delete(downloadHistory).run();
  } catch (error) {
    console.error("Error clearing download history:", error);
  }
}

// --- Video Download Tracking ---

/**
 * Check if a video has been downloaded before by its source video ID
 */
export function checkVideoDownloadBySourceId(
  sourceVideoId: string
): VideoDownloadCheckResult {
  try {
    const record = db
      .select()
      .from(videoDownloads)
      .where(eq(videoDownloads.sourceVideoId, sourceVideoId))
      .get();

    if (record) {
      return {
        found: true,
        status: record.status as "exists" | "deleted",
        videoId: record.videoId || undefined,
        title: record.title || undefined,
        author: record.author || undefined,
        downloadedAt: record.downloadedAt,
        deletedAt: record.deletedAt || undefined,
      };
    }

    return { found: false };
  } catch (error) {
    console.error("Error checking video download by source ID:", error);
    return { found: false };
  }
}

/**
 * Check if a video has been downloaded before by its source URL
 */
export function checkVideoDownloadByUrl(
  sourceUrl: string
): VideoDownloadCheckResult {
  try {
    const record = db
      .select()
      .from(videoDownloads)
      .where(eq(videoDownloads.sourceUrl, sourceUrl))
      .get();

    if (record) {
      return {
        found: true,
        status: record.status as "exists" | "deleted",
        videoId: record.videoId || undefined,
        title: record.title || undefined,
        author: record.author || undefined,
        downloadedAt: record.downloadedAt,
        deletedAt: record.deletedAt || undefined,
      };
    }

    return { found: false };
  } catch (error) {
    console.error("Error checking video download by URL:", error);
    return { found: false };
  }
}

/**
 * Record a new video download
 */
export function recordVideoDownload(
  sourceVideoId: string,
  sourceUrl: string,
  platform: string,
  videoId: string,
  title?: string,
  author?: string
): void {
  try {
    const id = `${platform}-${sourceVideoId}-${Date.now()}`;
    db.insert(videoDownloads)
      .values({
        id,
        sourceVideoId,
        sourceUrl,
        platform,
        videoId,
        title,
        author,
        status: "exists",
        downloadedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: videoDownloads.id,
        set: {
          videoId,
          title,
          author,
          status: "exists",
          deletedAt: null,
        },
      })
      .run();
    console.log(
      `Recorded video download: ${title || sourceVideoId} (${platform})`
    );
  } catch (error) {
    console.error("Error recording video download:", error);
  }
}

/**
 * Mark a video as deleted in the download history
 */
export function markVideoDownloadDeleted(videoId: string): void {
  try {
    db.update(videoDownloads)
      .set({
        status: "deleted",
        deletedAt: Date.now(),
        videoId: null,
      })
      .where(eq(videoDownloads.videoId, videoId))
      .run();
    console.log(`Marked video download as deleted: ${videoId}`);
  } catch (error) {
    console.error("Error marking video download as deleted:", error);
  }
}

/**
 * Update video download record when re-downloading a previously deleted video
 */
export function updateVideoDownloadRecord(
  sourceVideoId: string,
  newVideoId: string,
  title?: string,
  author?: string
): void {
  try {
    db.update(videoDownloads)
      .set({
        videoId: newVideoId,
        title,
        author,
        status: "exists",
        deletedAt: null,
      })
      .where(eq(videoDownloads.sourceVideoId, sourceVideoId))
      .run();
    console.log(`Updated video download record: ${title || sourceVideoId}`);
  } catch (error) {
    console.error("Error updating video download record:", error);
  }
}

// --- Settings ---

export function getSettings(): Record<string, any> {
  try {
    const allSettings = db.select().from(settings).all();
    const settingsMap: Record<string, any> = {};

    for (const setting of allSettings) {
      try {
        settingsMap[setting.key] = JSON.parse(setting.value);
      } catch (e) {
        settingsMap[setting.key] = setting.value;
      }
    }

    return settingsMap;
  } catch (error) {
    console.error("Error getting settings:", error);
    return {};
  }
}

export function saveSettings(newSettings: Record<string, any>): void {
  try {
    db.transaction(() => {
      for (const [key, value] of Object.entries(newSettings)) {
        db.insert(settings)
          .values({
            key,
            value: JSON.stringify(value),
          })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: JSON.stringify(value) },
          })
          .run();
      }
    });
  } catch (error) {
    console.error("Error saving settings:", error);
    throw error;
  }
}

// --- Videos ---

export function getVideos(): Video[] {
  try {
    const allVideos = db
      .select()
      .from(videos)
      .orderBy(desc(videos.createdAt))
      .all();
    return allVideos.map((v) => ({
      ...v,
      tags: v.tags ? JSON.parse(v.tags) : [],
      subtitles: v.subtitles ? JSON.parse(v.subtitles) : undefined,
    })) as Video[];
  } catch (error) {
    console.error("Error getting videos:", error);
    return [];
  }
}

export function getVideoBySourceUrl(sourceUrl: string): Video | undefined {
  try {
    const result = db
      .select()
      .from(videos)
      .where(eq(videos.sourceUrl, sourceUrl))
      .get();

    if (result) {
      return {
        ...result,
        tags: result.tags ? JSON.parse(result.tags) : [],
        subtitles: result.subtitles ? JSON.parse(result.subtitles) : undefined,
      } as Video;
    }
    return undefined;
  } catch (error) {
    console.error("Error getting video by sourceUrl:", error);
    return undefined;
  }
}

export function getVideoById(id: string): Video | undefined {
  try {
    const video = db.select().from(videos).where(eq(videos.id, id)).get();
    if (video) {
      return {
        ...video,
        tags: video.tags ? JSON.parse(video.tags) : [],
        subtitles: video.subtitles ? JSON.parse(video.subtitles) : undefined,
      } as Video;
    }
    return undefined;
  } catch (error) {
    console.error("Error getting video by id:", error);
    return undefined;
  }
}

/**
 * Format legacy filenames to the new standard format: Title-Author-YYYY
 */
export function formatLegacyFilenames(): {
  processed: number;
  renamed: number;
  errors: number;
  details: string[];
} {
  const results = {
    processed: 0,
    renamed: 0,
    errors: 0,
    details: [] as string[],
  };

  try {
    const allVideos = getVideos();
    console.log(
      `Starting legacy filename formatting for ${allVideos.length} videos...`
    );

    for (const video of allVideos) {
      results.processed++;

      try {
        // Generate new filename
        const newBaseFilename = formatVideoFilename(
          video.title,
          video.author || "Unknown",
          video.date
        );

        // preserve subdirectory if it exists (e.g. for collections)
        // We rely on videoPath because videoFilename is usually just the basename
        let subdirectory = "";
        if (video.videoPath) {
          // videoPath is like "/videos/SubDir/file.mp4" or "/videos/file.mp4"
          const relPath = video.videoPath.replace(/^\/videos\//, "");
          const dir = path.dirname(relPath);
          if (dir && dir !== ".") {
            subdirectory = dir;
          }
        }

        // New filename (basename only)
        const newVideoFilename = `${newBaseFilename}.mp4`;
        const newThumbnailFilename = `${newBaseFilename}.jpg`;

        // Calculate full paths for checks
        // For the check we need to know if the resulting full path is different
        // But the check "video.videoFilename === newVideoFilename" only checks basename.
        // If basename matches, we might still want to rename if we were normalizing something else,
        // but usually if format matches, we skip.
        if (video.videoFilename === newVideoFilename) {
          continue;
        }

        console.log(
          `Renaming video ${video.id}: ${video.videoFilename} -> ${newVideoFilename} (Subdir: ${subdirectory})`
        );

        // Paths
        // Old path must be constructed using the subdirectory derived from videoPath
        const oldVideoPath = path.join(
          VIDEOS_DIR,
          subdirectory,
          video.videoFilename || ""
        );
        const newVideoPath = path.join(
          VIDEOS_DIR,
          subdirectory,
          newVideoFilename
        );

        // Handle thumbnail subdirectory
        let thumbSubdir = "";
        if (video.thumbnailPath) {
          const relPath = video.thumbnailPath.replace(/^\/images\//, "");
          const dir = path.dirname(relPath);
          if (dir && dir !== ".") {
            thumbSubdir = dir;
          }
        }

        const oldThumbnailPath = video.thumbnailFilename
          ? path.join(IMAGES_DIR, thumbSubdir, video.thumbnailFilename)
          : null;
        const newThumbnailPath = path.join(
          IMAGES_DIR,
          thumbSubdir,
          newThumbnailFilename
        );

        // Rename video file
        if (fs.existsSync(oldVideoPath)) {
          if (fs.existsSync(newVideoPath) && oldVideoPath !== newVideoPath) {
            // Destination exists, append timestamp to avoid collision
            const uniqueSuffix = `_${Date.now()}`;
            const uniqueBase = `${newBaseFilename}${uniqueSuffix}`;

            const uniqueVideoBase = `${uniqueBase}.mp4`;
            const uniqueThumbBase = `${uniqueBase}.jpg`;

            // Full paths for rename
            const uniqueVideoPath = path.join(
              VIDEOS_DIR,
              subdirectory,
              uniqueVideoBase
            );
            const uniqueThumbPath = path.join(
              IMAGES_DIR,
              thumbSubdir,
              uniqueThumbBase
            ); // Use thumbSubdir

            console.log(
              `Destination exists, using unique suffix: ${uniqueVideoBase}`
            );

            fs.renameSync(oldVideoPath, uniqueVideoPath);

            if (oldThumbnailPath && fs.existsSync(oldThumbnailPath)) {
              fs.renameSync(oldThumbnailPath, uniqueThumbPath);
            }

            // Handle subtitles (Keep in their original folder, assuming root or derived from path if available)
            if (video.subtitles && video.subtitles.length > 0) {
              const newSubtitles = [];
              for (const subtitle of video.subtitles) {
                // Subtitles usually in SUBTITLES_DIR root, checking...
                const oldSubPath = path.join(SUBTITLES_DIR, subtitle.filename);

                // If we ever supported subdirs for subtitles, we'd need to parse subtitle.path here too
                // For now assuming existing structure matches simple join

                if (fs.existsSync(oldSubPath)) {
                  const newSubFilename = `${uniqueBase}.${subtitle.language}.vtt`;
                  const newSubPath = path.join(SUBTITLES_DIR, newSubFilename);
                  fs.renameSync(oldSubPath, newSubPath);
                  newSubtitles.push({
                    ...subtitle,
                    filename: newSubFilename,
                    path: `/subtitles/${newSubFilename}`,
                  });
                } else {
                  newSubtitles.push(subtitle);
                }
              }
              // Update video record with unique names
              // videoFilename should be BASENAME only
              // videoPath should be FULL WEB PATH including subdir
              db.update(videos)
                .set({
                  videoFilename: uniqueVideoBase,
                  thumbnailFilename: video.thumbnailFilename
                    ? uniqueThumbBase
                    : undefined,
                  videoPath: `/videos/${
                    subdirectory ? subdirectory + "/" : ""
                  }${uniqueVideoBase}`,
                  thumbnailPath: video.thumbnailFilename
                    ? `/images/${
                        thumbSubdir ? thumbSubdir + "/" : ""
                      }${uniqueThumbBase}`
                    : null,
                  subtitles: JSON.stringify(newSubtitles),
                })
                .where(eq(videos.id, video.id))
                .run();
            } else {
              // Update video record with unique names
              db.update(videos)
                .set({
                  videoFilename: uniqueVideoBase,
                  thumbnailFilename: video.thumbnailFilename
                    ? uniqueThumbBase
                    : undefined,
                  videoPath: `/videos/${
                    subdirectory ? subdirectory + "/" : ""
                  }${uniqueVideoBase}`,
                  thumbnailPath: video.thumbnailFilename
                    ? `/images/${
                        thumbSubdir ? thumbSubdir + "/" : ""
                      }${uniqueThumbBase}`
                    : null,
                })
                .where(eq(videos.id, video.id))
                .run();
            }

            results.renamed++;
            results.details.push(`Renamed (unique): ${video.title}`);
          } else {
            // Rename normally
            fs.renameSync(oldVideoPath, newVideoPath);

            if (oldThumbnailPath && fs.existsSync(oldThumbnailPath)) {
              // Check if new thumbnail path exists (it shouldn't if specific to this video, but safety check)
              if (
                fs.existsSync(newThumbnailPath) &&
                oldThumbnailPath !== newThumbnailPath
              ) {
                fs.unlinkSync(newThumbnailPath);
              }
              fs.renameSync(oldThumbnailPath, newThumbnailPath);
            }

            // Handle subtitles
            const updatedSubtitles = [];
            if (video.subtitles && video.subtitles.length > 0) {
              for (const subtitle of video.subtitles) {
                const oldSubPath = path.join(SUBTITLES_DIR, subtitle.filename);
                if (fs.existsSync(oldSubPath)) {
                  // Keep subtitles in their current location (usually root SUBTITLES_DIR)
                  const newSubFilename = `${newBaseFilename}.${subtitle.language}.vtt`;
                  const newSubPath = path.join(SUBTITLES_DIR, newSubFilename);

                  // Remove dest if exists
                  if (fs.existsSync(newSubPath)) fs.unlinkSync(newSubPath);

                  fs.renameSync(oldSubPath, newSubPath);
                  updatedSubtitles.push({
                    ...subtitle,
                    filename: newSubFilename,
                    path: `/subtitles/${newSubFilename}`,
                  });
                } else {
                  updatedSubtitles.push(subtitle);
                }
              }
            }

            // Update DB
            db.update(videos)
              .set({
                videoFilename: newVideoFilename,
                thumbnailFilename: video.thumbnailFilename
                  ? newThumbnailFilename
                  : undefined,
                videoPath: `/videos/${
                  subdirectory ? subdirectory + "/" : ""
                }${newVideoFilename}`,
                thumbnailPath: video.thumbnailFilename
                  ? `/images/${
                      thumbSubdir ? thumbSubdir + "/" : ""
                    }${newThumbnailFilename}`
                  : null,
                subtitles:
                  updatedSubtitles.length > 0
                    ? JSON.stringify(updatedSubtitles)
                    : video.subtitles
                    ? JSON.stringify(video.subtitles)
                    : undefined,
              })
              .where(eq(videos.id, video.id))
              .run();

            results.renamed++;
          }
        } else {
          results.details.push(`Skipped (file missing): ${video.title}`);
          // results.errors++; // Not necessarily an error, maybe just missing file
        }
      } catch (err: any) {
        console.error(`Error renaming video ${video.id}:`, err);
        results.errors++;
        results.details.push(`Error: ${video.title} - ${err.message}`);
      }
    }

    return results;
  } catch (error: any) {
    console.error("Error in formatLegacyFilenames:", error);
    throw error;
  }
}

export function saveVideo(videoData: Video): Video {
  try {
    const videoToSave = {
      ...videoData,
      tags: videoData.tags ? JSON.stringify(videoData.tags) : undefined,
      subtitles: videoData.subtitles
        ? JSON.stringify(videoData.subtitles)
        : undefined,
    };
    db.insert(videos)
      .values(videoToSave as any)
      .onConflictDoUpdate({
        target: videos.id,
        set: videoToSave,
      })
      .run();
    return videoData;
  } catch (error) {
    console.error("Error saving video:", error);
    throw error;
  }
}

export function updateVideo(id: string, updates: Partial<Video>): Video | null {
  try {
    const updatesToSave = {
      ...updates,
      // Only include tags/subtitles if they are explicitly in the updates object
      ...(updates.tags !== undefined
        ? { tags: updates.tags ? JSON.stringify(updates.tags) : undefined }
        : {}),
      ...(updates.subtitles !== undefined
        ? {
            subtitles: updates.subtitles
              ? JSON.stringify(updates.subtitles)
              : undefined,
          }
        : {}),
    };
    // If tags is explicitly empty array, we might want to save it as '[]' or null.
    // JSON.stringify([]) is '[]', which is fine.

    const result = db
      .update(videos)
      .set(updatesToSave as any)
      .where(eq(videos.id, id))
      .returning()
      .get();

    if (result) {
      return {
        ...result,
        tags: result.tags ? JSON.parse(result.tags) : [],
        subtitles: result.subtitles ? JSON.parse(result.subtitles) : undefined,
      } as Video;
    }
    return null;
  } catch (error) {
    console.error("Error updating video:", error);
    return null;
  }
}

export function deleteVideo(id: string): boolean {
  try {
    const videoToDelete = getVideoById(id);
    if (!videoToDelete) return false;

    // Remove video file
    if (videoToDelete.videoFilename) {
      const actualPath = findVideoFile(videoToDelete.videoFilename);
      if (actualPath && fs.existsSync(actualPath)) {
        fs.unlinkSync(actualPath);
      }
    }

    // Remove thumbnail file
    if (videoToDelete.thumbnailFilename) {
      const actualPath = findImageFile(videoToDelete.thumbnailFilename);
      if (actualPath && fs.existsSync(actualPath)) {
        fs.unlinkSync(actualPath);
      }
    }

    // Remove subtitle files
    if (videoToDelete.subtitles && videoToDelete.subtitles.length > 0) {
      for (const subtitle of videoToDelete.subtitles) {
        const subtitlePath = path.join(SUBTITLES_DIR, subtitle.filename);
        if (fs.existsSync(subtitlePath)) {
          fs.unlinkSync(subtitlePath);
          console.log(`Deleted subtitle file: ${subtitle.filename}`);
        }
      }
    }

    // Mark video as deleted in download history
    markVideoDownloadDeleted(id);

    // Delete from DB
    db.delete(videos).where(eq(videos.id, id)).run();
    return true;
  } catch (error) {
    console.error("Error deleting video:", error);
    return false;
  }
}

// --- Collections ---

export function getCollections(): Collection[] {
  try {
    const rows = db
      .select({
        c: collections,
        cv: collectionVideos,
      })
      .from(collections)
      .leftJoin(
        collectionVideos,
        eq(collections.id, collectionVideos.collectionId)
      )
      .all();

    const map = new Map<string, Collection>();
    for (const row of rows) {
      if (!map.has(row.c.id)) {
        map.set(row.c.id, {
          ...row.c,
          title: row.c.title || row.c.name,
          updatedAt: row.c.updatedAt || undefined,
          videos: [],
        });
      }
      if (row.cv) {
        map.get(row.c.id)!.videos.push(row.cv.videoId);
      }
    }
    return Array.from(map.values());
  } catch (error) {
    console.error("Error getting collections:", error);
    return [];
  }
}

export function getCollectionById(id: string): Collection | undefined {
  try {
    const rows = db
      .select({
        c: collections,
        cv: collectionVideos,
      })
      .from(collections)
      .leftJoin(
        collectionVideos,
        eq(collections.id, collectionVideos.collectionId)
      )
      .where(eq(collections.id, id))
      .all();

    if (rows.length === 0) return undefined;

    const collection: Collection = {
      ...rows[0].c,
      title: rows[0].c.title || rows[0].c.name,
      updatedAt: rows[0].c.updatedAt || undefined,
      videos: [],
    };

    for (const row of rows) {
      if (row.cv) {
        collection.videos.push(row.cv.videoId);
      }
    }

    return collection;
  } catch (error) {
    console.error("Error getting collection by id:", error);
    return undefined;
  }
}

export function saveCollection(collection: Collection): Collection {
  try {
    db.transaction(() => {
      // Insert collection
      db.insert(collections)
        .values({
          id: collection.id,
          name: collection.name || collection.title,
          title: collection.title,
          createdAt: collection.createdAt || new Date().toISOString(),
          updatedAt: collection.updatedAt,
        })
        .onConflictDoUpdate({
          target: collections.id,
          set: {
            name: collection.name || collection.title,
            title: collection.title,
            updatedAt: new Date().toISOString(),
          },
        })
        .run();

      // Sync videos
      // First delete existing links
      db.delete(collectionVideos)
        .where(eq(collectionVideos.collectionId, collection.id))
        .run();

      // Then insert new links
      if (collection.videos && collection.videos.length > 0) {
        for (const videoId of collection.videos) {
          // Check if video exists to avoid FK error
          const videoExists = db
            .select({ id: videos.id })
            .from(videos)
            .where(eq(videos.id, videoId))
            .get();
          if (videoExists) {
            db.insert(collectionVideos)
              .values({
                collectionId: collection.id,
                videoId: videoId,
              })
              .run();
          }
        }
      }
    });
    return collection;
  } catch (error) {
    console.error("Error saving collection:", error);
    throw error;
  }
}

export function atomicUpdateCollection(
  id: string,
  updateFn: (collection: Collection) => Collection | null
): Collection | null {
  try {
    const collection = getCollectionById(id);
    if (!collection) return null;

    // Deep copy not strictly needed as we reconstruct, but good for safety if updateFn mutates
    const collectionCopy = JSON.parse(JSON.stringify(collection));
    const updatedCollection = updateFn(collectionCopy);

    if (!updatedCollection) return null;

    updatedCollection.updatedAt = new Date().toISOString();
    saveCollection(updatedCollection);
    return updatedCollection;
  } catch (error) {
    console.error("Error atomic updating collection:", error);
    return null;
  }
}

export function deleteCollection(id: string): boolean {
  try {
    const result = db.delete(collections).where(eq(collections.id, id)).run();
    return result.changes > 0;
  } catch (error) {
    console.error("Error deleting collection:", error);
    return false;
  }
}

// --- File Management Helpers ---

function findVideoFile(filename: string): string | null {
  const rootPath = path.join(VIDEOS_DIR, filename);
  if (fs.existsSync(rootPath)) return rootPath;

  const allCollections = getCollections();
  for (const collection of allCollections) {
    const collectionName = collection.name || collection.title;
    if (collectionName) {
      const collectionPath = path.join(VIDEOS_DIR, collectionName, filename);
      if (fs.existsSync(collectionPath)) return collectionPath;
    }
  }
  return null;
}

function findImageFile(filename: string): string | null {
  const rootPath = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(rootPath)) return rootPath;

  const allCollections = getCollections();
  for (const collection of allCollections) {
    const collectionName = collection.name || collection.title;
    if (collectionName) {
      const collectionPath = path.join(IMAGES_DIR, collectionName, filename);
      if (fs.existsSync(collectionPath)) return collectionPath;
    }
  }
  return null;
}

function moveFile(sourcePath: string, destPath: string): void {
  try {
    if (fs.existsSync(sourcePath)) {
      fs.ensureDirSync(path.dirname(destPath));
      fs.moveSync(sourcePath, destPath, { overwrite: true });
      console.log(`Moved file from ${sourcePath} to ${destPath}`);
    }
  } catch (error) {
    console.error(
      `Error moving file from ${sourcePath} to ${destPath}:`,
      error
    );
  }
}

// --- Complex Operations ---

export function addVideoToCollection(
  collectionId: string,
  videoId: string
): Collection | null {
  // Use atomicUpdateCollection to handle DB update
  const collection = atomicUpdateCollection(collectionId, (c) => {
    if (!c.videos.includes(videoId)) {
      c.videos.push(videoId);
    }
    return c;
  });

  if (collection) {
    const video = getVideoById(videoId);
    const collectionName = collection.name || collection.title;

    if (video && collectionName) {
      const updates: Partial<Video> = {};
      let updated = false;

      if (video.videoFilename) {
        const currentVideoPath = findVideoFile(video.videoFilename);
        const targetVideoPath = path.join(
          VIDEOS_DIR,
          collectionName,
          video.videoFilename
        );

        if (currentVideoPath && currentVideoPath !== targetVideoPath) {
          moveFile(currentVideoPath, targetVideoPath);
          updates.videoPath = `/videos/${collectionName}/${video.videoFilename}`;
          updated = true;
        }
      }

      if (video.thumbnailFilename) {
        // Find existing file using path from DB if possible, or fallback to search
        let currentImagePath = "";
        if (video.thumbnailPath) {
             if (video.thumbnailPath.startsWith("/videos/")) {
                 currentImagePath = path.join(VIDEOS_DIR, video.thumbnailPath.replace(/^\/videos\//, ""));
             } else if (video.thumbnailPath.startsWith("/images/")) {
                 currentImagePath = path.join(IMAGES_DIR, video.thumbnailPath.replace(/^\/images\//, ""));
             }
        }
        
        if (!currentImagePath || !fs.existsSync(currentImagePath)) {
             currentImagePath = findImageFile(video.thumbnailFilename) || "";
        }

        // Determine target
        const settings = getSettings();
        const moveWithVideo = settings.moveThumbnailsToVideoFolder;
        
        let targetImagePath = "";
        let newWebPath = "";

        if (moveWithVideo) {
            targetImagePath = path.join(VIDEOS_DIR, collectionName, video.thumbnailFilename);
            newWebPath = `/videos/${collectionName}/${video.thumbnailFilename}`;
        } else {
            targetImagePath = path.join(IMAGES_DIR, collectionName, video.thumbnailFilename);
            newWebPath = `/images/${collectionName}/${video.thumbnailFilename}`;
        }

        if (currentImagePath && currentImagePath !== targetImagePath) {
          moveFile(currentImagePath, targetImagePath);
          updates.thumbnailPath = newWebPath;
          updated = true;
        }
      }

      // Handle subtitles
      if (video.subtitles && video.subtitles.length > 0) {
        const newSubtitles = [...video.subtitles];
        let subtitlesUpdated = false;

        newSubtitles.forEach((sub, index) => {
          let currentSubPath = sub.path;
          // Determine existing absolute path
          let absoluteSourcePath = "";
          if (sub.path.startsWith("/videos/")) {
             absoluteSourcePath = path.join(VIDEOS_DIR, sub.path.replace("/videos/", ""));
          } else if (sub.path.startsWith("/subtitles/")) {
             absoluteSourcePath = path.join(path.dirname(SUBTITLES_DIR), sub.path); // SUBTITLES_DIR is uploads/subtitles
          }
           
           // If we can't determine source path easily from DB, try to find it
           if (!fs.existsSync(absoluteSourcePath)) {
             // Fallback: try finding in root or collection folders
             // But simpler to rely on path stored in DB if valid
           }

           let targetSubDir = "";
           let newWebPath = "";

           // Logic:
           // If it's currently in VIDEOS_DIR (starts with /videos/), it should stay with video -> move to new video folder
           // If it's currently in SUBTITLES_DIR (starts with /subtitles/), it should move to new mirror folder in SUBTITLES_DIR
           
           if (sub.path.startsWith("/videos/")) {
              targetSubDir = path.join(VIDEOS_DIR, collectionName);
              newWebPath = `/videos/${collectionName}/${path.basename(sub.path)}`;
           } else if (sub.path.startsWith("/subtitles/")) {
              targetSubDir = path.join(SUBTITLES_DIR, collectionName);
              newWebPath = `/subtitles/${collectionName}/${path.basename(sub.path)}`;
           }

           if (absoluteSourcePath && targetSubDir && newWebPath) {
             const targetSubPath = path.join(targetSubDir, path.basename(sub.path));
             if (fs.existsSync(absoluteSourcePath) && absoluteSourcePath !== targetSubPath) {
                 moveFile(absoluteSourcePath, targetSubPath);
                 newSubtitles[index] = {
                   ...sub,
                   path: newWebPath
                 };
                 subtitlesUpdated = true;
             }
           }
        });

        if (subtitlesUpdated) {
          updates.subtitles = newSubtitles;
          updated = true;
        }
      }

      if (updated) {
        updateVideo(videoId, updates);
      }
    }
  }

  return collection;
}

export function removeVideoFromCollection(
  collectionId: string,
  videoId: string
): Collection | null {
  const collection = atomicUpdateCollection(collectionId, (c) => {
    c.videos = c.videos.filter((v) => v !== videoId);
    return c;
  });

  if (collection) {
    const video = getVideoById(videoId);

    if (video) {
      // Check if video is in any other collection
      const allCollections = getCollections();
      const otherCollection = allCollections.find(
        (c) => c.videos.includes(videoId) && c.id !== collectionId
      );

      let targetVideoDir = VIDEOS_DIR;
      let targetImageDir = IMAGES_DIR;
      let videoPathPrefix = "/videos";
      let imagePathPrefix = "/images";

      if (otherCollection) {
        const otherName = otherCollection.name || otherCollection.title;
        if (otherName) {
          targetVideoDir = path.join(VIDEOS_DIR, otherName);
          targetImageDir = path.join(IMAGES_DIR, otherName);
          videoPathPrefix = `/videos/${otherName}`;
          imagePathPrefix = `/images/${otherName}`;
        }
      }

      const updates: Partial<Video> = {};
      let updated = false;

      if (video.videoFilename) {
        const currentVideoPath = findVideoFile(video.videoFilename);
        const targetVideoPath = path.join(targetVideoDir, video.videoFilename);

        if (currentVideoPath && currentVideoPath !== targetVideoPath) {
          moveFile(currentVideoPath, targetVideoPath);
          updates.videoPath = `${videoPathPrefix}/${video.videoFilename}`;
          updated = true;
        }
      }

      if (video.thumbnailFilename) {
        // Find existing file using path from DB if possible
        let currentImagePath = "";
        if (video.thumbnailPath) {
             if (video.thumbnailPath.startsWith("/videos/")) {
                 currentImagePath = path.join(VIDEOS_DIR, video.thumbnailPath.replace(/^\/videos\//, ""));
             } else if (video.thumbnailPath.startsWith("/images/")) {
                 currentImagePath = path.join(IMAGES_DIR, video.thumbnailPath.replace(/^\/images\//, ""));
             }
        }
        
        if (!currentImagePath || !fs.existsSync(currentImagePath)) {
             currentImagePath = findImageFile(video.thumbnailFilename) || "";
        }

        // Determine target
        const settings = getSettings();
        const moveWithVideo = settings.moveThumbnailsToVideoFolder;

        let targetImagePath = "";
        let newWebPath = "";

        if (moveWithVideo) {
             // Target is same as video target
             targetImagePath = path.join(targetVideoDir, video.thumbnailFilename);
             newWebPath = `${videoPathPrefix}/${video.thumbnailFilename}`;
        } else {
             // Target is image dir (root or other collection)
             targetImagePath = path.join(targetImageDir, video.thumbnailFilename);
             newWebPath = `${imagePathPrefix}/${video.thumbnailFilename}`;
        }

        if (currentImagePath && currentImagePath !== targetImagePath) {
          moveFile(currentImagePath, targetImagePath);
          updates.thumbnailPath = newWebPath;
          updated = true;
        }
      }

      // Handle subtitles
      if (video.subtitles && video.subtitles.length > 0) {
        const newSubtitles = [...video.subtitles];
        let subtitlesUpdated = false;

        newSubtitles.forEach((sub, index) => {
           let absoluteSourcePath = "";
           // Construct absolute source path based on DB path
           if (sub.path.startsWith("/videos/")) {
               absoluteSourcePath = path.join(VIDEOS_DIR, sub.path.replace("/videos/", ""));
           } else if (sub.path.startsWith("/subtitles/")) {
               // sub.path is like /subtitles/Collection/file.vtt
               // SUBTITLES_DIR is uploads/subtitles
               absoluteSourcePath = path.join(UPLOADS_DIR, sub.path.replace(/^\//, "")); // path.join(headers...) -> uploads/subtitles/...
           }

           let targetSubDir = "";
           let newWebPath = "";

           if (sub.path.startsWith("/videos/")) {
               targetSubDir = targetVideoDir; // Calculated above (root or other collection)
               newWebPath = `${videoPathPrefix}/${path.basename(sub.path)}`;
           } else if (sub.path.startsWith("/subtitles/")) {
               // Should move to root subtitles or other collection subtitles
               if (otherCollection) {
                   const otherName = otherCollection.name || otherCollection.title;
                   if (otherName) {
                       targetSubDir = path.join(SUBTITLES_DIR, otherName);
                       newWebPath = `/subtitles/${otherName}/${path.basename(sub.path)}`;
                   }
               } else {
                   // Move to root subtitles dir
                   targetSubDir = SUBTITLES_DIR;
                   newWebPath = `/subtitles/${path.basename(sub.path)}`;
               }
           }

           if (absoluteSourcePath && targetSubDir && newWebPath) {
               const targetSubPath = path.join(targetSubDir, path.basename(sub.path));
               
               // Ensure correct paths for move
               // Need to handle potential double slashes or construction issues if any
               if (fs.existsSync(absoluteSourcePath) && absoluteSourcePath !== targetSubPath) {
                   moveFile(absoluteSourcePath, targetSubPath);
                   newSubtitles[index] = {
                       ...sub,
                       path: newWebPath
                   };
                   subtitlesUpdated = true;
               }
           }
        });

        if (subtitlesUpdated) {
            updates.subtitles = newSubtitles;
            updated = true;
        }
      }

      if (updated) {
        updateVideo(videoId, updates);
      }
    }
  }

  return collection;
}

export function deleteCollectionWithFiles(collectionId: string): boolean {
  const collection = getCollectionById(collectionId);
  if (!collection) return false;

  const collectionName = collection.name || collection.title;

  if (collection.videos && collection.videos.length > 0) {
    collection.videos.forEach((videoId) => {
      const video = getVideoById(videoId);
      if (video) {
        // Move files back to root
        const updates: Partial<Video> = {};
        let updated = false;

        if (video.videoFilename) {
          const currentVideoPath = findVideoFile(video.videoFilename);
          const targetVideoPath = path.join(VIDEOS_DIR, video.videoFilename);

          if (currentVideoPath && currentVideoPath !== targetVideoPath) {
            moveFile(currentVideoPath, targetVideoPath);
            updates.videoPath = `/videos/${video.videoFilename}`;
            updated = true;
          }
        }

        if (video.thumbnailFilename) {
          const currentImagePath = findImageFile(video.thumbnailFilename);
          const targetImagePath = path.join(
            IMAGES_DIR,
            video.thumbnailFilename
          );

          if (currentImagePath && currentImagePath !== targetImagePath) {
            moveFile(currentImagePath, targetImagePath);
            updates.thumbnailPath = `/images/${video.thumbnailFilename}`;
            updated = true;
          }
        }

        // Handle subtitles
        if (video.subtitles && video.subtitles.length > 0) {
          const newSubtitles = [...video.subtitles];
          let subtitlesUpdated = false;

          newSubtitles.forEach((sub, index) => {
             let absoluteSourcePath = "";
             // Construct absolute source path based on DB path
             if (sub.path.startsWith("/videos/")) {
                 absoluteSourcePath = path.join(VIDEOS_DIR, sub.path.replace("/videos/", ""));
             } else if (sub.path.startsWith("/subtitles/")) {
                 absoluteSourcePath = path.join(UPLOADS_DIR, sub.path.replace(/^\//, ""));
             }

             let targetSubDir = "";
             let newWebPath = "";

             if (sub.path.startsWith("/videos/")) {
                 targetSubDir = VIDEOS_DIR;
                 newWebPath = `/videos/${path.basename(sub.path)}`;
             } else if (sub.path.startsWith("/subtitles/")) {
                 // Move to root subtitles dir
                 targetSubDir = SUBTITLES_DIR;
                 newWebPath = `/subtitles/${path.basename(sub.path)}`;
             }

             if (absoluteSourcePath && targetSubDir && newWebPath) {
                 const targetSubPath = path.join(targetSubDir, path.basename(sub.path));
                 
                 if (fs.existsSync(absoluteSourcePath) && absoluteSourcePath !== targetSubPath) {
                     moveFile(absoluteSourcePath, targetSubPath);
                     newSubtitles[index] = {
                         ...sub,
                         path: newWebPath
                     };
                     subtitlesUpdated = true;
                 }
             }
          });

          if (subtitlesUpdated) {
              updates.subtitles = newSubtitles;
              updated = true;
          }
        }

        if (updated) {
          updateVideo(videoId, updates);
        }
      }
    });
  }

  // Delete collection directory if exists and empty
  if (collectionName) {
    const collectionVideoDir = path.join(VIDEOS_DIR, collectionName);
    const collectionImageDir = path.join(IMAGES_DIR, collectionName);

    try {
      if (
        fs.existsSync(collectionVideoDir) &&
        fs.readdirSync(collectionVideoDir).length === 0
      ) {
        fs.rmdirSync(collectionVideoDir);
      }
      if (
        fs.existsSync(collectionImageDir) &&
        fs.readdirSync(collectionImageDir).length === 0
      ) {
        fs.rmdirSync(collectionImageDir);
      }
    } catch (e) {
      console.error("Error removing collection directories:", e);
    }
  }

  return deleteCollection(collectionId);
}

export function deleteCollectionAndVideos(collectionId: string): boolean {
  const collection = getCollectionById(collectionId);
  if (!collection) return false;

  const collectionName = collection.name || collection.title;

  // Delete all videos in the collection
  if (collection.videos && collection.videos.length > 0) {
    collection.videos.forEach((videoId) => {
      deleteVideo(videoId);
    });
  }

  // Delete collection directory if exists
  if (collectionName) {
    const collectionVideoDir = path.join(VIDEOS_DIR, collectionName);
    const collectionImageDir = path.join(IMAGES_DIR, collectionName);

    try {
      if (fs.existsSync(collectionVideoDir)) {
        fs.rmdirSync(collectionVideoDir);
      }
      if (fs.existsSync(collectionImageDir)) {
        fs.rmdirSync(collectionImageDir);
      }
    } catch (e) {
      console.error("Error removing collection directories:", e);
    }
  }

  return deleteCollection(collectionId);
}
