
import fs from "fs-extra";
import { SUBTITLES_DIR } from "../config/paths";
import { BilibiliDownloader } from "../services/downloaders/BilibiliDownloader";
import * as storageService from "../services/storageService";
import { sanitizeFilename } from "../utils/helpers";

/**
 * Scan subtitle directory and update video records with subtitle metadata
 */
async function rescanSubtitles() {
    console.log("Starting subtitle rescan...");
    
    try {
        // Get all videos
        const videos = storageService.getVideos();
        console.log(`Found ${videos.length} videos to check`);
        
        // Get all subtitle files
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        if (!fs.existsSync(SUBTITLES_DIR)) {
            console.log("Subtitles directory doesn't exist");
            return;
        }
        
        // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
        const subtitleFiles = fs.readdirSync(SUBTITLES_DIR).filter((file) => file.endsWith(".vtt"));
        console.log(`Found ${subtitleFiles.length} subtitle files`);
        
        let updatedCount = 0;
        
        for (const video of videos) {
            // Skip if video already has subtitles
            if (video.subtitles && video.subtitles.length > 0) {
                continue;
            }
            
            // If it's a Bilibili video, try to download subtitles
            if (video.source === 'bilibili' && video.sourceUrl) {
                console.log(`Attempting to download subtitles for Bilibili video: ${video.title}`);
                try {
                    // We need to reconstruct the base filename used during download
                    // Usually it's sanitizeFilename(title)_timestamp
                    // But we can just use the video ID (timestamp) as the base for subtitles
                    // to match the pattern expected by the system
                    const timestamp = video.id;
                    const safeBaseFilename = `${sanitizeFilename(video.title)}_${timestamp}`;
                    
                    const downloadedSubtitles = await BilibiliDownloader.downloadSubtitles(video.sourceUrl, safeBaseFilename);
                    
                    if (downloadedSubtitles.length > 0) {
                        storageService.updateVideo(video.id, { subtitles: downloadedSubtitles });
                        console.log(`Downloaded and linked ${downloadedSubtitles.length} subtitles for ${video.title}`);
                        updatedCount++;
                        continue; // Skip the local file check since we just downloaded them
                    }
                } catch (e) {
                    console.error(`Failed to download subtitles for ${video.title}:`, e);
                }
            }
            
            // Look for existing subtitle files matching this video (fallback)
            const videoTimestamp = video.id;
            const matchingSubtitles = subtitleFiles.filter((file) => file.includes(videoTimestamp));
            
            if (matchingSubtitles.length > 0) {
                console.log(`Found ${matchingSubtitles.length} subtitles for video: ${video.title}`);
                
                const subtitles = matchingSubtitles.map((filename) => {
                    // Parse language from filename (e.g., video_123.en.vtt -> en)
                    const match = filename.match(/\.([a-z]{2}(?:-[A-Z]{2})?)\.vtt$/);
                    const language = match ? match[1] : "unknown";
                    
                    return {
                        language,
                        filename,
                        path: `/subtitles/${filename}`,
                    };
                });
                
                // Update video record
                storageService.updateVideo(video.id, { subtitles });
                console.log(`Updated video ${video.id} with ${subtitles.length} subtitles`);
                updatedCount++;
            }
        }
        
        console.log(`Subtitle rescan complete. Updated ${updatedCount} videos.`);
    } catch (error) {
        console.error("Error during subtitle rescan:", error);
    }
}

// Run the script
rescanSubtitles().then(() => {
    console.log("Done");
    process.exit(0);
}).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
