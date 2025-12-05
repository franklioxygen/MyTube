import { exec } from "child_process";
import { Request, Response } from "express";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import * as storageService from "../services/storageService";

// Recursive function to get all files in a directory
const getFilesRecursively = (dir: string): string[] => {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath));
    } else {
      results.push(filePath);
    }
  });
  
  return results;
};

export const scanFiles = async (_req: Request, res: Response): Promise<any> => {
  try {
    console.log("Starting file scan...");
    
    // 1. Get all existing videos from DB
    const existingVideos = storageService.getVideos();
    const existingPaths = new Set<string>();
    const existingFilenames = new Set<string>();
    
    // Track deleted videos
    let deletedCount = 0;
    const videosToDelete: string[] = [];

    // Check for missing files
    for (const v of existingVideos) {
      if (v.videoPath) existingPaths.add(v.videoPath);
      if (v.videoFilename) {
        existingFilenames.add(v.videoFilename);
      }
    }

    // 2. Recursively scan VIDEOS_DIR
    if (!fs.existsSync(VIDEOS_DIR)) {
      return res.status(200).json({ 
        success: true, 
        message: "Videos directory does not exist", 
        addedCount: 0,
        deletedCount: 0
      });
    }

    const allFiles = getFilesRecursively(VIDEOS_DIR);
    const videoExtensions = ['.mp4', '.mkv', '.webm', '.avi', '.mov'];
    const actualFilesOnDisk = new Set<string>(); // Stores filenames (basename)
    const actualFullPathsOnDisk = new Set<string>(); // Stores full absolute paths

    for (const filePath of allFiles) {
        const ext = path.extname(filePath).toLowerCase();
        if (videoExtensions.includes(ext)) {
            actualFilesOnDisk.add(path.basename(filePath));
            actualFullPathsOnDisk.add(filePath);
        }
    }

    // Now check for missing videos
    for (const v of existingVideos) {
        if (v.videoFilename) {
            // If the filename is not found in ANY of the scanned files, it is missing.
            if (!actualFilesOnDisk.has(v.videoFilename)) {
                console.log(`Video missing: ${v.title} (${v.videoFilename})`);
                videosToDelete.push(v.id);
            }
        } else {
            // No filename? That's a bad record.
            console.log(`Video record corrupted (no filename): ${v.title}`);
            videosToDelete.push(v.id);
        }
    }

    // Delete missing videos
    for (const id of videosToDelete) {
        if (storageService.deleteVideo(id)) {
            deletedCount++;
        }
    }
    console.log(`Deleted ${deletedCount} missing videos.`);


    let addedCount = 0;

    // 3. Process each file (Add new ones)
    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (!videoExtensions.includes(ext)) continue;

      const filename = path.basename(filePath);
      const relativePath = path.relative(VIDEOS_DIR, filePath);
      const webPath = `/videos/${relativePath.split(path.sep).join('/')}`;

      // Check if exists in DB
      if (existingFilenames.has(filename)) {
          continue;
      }
      
      console.log(`Found new video file: ${relativePath}`);

      const stats = fs.statSync(filePath);
      const createdDate = stats.birthtime;
      const videoId = (Date.now() + Math.floor(Math.random() * 10000)).toString();
      
      // Generate thumbnail
      const thumbnailFilename = `${path.parse(filename).name}.jpg`;
      const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);
      
      await new Promise<void>((resolve) => {
        exec(`ffmpeg -i "${filePath}" -ss 00:00:00 -vframes 1 "${thumbnailPath}"`, (error) => {
            if (error) {
                console.error("Error generating thumbnail:", error);
                resolve();
            } else {
                resolve();
            }
        });
      });

      // Get duration
      let duration = undefined;
      try {
        const durationOutput = await new Promise<string>((resolve, reject) => {
            exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (error, stdout, _stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
        if (durationOutput) {
            const durationSec = parseFloat(durationOutput);
            if (!isNaN(durationSec)) {
                duration = Math.round(durationSec).toString();
            }
        }
      } catch (err) {
        console.error("Error getting duration:", err);
      }

      const newVideo = {
        id: videoId,
        title: path.parse(filename).name,
        author: "Admin",
        source: "local",
        sourceUrl: "",
        videoFilename: filename,
        videoPath: webPath,
        thumbnailFilename: fs.existsSync(thumbnailPath) ? thumbnailFilename : undefined,
        thumbnailPath: fs.existsSync(thumbnailPath) ? `/images/${thumbnailFilename}` : undefined,
        thumbnailUrl: fs.existsSync(thumbnailPath) ? `/images/${thumbnailFilename}` : undefined,
        createdAt: createdDate.toISOString(),
        addedAt: new Date().toISOString(),
        date: createdDate.toISOString().split('T')[0].replace(/-/g, ''),
        duration: duration,
      };

      storageService.saveVideo(newVideo);
      addedCount++;

      // Check if video is in a subfolder
      const dirName = path.dirname(relativePath);
      if (dirName !== '.') {
        const collectionName = dirName.split(path.sep)[0];
        
        let collectionId: string | undefined;
        const allCollections = storageService.getCollections();
        const existingCollection = allCollections.find(c => (c.title === collectionName || c.name === collectionName));
        
        if (existingCollection) {
          collectionId = existingCollection.id;
        } else {
          collectionId = (Date.now() + Math.floor(Math.random() * 10000)).toString();
          const newCollection = {
            id: collectionId,
            title: collectionName,
            name: collectionName,
            videos: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          storageService.saveCollection(newCollection);
          console.log(`Created new collection from folder: ${collectionName}`);
        }

        if (collectionId) {
          storageService.addVideoToCollection(collectionId, newVideo.id);
          console.log(`Added video ${newVideo.title} to collection ${collectionName}`);
        }
      }
    }

    console.log(`Scan complete. Added ${addedCount} new videos. Deleted ${deletedCount} missing videos.`);

    res.status(200).json({
      success: true,
      message: `Scan complete. Added ${addedCount} new videos. Deleted ${deletedCount} missing videos.`,
      addedCount,
      deletedCount
    });

  } catch (error: any) {
    console.error("Error scanning files:", error);
    res.status(500).json({
      error: "Failed to scan files",
      details: error.message
    });
  }
};
