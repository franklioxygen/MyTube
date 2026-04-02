import path from "path";
import { IMAGES_DIR, VIDEOS_DIR } from "../config/paths";
import * as storageService from "./storageService";
import {
    ensureSmallThumbnailForThumbnailPath,
    moveSmallThumbnailMirrorSync,
    resolveManagedThumbnailWebPathFromAbsolutePath,
} from "./thumbnailMirrorService";
import {
    ensureDirSafeSync,
    moveSafeSync,
    pathExistsSafeSync,
    resolveSafeChildPath,
    sanitizePathSegment,
} from "../utils/security";

const SHARED_THUMBNAIL_ALLOWED_DIRS = [IMAGES_DIR, VIDEOS_DIR] as const;

const resolveManagedThumbnailAbsolutePath = (
    thumbnailPath: string | null | undefined,
) => {
    if (!thumbnailPath) {
        return null;
    }

    if (thumbnailPath.startsWith("/videos/")) {
        return resolveSafeChildPath(
            VIDEOS_DIR,
            thumbnailPath.replace(/^\/videos\//, ""),
        );
    }

    if (thumbnailPath.startsWith("/images/")) {
        return resolveSafeChildPath(
            IMAGES_DIR,
            thumbnailPath.replace(/^\/images\//, ""),
        );
    }

    return null;
};

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
                    videoDir = resolveSafeChildPath(VIDEOS_DIR, dirName);
                    relativeVideoDir = dirName;
                }
            } else {
                // Fallback: check collections
                const collections = storageService.getCollections();
                for (const col of collections) {
                    if (col.videos.includes(video.id)) {
                        const colName = col.name || col.title;
                        const safeCollectionName = sanitizePathSegment(colName || "");
                        if (safeCollectionName) {
                            videoDir = resolveSafeChildPath(VIDEOS_DIR, safeCollectionName);
                            relativeVideoDir = safeCollectionName;
                            break;
                        }
                    }
                }
            }
        }

        try {
            // Determine current absolute path of the thumbnail
            let currentAbsPath: string | null = null;
            let currentWebPath = video.thumbnailPath || null;
            const safeThumbnailFilename = path.basename(video.thumbnailFilename);
            
            // Check based on current path property if available
            currentAbsPath = resolveManagedThumbnailAbsolutePath(video.thumbnailPath);

            // Fallback search if path is invalid or file doesn't exist at path
            if (
                !currentAbsPath ||
                !pathExistsSafeSync(currentAbsPath, SHARED_THUMBNAIL_ALLOWED_DIRS)
            ) {
                const centralPath = resolveSafeChildPath(IMAGES_DIR, safeThumbnailFilename);
                if (pathExistsSafeSync(centralPath, IMAGES_DIR)) {
                    currentAbsPath = centralPath;
                    currentWebPath = resolveManagedThumbnailWebPathFromAbsolutePath(centralPath);
                } else {
                    const localPath = resolveSafeChildPath(videoDir, safeThumbnailFilename);
                    if (pathExistsSafeSync(localPath, videoDir)) {
                        currentAbsPath = localPath;
                        currentWebPath = resolveManagedThumbnailWebPathFromAbsolutePath(localPath);
                    }
                }
            }

            if (
                !currentAbsPath ||
                !pathExistsSafeSync(currentAbsPath, SHARED_THUMBNAIL_ALLOWED_DIRS)
            ) {
                // console.warn(`Thumbnail file not found: ${video.thumbnailFilename}`);
                continue;
            }

            let targetAbsPath = "";
            let newWebPath = "";

            if (toVideoFolder) {
                // Move TO video folder
                targetAbsPath = resolveSafeChildPath(videoDir, safeThumbnailFilename);
                if (relativeVideoDir) {
                    newWebPath = `/videos/${relativeVideoDir}/${safeThumbnailFilename}`;
                } else {
                    newWebPath = `/videos/${safeThumbnailFilename}`;
                }
            } else {
                // Move TO central images folder
                if (relativeVideoDir) {
                    const targetDir = resolveSafeChildPath(IMAGES_DIR, relativeVideoDir);
                    ensureDirSafeSync(targetDir, IMAGES_DIR);
                    targetAbsPath = resolveSafeChildPath(targetDir, safeThumbnailFilename);
                    newWebPath = `/images/${relativeVideoDir}/${safeThumbnailFilename}`;
                } else {
                    targetAbsPath = resolveSafeChildPath(IMAGES_DIR, safeThumbnailFilename);
                    newWebPath = `/images/${safeThumbnailFilename}`;
                }
            }

            if (currentAbsPath !== targetAbsPath) {
                moveSafeSync(
                    currentAbsPath,
                    SHARED_THUMBNAIL_ALLOWED_DIRS,
                    targetAbsPath,
                    SHARED_THUMBNAIL_ALLOWED_DIRS,
                    { overwrite: true },
                );
                moveSmallThumbnailMirrorSync(
                    currentWebPath,
                    newWebPath,
                );
                
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

            await ensureSmallThumbnailForThumbnailPath(newWebPath);

        } catch (err) {
            console.error(`Failed to move thumbnail ${video.thumbnailFilename}:`, err);
            errorCount++;
        }
    }

    console.log(`Finished moving thumbnails. Moved: ${movedCount}, Errors: ${errorCount}`);
    return { movedCount, errorCount };
};
