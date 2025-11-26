import { desc, eq, lt } from "drizzle-orm";
import fs from "fs-extra";
import path from "path";
import {
    DATA_DIR,
    IMAGES_DIR,
    STATUS_DATA_PATH,
    UPLOADS_DIR,
    VIDEOS_DIR,
} from "../config/paths";
import { db, sqlite } from "../db";
import { collections, collectionVideos, downloads, settings, videos } from "../db/schema";

export interface Video {
  id: string;
  title: string;
  sourceUrl: string;
  videoFilename?: string;
  thumbnailFilename?: string;
  createdAt: string;
  tags?: string[];
  viewCount?: number;
  progress?: number;
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

  // Check and migrate tags column if needed
  try {
    const tableInfo = sqlite.prepare("PRAGMA table_info(videos)").all();
    const hasTags = (tableInfo as any[]).some((col: any) => col.name === 'tags');
    
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
    
    if (!columns.includes('view_count')) {
      console.log("Migrating database: Adding view_count column to videos table...");
      sqlite.prepare("ALTER TABLE videos ADD COLUMN view_count INTEGER DEFAULT 0").run();
      console.log("Migration successful: view_count added.");
    }

    if (!columns.includes('progress')) {
      console.log("Migrating database: Adding progress column to videos table...");
      sqlite.prepare("ALTER TABLE videos ADD COLUMN progress INTEGER DEFAULT 0").run();
      console.log("Migration successful: progress added.");
    }

    if (!columns.includes('duration')) {
      console.log("Migrating database: Adding duration column to videos table...");
      sqlite.prepare("ALTER TABLE videos ADD COLUMN duration TEXT").run();
      console.log("Migration successful: duration added.");
    }
  } catch (error) {
    console.error("Error checking/migrating viewCount/progress/duration columns:", error);
  }
}


// --- Download Status ---

export function addActiveDownload(id: string, title: string): void {
  try {
    const now = Date.now();
    db.insert(downloads).values({
      id,
      title,
      timestamp: now,
      status: 'active',
    }).onConflictDoUpdate({
      target: downloads.id,
      set: {
        title,
        timestamp: now,
        status: 'active',
      }
    }).run();
    console.log(`Added/Updated active download: ${title} (${id})`);
  } catch (error) {
    console.error("Error adding active download:", error);
  }
}

export function updateActiveDownload(id: string, updates: Partial<DownloadInfo>): void {
  try {
    const updateData: any = { ...updates, timestamp: Date.now() };
    
    // Map fields to DB columns if necessary (though they match mostly)
    if (updates.totalSize) updateData.totalSize = updates.totalSize;
    if (updates.downloadedSize) updateData.downloadedSize = updates.downloadedSize;
    
    db.update(downloads)
      .set(updateData)
      .where(eq(downloads.id, id))
      .run();
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
      db.delete(downloads).where(eq(downloads.status, 'queued')).run();

      // Then insert new ones
      for (const download of queuedDownloads) {
        db.insert(downloads).values({
          id: download.id,
          title: download.title,
          timestamp: download.timestamp,
          status: 'queued',
        }).onConflictDoUpdate({
            target: downloads.id,
            set: {
                title: download.title,
                timestamp: download.timestamp,
                status: 'queued'
            }
        }).run();
      }
    });
  } catch (error) {
    console.error("Error setting queued downloads:", error);
  }
}

export function getDownloadStatus(): DownloadStatus {
  try {
    // Clean up stale downloads (older than 30 mins)
    const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
    db.delete(downloads)
      .where(lt(downloads.timestamp, thirtyMinsAgo))
      .run();

    const allDownloads = db.select().from(downloads).all();
    
    const activeDownloads = allDownloads
      .filter(d => d.status === 'active')
      .map(d => ({
        id: d.id,
        title: d.title,
        timestamp: d.timestamp || 0,
        filename: d.filename || undefined,
        totalSize: d.totalSize || undefined,
        downloadedSize: d.downloadedSize || undefined,
        progress: d.progress || undefined,
        speed: d.speed || undefined,
      }));

    const queuedDownloads = allDownloads
      .filter(d => d.status === 'queued')
      .map(d => ({
        id: d.id,
        title: d.title,
        timestamp: d.timestamp || 0,
      }));

    return { activeDownloads, queuedDownloads };
  } catch (error) {
    console.error("Error reading download status:", error);
    return { activeDownloads: [], queuedDownloads: [] };
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
        db.insert(settings).values({
          key,
          value: JSON.stringify(value),
        }).onConflictDoUpdate({
          target: settings.key,
          set: { value: JSON.stringify(value) },
        }).run();
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
    const allVideos = db.select().from(videos).orderBy(desc(videos.createdAt)).all();
    return allVideos.map(v => ({
      ...v,
      tags: v.tags ? JSON.parse(v.tags) : [],
    })) as Video[];
  } catch (error) {
    console.error("Error getting videos:", error);
    return [];
  }
}

