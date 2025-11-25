import fs from 'fs-extra';
import path from 'path';
import { COLLECTIONS_DATA_PATH, STATUS_DATA_PATH, VIDEOS_DATA_PATH } from '../src/config/paths';
import { db } from '../src/db';
import { collections, collectionVideos, downloads, settings, videos } from '../src/db/schema';

// Hardcoded path for settings since it might not be exported from paths.ts
const SETTINGS_DATA_PATH = path.join(path.dirname(VIDEOS_DATA_PATH), 'settings.json');

async function migrate() {
  console.log('Starting migration...');

  // Migrate Videos
  if (fs.existsSync(VIDEOS_DATA_PATH)) {
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
      } catch (error) {
        console.error(`Error migrating video ${video.id}:`, error);
      }
    }
    console.log('Videos migration completed.');
  } else {
    console.log('No videos.json found.');
  }

  // Migrate Collections
  if (fs.existsSync(COLLECTIONS_DATA_PATH)) {
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

        // Insert Collection Videos
        if (collection.videos && collection.videos.length > 0) {
          for (const videoId of collection.videos) {
            try {
                await db.insert(collectionVideos).values({
                    collectionId: collection.id,
                    videoId: videoId,
                }).onConflictDoNothing();
            } catch (err) {
                console.error(`Error linking video ${videoId} to collection ${collection.id}:`, err);
            }
          }
        }
      } catch (error) {
        console.error(`Error migrating collection ${collection.id}:`, error);
      }
    }
    console.log('Collections migration completed.');
  } else {
    console.log('No collections.json found.');
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
      }
      console.log('Settings migration completed.');
    } catch (error) {
      console.error('Error migrating settings:', error);
    }
  } else {
    console.log('No settings.json found.');
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
        }
      }
      console.log('Status migration completed.');
    } catch (error) {
      console.error('Error migrating status:', error);
    }
  } else {
    console.log('No status.json found.');
  }

  console.log('Migration finished successfully.');
}

migrate().catch(console.error);
