import fs from "fs-extra";
import { SUBTITLES_DIR } from "../config/paths";
import * as storageService from "../services/storageService";

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
        if (!fs.existsSync(SUBTITLES_DIR)) {
            console.log("Subtitles directory doesn't exist");
            return;
        }
        
        const subtitleFiles = fs.readdirSync(SUBTITLES_DIR).filter((file) => file.endsWith(".vtt"));
        console.log(`Found ${subtitleFiles.length} subtitle files`);
        
        let updatedCount = 0;
        
        for (const video of videos) {
            // Skip if video already has subtitles
            if (video.subtitles && video.subtitles.length > 0) {
                continue;
            }
            
            // Look for subtitle files matching this video
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
