import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import * as storageService from "./storageService";

export const moveAllThumbnails = async (toVideoFolder: boolean) => {
    console.log(`Starting to move all thumbnails. Target: ${toVideoFolder ? 'Video Folders' : 'Central Images Folder'}`);
    const allVideos = storageService.getVideos();
    let movedCount = 0;
    let errorCount = 0;

    for (const video of allVideos) {
        if (!video.thumbnailFilename) continue;

        let videoChanged = false;

        // Determine where the video file is located
        let videoDir = VIDEOS_DIR;
        let relativeVideoDir = ""; // Relative to VIDEOS_DIR

        if (video.videoFilename) {
            // Logic similar to subtitleService to find the video directory
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

        try {
            // Determine current absolute path of the thumbnail
            let currentAbsPath = "";
            
            // Check based on current path property if available
            if (video.thumbnailPath) {
                if (video.thumbnailPath.startsWith("/videos/")) {
                    currentAbsPath = path.join(VIDEOS_DIR, video.thumbnailPath.replace(/^\/videos\//, ""));
                } else if (video.thumbnailPath.startsWith("/images/")) {
                    currentAbsPath = path.join(IMAGES_DIR, video.thumbnailPath.replace(/^\/images\//, ""));
                }
            }

            // Fallback search if path is invalid or file doesn't exist at path
            // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
            if (!currentAbsPath || !fs.existsSync(currentAbsPath)) {
                const centralPath = path.join(IMAGES_DIR, video.thumbnailFilename);
                // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
                if (fs.existsSync(centralPath)) {
                    currentAbsPath = centralPath;
                } else {
                    const localPath = path.join(videoDir, video.thumbnailFilename);
                    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
                    if (fs.existsSync(localPath)) {
                        currentAbsPath = localPath;
                    }
                }
            }

            // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
            if (!fs.existsSync(currentAbsPath)) {
                // console.warn(`Thumbnail file not found: ${video.thumbnailFilename}`);
                continue;
            }

            let targetAbsPath = "";
            let newWebPath = "";

            if (toVideoFolder) {
                // Move TO video folder
                targetAbsPath = path.join(videoDir, video.thumbnailFilename);
                if (relativeVideoDir) {
                    newWebPath = `/videos/${relativeVideoDir}/${video.thumbnailFilename}`;
                } else {
                    newWebPath = `/videos/${video.thumbnailFilename}`;
                }
            } else {
                // Move TO central images folder
                if (relativeVideoDir) {
                    const targetDir = path.join(IMAGES_DIR, relativeVideoDir);
                    fs.ensureDirSync(targetDir);
                    targetAbsPath = path.join(targetDir, video.thumbnailFilename);
                    newWebPath = `/images/${relativeVideoDir}/${video.thumbnailFilename}`;
                } else {
                    targetAbsPath = path.join(IMAGES_DIR, video.thumbnailFilename);
                    newWebPath = `/images/${video.thumbnailFilename}`;
                }
            }

            if (currentAbsPath !== targetAbsPath) {
                fs.moveSync(currentAbsPath, targetAbsPath, { overwrite: true });
                
                // Update video record
                storageService.updateVideo(video.id, {
                    thumbnailPath: newWebPath
                });
                
                movedCount++;
            } else {
                // Already in the right place, but ensure path is correct in DB
                if (video.thumbnailPath !== newWebPath) {
                    storageService.updateVideo(video.id, {
                        thumbnailPath: newWebPath
                    });
                }
            }

        } catch (err) {
            console.error(`Failed to move thumbnail ${video.thumbnailFilename}:`, err);
            errorCount++;
        }
    }

    console.log(`Finished moving thumbnails. Moved: ${movedCount}, Errors: ${errorCount}`);
    return { movedCount, errorCount };
};
