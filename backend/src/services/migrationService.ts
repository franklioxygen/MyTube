import fs from "fs-extra";
import path from "path";
import {
  COLLECTIONS_DATA_PATH,
  DATA_DIR,
  STATUS_DATA_PATH,
  VIDEOS_DATA_PATH,
} from "../config/paths";
import { db } from "../db";
import {
  collections,
  collectionVideos,
  downloads,
  settings,
  videos,
} from "../db/schema";
import { FileError } from "../errors/DownloadErrors";

// Hardcoded path for settings since it might not be exported from paths.ts
const SETTINGS_DATA_PATH = path.join(
  path.dirname(VIDEOS_DATA_PATH),
  "settings.json"
);

export async function runMigration() {
  console.log("Starting migration...");
  const results = {
    videos: { count: 0, path: VIDEOS_DATA_PATH, found: false },
    collections: { count: 0, path: COLLECTIONS_DATA_PATH, found: false },
    settings: { count: 0, path: SETTINGS_DATA_PATH, found: false },
    downloads: { count: 0, path: STATUS_DATA_PATH, found: false },
    errors: [] as string[],
    warnings: [] as string[],
  };

  // Check for common misconfiguration (nested data directory)
  const nestedDataPath = path.join(DATA_DIR, "data");
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (fs.existsSync(nestedDataPath)) {
    results.warnings.push(
      `Found nested data directory at ${nestedDataPath}. Your volume mount might be incorrect (mounting /data to /app/data instead of /app/data contents).`
    );
  }

  // Migrate Videos
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (fs.existsSync(VIDEOS_DATA_PATH)) {
    results.videos.found = true;
    try {
      const videosData = fs.readJSONSync(VIDEOS_DATA_PATH);
      console.log(`Found ${videosData.length} videos to migrate.`);

      for (const video of videosData) {
        try {
          // Fix for missing createdAt in legacy data
          let createdAt = video.createdAt;
          if (!createdAt) {
            if (video.addedAt) {
              createdAt = video.addedAt;
            } else if (video.id && /^\d{13}$/.test(video.id)) {
              // If ID is a timestamp (13 digits), use it
              createdAt = new Date(parseInt(video.id)).toISOString();
            } else {
              createdAt = new Date().toISOString();
            }
          }

          await db
            .insert(videos)
            .values({
              id: video.id,
              title: video.title,
              author: video.author,
              date: video.date,
              source: video.source,
              sourceUrl: video.sourceUrl,
              videoFilename: video.videoFilename,
              thumbnailFilename: video.thumbnailFilename,
              videoPath: video.videoPath,
              thumbnailPath: video.thumbnailPath,
              thumbnailUrl: video.thumbnailUrl,
              addedAt: video.addedAt,
              createdAt: createdAt,
              updatedAt: video.updatedAt,
              partNumber: video.partNumber,
              totalParts: video.totalParts,
              seriesTitle: video.seriesTitle,
              rating: video.rating,
              description: video.description,
              viewCount: video.viewCount,
              duration: video.duration,
            })
            .onConflictDoNothing()
            .run();
          results.videos.count++;
        } catch (error: any) {
          console.error(`Error migrating video ${video.id}:`, error);
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          results.errors.push(`Video ${video.id}: ${errorMsg}`);
        }
      }
    } catch (error: any) {
      const errorMsg =
        error instanceof FileError
          ? error.message
          : error instanceof Error
          ? error.message
          : String(error);
      results.errors.push(`Failed to read videos.json: ${errorMsg}`);
    }
  }

  // Migrate Collections
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (fs.existsSync(COLLECTIONS_DATA_PATH)) {
    results.collections.found = true;
    try {
      const collectionsData = fs.readJSONSync(COLLECTIONS_DATA_PATH);
      console.log(`Found ${collectionsData.length} collections to migrate.`);

      for (const collection of collectionsData) {
        try {
          // Insert Collection
          await db
            .insert(collections)
            .values({
              id: collection.id,
              name:
                collection.name || collection.title || "Untitled Collection",
              title: collection.title,
              createdAt: collection.createdAt || new Date().toISOString(),
              updatedAt: collection.updatedAt,
            })
            .onConflictDoNothing()
            .run();
          results.collections.count++;

          // Insert Collection Videos
          if (collection.videos && collection.videos.length > 0) {
            for (const videoId of collection.videos) {
              try {
                await db
                  .insert(collectionVideos)
                  .values({
                    collectionId: collection.id,
                    videoId: videoId,
                  })
                  .onConflictDoNothing()
                  .run();
              } catch (err: any) {
                console.error(
                  `Error linking video ${videoId} to collection ${collection.id}:`,
                  err
                );
                const errorMsg =
                  err instanceof Error ? err.message : String(err);
                results.errors.push(
                  `Link ${videoId}->${collection.id}: ${errorMsg}`
                );
              }
            }
          }
        } catch (error: any) {
          console.error(`Error migrating collection ${collection.id}:`, error);
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          results.errors.push(`Collection ${collection.id}: ${errorMsg}`);
        }
      }
    } catch (error: any) {
      const errorMsg =
        error instanceof FileError
          ? error.message
          : error instanceof Error
          ? error.message
          : String(error);
      results.errors.push(`Failed to read collections.json: ${errorMsg}`);
    }
  }

  // Migrate Settings
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (fs.existsSync(SETTINGS_DATA_PATH)) {
    results.settings.found = true;
    try {
      const settingsData = fs.readJSONSync(SETTINGS_DATA_PATH);
      console.log("Found settings.json to migrate.");

      for (const [key, value] of Object.entries(settingsData)) {
        await db
          .insert(settings)
          .values({
            key,
            value: JSON.stringify(value),
          })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: JSON.stringify(value) },
          })
          .run();
        results.settings.count++;
      }
    } catch (error: any) {
      console.error("Error migrating settings:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push(`Settings: ${errorMsg}`);
    }
  }

  // Migrate Status (Downloads)
  // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
  if (fs.existsSync(STATUS_DATA_PATH)) {
    results.downloads.found = true;
    try {
      const statusData = fs.readJSONSync(STATUS_DATA_PATH);
      console.log("Found status.json to migrate.");

      // Migrate active downloads
      if (
        statusData.activeDownloads &&
        Array.isArray(statusData.activeDownloads)
      ) {
        for (const download of statusData.activeDownloads) {
          await db
            .insert(downloads)
            .values({
              id: download.id,
              title: download.title,
              timestamp: download.timestamp,
              filename: download.filename,
              totalSize: download.totalSize,
              downloadedSize: download.downloadedSize,
              progress: download.progress,
              speed: download.speed,
              status: "active",
            })
            .onConflictDoUpdate({
              target: downloads.id,
              set: {
                title: download.title,
                timestamp: download.timestamp,
                filename: download.filename,
                totalSize: download.totalSize,
                downloadedSize: download.downloadedSize,
                progress: download.progress,
                speed: download.speed,
                status: "active",
              },
            })
            .run();
          results.downloads.count++;
        }
      }

      // Migrate queued downloads
      if (
        statusData.queuedDownloads &&
        Array.isArray(statusData.queuedDownloads)
      ) {
        for (const download of statusData.queuedDownloads) {
          await db
            .insert(downloads)
            .values({
              id: download.id,
              title: download.title,
              timestamp: download.timestamp,
              status: "queued",
            })
            .onConflictDoUpdate({
              target: downloads.id,
              set: {
                title: download.title,
                timestamp: download.timestamp,
                status: "queued",
              },
            })
            .run();
          results.downloads.count++;
        }
      }
    } catch (error: any) {
      console.error("Error migrating status:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push(`Status: ${errorMsg}`);
    }
  }

  console.log("Migration finished successfully.");
  return results;
}
