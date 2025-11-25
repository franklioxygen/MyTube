import fs from 'fs-extra';
import path from 'path';
import { COLLECTIONS_DATA_PATH, STATUS_DATA_PATH, VIDEOS_DATA_PATH } from '../config/paths';
import { db } from '../db';
import { collections, collectionVideos, downloads, settings, videos } from '../db/schema';

// Hardcoded path for settings since it might not be exported from paths.ts
const SETTINGS_DATA_PATH = path.join(path.dirname(VIDEOS_DATA_PATH), 'settings.json');

export async function runMigration() {
  console.log('Starting migration...');
  const results = {
    videos: 0,
    collections: 0,
    settings: 0,
    downloads: 0,
    errors: [] as string[]
  };

  // Migrate Videos
  if (fs.existsSync(VIDEOS_DATA_PATH)) {
    try {
      const videosData = fs.readJSONSync(VIDEOS_DATA_PATH);
      console.log(`Found ${videosData.length} videos to migrate.`);

      for (const video of videosData) {
        try {
          await db.insert(videos).values({
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
            createdAt: video.createdAt,
            updatedAt: video.updatedAt,
            partNumber: video.partNumber,
            totalParts: video.totalParts,
            seriesTitle: video.seriesTitle,
            rating: video.rating,
            description: video.description,
            viewCount: video.viewCount,
            duration: video.duration,
          }).onConflictDoNothing();
          results.videos++;
        } catch (error: any) {
          console.error(`Error migrating video ${video.id}:`, error);
          results.errors.push(`Video ${video.id}: ${error.message}`);
        }
      }
    } catch (error: any) {
        results.errors.push(`Failed to read videos.json: ${error.message}`);
    }
  }

  // Migrate Collections
  if (fs.existsSync(COLLECTIONS_DATA_PATH)) {
    try {
      const collectionsData = fs.readJSONSync(COLLECTIONS_DATA_PATH);
      console.log(`Found ${collectionsData.length} collections to migrate.`);

      for (const collection of collectionsData) {
        try {
          // Insert Collection
          await db.insert(collections).values({
            id: collection.id,
            name: collection.name || collection.title || 'Untitled Collection',
            title: collection.title,
            createdAt: collection.createdAt || new Date().toISOString(),
            updatedAt: collection.updatedAt,
          }).onConflictDoNothing();
          results.collections++;

          // Insert Collection Videos
          if (collection.videos && collection.videos.length > 0) {
            for (const videoId of collection.videos) {
              try {
                  await db.insert(collectionVideos).values({
                      collectionId: collection.id,
                      videoId: videoId,
                  }).onConflictDoNothing();
              } catch (err: any) {
                  console.error(`Error linking video ${videoId} to collection ${collection.id}:`, err);
                  results.errors.push(`Link ${videoId}->${collection.id}: ${err.message}`);
              }
            }
          }
        } catch (error: any) {
          console.error(`Error migrating collection ${collection.id}:`, error);
          results.errors.push(`Collection ${collection.id}: ${error.message}`);
        }
      }
    } catch (error: any) {
        results.errors.push(`Failed to read collections.json: ${error.message}`);
    }
  }

  // Migrate Settings
  if (fs.existsSync(SETTINGS_DATA_PATH)) {
    try {
      const settingsData = fs.readJSONSync(SETTINGS_DATA_PATH);
      console.log('Found settings.json to migrate.');
      
      for (const [key, value] of Object.entries(settingsData)) {
        await db.insert(settings).values({
          key,
          value: JSON.stringify(value),
        }).onConflictDoUpdate({
          target: settings.key,
          set: { value: JSON.stringify(value) },
        });
        results.settings++;
      }
    } catch (error: any) {
      console.error('Error migrating settings:', error);
      results.errors.push(`Settings: ${error.message}`);
    }
  }

  // Migrate Status (Downloads)
  if (fs.existsSync(STATUS_DATA_PATH)) {
    try {
      const statusData = fs.readJSONSync(STATUS_DATA_PATH);
      console.log('Found status.json to migrate.');

      // Migrate active downloads
      if (statusData.activeDownloads && Array.isArray(statusData.activeDownloads)) {
        for (const download of statusData.activeDownloads) {
          await db.insert(downloads).values({
            id: download.id,
            title: download.title,
            timestamp: download.timestamp,
            filename: download.filename,
            totalSize: download.totalSize,
            downloadedSize: download.downloadedSize,
            progress: download.progress,
            speed: download.speed,
            status: 'active',
          }).onConflictDoUpdate({
            target: downloads.id,
            set: {
              title: download.title,
              timestamp: download.timestamp,
              filename: download.filename,
              totalSize: download.totalSize,
              downloadedSize: download.downloadedSize,
              progress: download.progress,
              speed: download.speed,
              status: 'active',
            }
          });
          results.downloads++;
        }
      }

      // Migrate queued downloads
      if (statusData.queuedDownloads && Array.isArray(statusData.queuedDownloads)) {
        for (const download of statusData.queuedDownloads) {
          await db.insert(downloads).values({
            id: download.id,
            title: download.title,
            timestamp: download.timestamp,
            status: 'queued',
          }).onConflictDoUpdate({
            target: downloads.id,
            set: {
              title: download.title,
              timestamp: download.timestamp,
              status: 'queued',
            }
          });
          results.downloads++;
        }
      }
    } catch (error: any) {
      console.error('Error migrating status:', error);
      results.errors.push(`Status: ${error.message}`);
    }
  }

  console.log('Migration finished successfully.');
  return results;
}
