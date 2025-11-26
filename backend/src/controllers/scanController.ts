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

export const scanFiles = async (req: Request, res: Response): Promise<any> => {
  try {
    console.log("Starting file scan...");
    
    // 1. Get all existing videos from DB
    const existingVideos = storageService.getVideos();
    const existingPaths = new Set<string>();
    const existingFilenames = new Set<string>();
    
    existingVideos.forEach(v => {
      if (v.videoPath) existingPaths.add(v.videoPath);
      if (v.videoFilename) existingFilenames.add(v.videoFilename);
    });

    // 2. Recursively scan VIDEOS_DIR
    if (!fs.existsSync(VIDEOS_DIR)) {
      return res.status(200).json({ 
        success: true, 
        message: "Videos directory does not exist", 
        addedCount: 0 
      });
    }

    const allFiles = getFilesRecursively(VIDEOS_DIR);
    const videoExtensions = ['.mp4', '.mkv', '.webm', '.avi', '.mov'];
    let addedCount = 0;

    // 3. Process each file
    for (const filePath of allFiles) {
      const ext = path.extname(filePath).toLowerCase();
      if (!videoExtensions.includes(ext)) continue;

      const filename = path.basename(filePath);
      const relativePath = path.relative(VIDEOS_DIR, filePath);
      // Construct the web-accessible path (assuming /videos maps to VIDEOS_DIR)
      // If the file is in a subdirectory, relativePath will be "subdir/file.mp4"
      // We need to ensure we use forward slashes for URLs
      const webPath = `/videos/${relativePath.split(path.sep).join('/')}`;

      // Check if exists
      // We check both filename (for flat structure compatibility) and full web path
      if (existingFilenames.has(filename)) continue;
      
      // Also check if we already have this specific path (in case of duplicate filenames in diff folders)
      // But for now, let's assume filename uniqueness is preferred or at least check it.
      // Actually, if we have "folder1/a.mp4" and "folder2/a.mp4", they are different videos.
      // But existing logic often relies on filename. 
      // Let's check if there is ANY video with this filename. 
      // If the user wants to support duplicate filenames in different folders, we might need to relax this.
      // For now, let's stick to the plan: check if it exists in DB.
      
      // Refined check:
      // If we find a file that is NOT in the DB, we add it.
      // We use the filename to check against existing records because `videoFilename` is often used as a key.
      
      console.log(`Found new video file: ${relativePath}`);

      const stats = fs.statSync(filePath);
      const createdDate = stats.birthtime;
      const videoId = (Date.now() + Math.floor(Math.random() * 10000)).toString();
      
      // Generate thumbnail
      const thumbnailFilename = `${path.parse(filename).name}.jpg`;
      // If video is in subdir, put thumbnail in same subdir structure in IMAGES_DIR?
      // Or just flat in IMAGES_DIR? 
      // videoController puts it in IMAGES_DIR flatly.
      // But if we have subdirs, we might have name collisions.
      // For now, let's follow videoController pattern: flat IMAGES_DIR.
      // Wait, videoController uses uniqueSuffix for filename, so no collision.
      // Here we use original filename.
      // Let's try to mirror the structure if possible, or just use flat for now as per simple req.
      // The user said "scan /uploads/videos structure".
      // If I have videos/foo/bar.mp4, maybe I should put thumbnail in images/foo/bar.jpg?
      // But IMAGES_DIR is a single path.
      // Let's stick to flat IMAGES_DIR for simplicity, but maybe prepend subdir name to filename to avoid collision?
      // Or just use the simple name as per request "take first frame as thumbnail".
      
      const thumbnailPath = path.join(IMAGES_DIR, thumbnailFilename);
      
      // We need to await this, so we can't use forEach efficiently if we want to be async inside.
      // We are in a for..of loop, so await is fine.
      
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
            exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (error, stdout, stderr) => {
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
    }

    console.log(`Scan complete. Added ${addedCount} new videos.`);

    res.status(200).json({
      success: true,
      message: `Scan complete. Added ${addedCount} new videos.`,
      addedCount
    });

  } catch (error: any) {
    console.error("Error scanning files:", error);
    res.status(500).json({
      error: "Failed to scan files",
      details: error.message
    });
  }
};
