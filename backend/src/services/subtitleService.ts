import fs from "fs-extra";
import path from "path";
import { FileError } from "../errors/DownloadErrors";
import { SUBTITLES_DIR, VIDEOS_DIR } from "../config/paths";
import * as storageService from "./storageService";

export const moveAllSubtitles = async (toVideoFolder: boolean) => {
    console.log(`Starting to move all subtitles. Target: ${toVideoFolder ? 'Video Folders' : 'Central Subtitles Folder'}`);
    const allVideos = storageService.getVideos();
    let movedCount = 0;
    let errorCount = 0;

    for (const video of allVideos) {
        if (!video.subtitles || video.subtitles.length === 0) continue;

        const newSubtitles = [];
        let videoChanged = false;

        // Determine where the video file is located
        let videoDir = VIDEOS_DIR;
        let relativeVideoDir = ""; // Relative to VIDEOS_DIR

        if (video.videoFilename) {
            // We need to find the actual location of the video file to know its folder
            // storageService.findVideoFile is private, but we can replicate the logic or use the path stored in DB if reliable.
            // However, video.videoPath usually starts with /videos/...
            // Let's rely on finding the file to be sure.
            
            // Heuristic: check if it's in a collection folder
            // We can iterate collections, or check the file system.
            // Let's look at the videoPath property if available, it usually reflects the web path
            // e.g. /videos/MyCollection/video.mp4 or /videos/video.mp4
            if (video.videoPath) {
                const cleanPath = video.videoPath.replace(/^\/videos\//, '');
                const dirName = path.dirname(cleanPath);
                if (dirName && dirName !== '.') {
                    videoDir = path.join(VIDEOS_DIR, dirName);
                    relativeVideoDir = dirName;
                }
            } else {
                // Fallback: check collections
                const collections = storageService.getCollections();
                for (const col of collections) {
                    if (col.videos.includes(video.id)) {
                        const colName = col.name || col.title;
                        if (colName) {
                            videoDir = path.join(VIDEOS_DIR, colName);
                            relativeVideoDir = colName;
                            break;
                        }
                    }
                }
            }
        }

        for (const sub of video.subtitles) {
            try {
                // Determine current absolute path
                // sub.path is like /subtitles/filename.vtt (if central) or /videos/Folder/filename.vtt (if local)
                // BUT we should rely on where the file ACTUALLY is right now.
                // We can try to resolve it based on the stored path.
                
                let currentAbsPath = "";
                if (sub.path.startsWith("/videos/")) {
                    currentAbsPath = path.join(VIDEOS_DIR, sub.path.replace(/^\/videos\//, ""));
                } else if (sub.path.startsWith("/subtitles/")) {
                    currentAbsPath = path.join(SUBTITLES_DIR, sub.path.replace(/^\/subtitles\//, ""));
                } else {
                    // Fallback to filename search in both locations
                    const centralPath = path.join(SUBTITLES_DIR, sub.filename);
                    if (fs.existsSync(centralPath)) {
                        currentAbsPath = centralPath;
                    } else {
                        const localPath = path.join(videoDir, sub.filename);
                        if (fs.existsSync(localPath)) {
                            currentAbsPath = localPath;
                        }
                    }
                }

                if (!fs.existsSync(currentAbsPath)) {
                    console.warn(`Subtitle file not found: ${sub.path} or ${currentAbsPath}`);
                    newSubtitles.push(sub); // Keep the record even if file missing? Or maybe better to keep it to avoid data loss.
                    continue;
                }

                let targetAbsPath = "";
                let newWebPath = "";

                if (toVideoFolder) {
                    // Move TO video folder
                    targetAbsPath = path.join(videoDir, sub.filename);
                    if (relativeVideoDir) {
                        newWebPath = `/videos/${relativeVideoDir}/${sub.filename}`;
                    } else {
                        newWebPath = `/videos/${sub.filename}`;
                    }
                } else {
                    // Move TO central subtitles folder
                    // Mirror the folder structure
                    if (relativeVideoDir) {
                        const targetDir = path.join(SUBTITLES_DIR, relativeVideoDir);
                        fs.ensureDirSync(targetDir);
                        targetAbsPath = path.join(targetDir, sub.filename);
                        newWebPath = `/subtitles/${relativeVideoDir}/${sub.filename}`;
                    } else {
                        targetAbsPath = path.join(SUBTITLES_DIR, sub.filename);
                        newWebPath = `/subtitles/${sub.filename}`;
                    }
                }

                if (currentAbsPath !== targetAbsPath) {
                    fs.moveSync(currentAbsPath, targetAbsPath, { overwrite: true });
                    newSubtitles.push({
                        ...sub,
                        path: newWebPath
                    });
                    videoChanged = true;
                    movedCount++;
                } else {
                    // Already in the right place, but ensure path is correct
                    if (sub.path !== newWebPath) {
                        newSubtitles.push({
                            ...sub,
                            path: newWebPath
                        });
                        videoChanged = true;
                    } else {
                        newSubtitles.push(sub);
                    }
                }

            } catch (err) {
                console.error(`Failed to move subtitle ${sub.filename}:`, err);
                // If it's a FileError, log it but continue
                if (err instanceof FileError) {
                    console.error(`File error: ${err.message}`, err.filePath);
                }
                newSubtitles.push(sub); // Keep original on error
                errorCount++;
            }
        }

        if (videoChanged) {
            storageService.updateVideo(video.id, { subtitles: newSubtitles });
        }
    }

    console.log(`Finished moving subtitles. Moved: ${movedCount}, Errors: ${errorCount}`);
    return { movedCount, errorCount };
};