export function getVideoById(id: string): Video | undefined {
  try {
    const video = db.select().from(videos).where(eq(videos.id, id)).get();
    if (video) {
      return {
        ...video,
        tags: video.tags ? JSON.parse(video.tags) : [],
      } as Video;
    }
    return undefined;
  } catch (error) {
    console.error("Error getting video by id:", error);
    return undefined;
  }
}

export function saveVideo(videoData: Video): Video {
  try {
    const videoToSave = {
      ...videoData,
      tags: videoData.tags ? JSON.stringify(videoData.tags) : undefined,
    };
    db.insert(videos).values(videoToSave as any).onConflictDoUpdate({
      target: videos.id,
      set: videoToSave,
    }).run();
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
      tags: updates.tags ? JSON.stringify(updates.tags) : undefined,
    };
    // If tags is explicitly empty array, we might want to save it as '[]' or null. 
    // JSON.stringify([]) is '[]', which is fine.
    
    const result = db.update(videos).set(updatesToSave as any).where(eq(videos.id, id)).returning().get();
    
    if (result) {
        return {
            ...result,
            tags: result.tags ? JSON.parse(result.tags) : [],
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

    // Remove files
    if (videoToDelete.videoFilename) {
      const actualPath = findVideoFile(videoToDelete.videoFilename);
      if (actualPath && fs.existsSync(actualPath)) {
        fs.unlinkSync(actualPath);
      }
    }

    if (videoToDelete.thumbnailFilename) {
      const actualPath = findImageFile(videoToDelete.thumbnailFilename);
      if (actualPath && fs.existsSync(actualPath)) {
        fs.unlinkSync(actualPath);
      }
    }

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
    const rows = db.select({
      c: collections,
      cv: collectionVideos,
    })
    .from(collections)
    .leftJoin(collectionVideos, eq(collections.id, collectionVideos.collectionId))
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
    const rows = db.select({
      c: collections,
      cv: collectionVideos,
    })
    .from(collections)
    .leftJoin(collectionVideos, eq(collections.id, collectionVideos.collectionId))
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
      db.insert(collections).values({
        id: collection.id,
        name: collection.name || collection.title,
        title: collection.title,
        createdAt: collection.createdAt || new Date().toISOString(),
        updatedAt: collection.updatedAt,
      }).onConflictDoUpdate({
        target: collections.id,
        set: {
          name: collection.name || collection.title,
          title: collection.title,
          updatedAt: new Date().toISOString(),
        }
      }).run();

      // Sync videos
      // First delete existing links
      db.delete(collectionVideos).where(eq(collectionVideos.collectionId, collection.id)).run();
      
      // Then insert new links
      if (collection.videos && collection.videos.length > 0) {
        for (const videoId of collection.videos) {
             // Check if video exists to avoid FK error
             const videoExists = db.select({ id: videos.id }).from(videos).where(eq(videos.id, videoId)).get();
             if (videoExists) {
                 db.insert(collectionVideos).values({
                    collectionId: collection.id,
                    videoId: videoId,
                 }).run();
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
    console.error(`Error moving file from ${sourcePath} to ${destPath}:`, error);
  }
}

// --- Complex Operations ---

export function addVideoToCollection(collectionId: string, videoId: string): Collection | null {
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
        const targetVideoPath = path.join(VIDEOS_DIR, collectionName, video.videoFilename);
        
        if (currentVideoPath && currentVideoPath !== targetVideoPath) {
          moveFile(currentVideoPath, targetVideoPath);
          updates.videoPath = `/videos/${collectionName}/${video.videoFilename}`;
          updated = true;
        }
      }

      if (video.thumbnailFilename) {
        const currentImagePath = findImageFile(video.thumbnailFilename);
        const targetImagePath = path.join(IMAGES_DIR, collectionName, video.thumbnailFilename);

        if (currentImagePath && currentImagePath !== targetImagePath) {
          moveFile(currentImagePath, targetImagePath);
          updates.thumbnailPath = `/images/${collectionName}/${video.thumbnailFilename}`;
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

export function removeVideoFromCollection(collectionId: string, videoId: string): Collection | null {
  const collection = atomicUpdateCollection(collectionId, (c) => {
    c.videos = c.videos.filter((v) => v !== videoId);
    return c;
  });

  if (collection) {
    const video = getVideoById(videoId);
    
    if (video) {
      // Check if video is in any other collection
      const allCollections = getCollections();
      const otherCollection = allCollections.find(c => c.videos.includes(videoId) && c.id !== collectionId);
      
      let targetVideoDir = VIDEOS_DIR;
      let targetImageDir = IMAGES_DIR;
      let videoPathPrefix = '/videos';
      let imagePathPrefix = '/images';

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
        const currentImagePath = findImageFile(video.thumbnailFilename);
        const targetImagePath = path.join(targetImageDir, video.thumbnailFilename);

        if (currentImagePath && currentImagePath !== targetImagePath) {
          moveFile(currentImagePath, targetImagePath);
          updates.thumbnailPath = `${imagePathPrefix}/${video.thumbnailFilename}`;
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
    collection.videos.forEach(videoId => {
      const video = getVideoById(videoId);
      if (video) {
        const allCollections = getCollections();
        const otherCollection = allCollections.find(c => c.videos.includes(videoId) && c.id !== collectionId);

        let targetVideoDir = VIDEOS_DIR;
        let targetImageDir = IMAGES_DIR;
        let videoPathPrefix = '/videos';
        let imagePathPrefix = '/images';

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
          const currentImagePath = findImageFile(video.thumbnailFilename);
          const targetImagePath = path.join(targetImageDir, video.thumbnailFilename);

          if (currentImagePath && currentImagePath !== targetImagePath) {
            moveFile(currentImagePath, targetImagePath);
            updates.thumbnailPath = `${imagePathPrefix}/${video.thumbnailFilename}`;
            updated = true;
          }
        }

        if (updated) {
          updateVideo(videoId, updates);
        }
      }
    });
  }

  const success = deleteCollection(collectionId);

  if (success && collectionName) {
    try {
      const videoCollectionDir = path.join(VIDEOS_DIR, collectionName);
      const imageCollectionDir = path.join(IMAGES_DIR, collectionName);

      if (fs.existsSync(videoCollectionDir) && fs.readdirSync(videoCollectionDir).length === 0) {
        fs.rmdirSync(videoCollectionDir);
      }
      if (fs.existsSync(imageCollectionDir) && fs.readdirSync(imageCollectionDir).length === 0) {
        fs.rmdirSync(imageCollectionDir);
      }
    } catch (error) {
      console.error("Error removing collection directories:", error);
    }
  }

  return success;
}

export function deleteCollectionAndVideos(collectionId: string): boolean {
  const collection = getCollectionById(collectionId);
  if (!collection) return false;

  const collectionName = collection.name || collection.title;

  if (collection.videos && collection.videos.length > 0) {
    const videosToDelete = [...collection.videos];
    videosToDelete.forEach(videoId => {
      deleteVideo(videoId);
    });
  }

  const success = deleteCollection(collectionId);

  if (success && collectionName) {
    try {
      const videoCollectionDir = path.join(VIDEOS_DIR, collectionName);
      const imageCollectionDir = path.join(IMAGES_DIR, collectionName);

      if (fs.existsSync(videoCollectionDir)) {
        fs.rmdirSync(videoCollectionDir);
      }
      if (fs.existsSync(imageCollectionDir)) {
        fs.rmdirSync(imageCollectionDir);
      }
    } catch (error) {
      console.error("Error removing collection directories:", error);
    }
  }

  return success;
}

