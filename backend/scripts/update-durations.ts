import { exec } from 'child_process';
import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import { VIDEOS_DIR } from '../src/config/paths';
import { db } from '../src/db';
import { videos } from '../src/db/schema';

async function updateDurations() {
  console.log('Starting duration update...');
  
  // Get all videos with missing duration
  // Note: We can't easily filter by isNull(videos.duration) if the column was just added and defaults to null, 
  // but let's try to get all videos and check in JS if needed, or just update all.
  // Updating all is safer to ensure correctness.
  
  const allVideos = await db.select().from(videos).all();
  console.log(`Found ${allVideos.length} videos.`);

  let updatedCount = 0;

  for (const video of allVideos) {
    if (video.duration) {
        // Skip if already has duration (optional: remove this check to force update)
        continue; 
    }

    let videoPath = video.videoPath;
    if (!videoPath) continue;

    // Resolve absolute path
    // videoPath in DB is web path like "/videos/subdir/file.mp4"
    // We need filesystem path.
    // Assuming /videos maps to VIDEOS_DIR
    
    let fsPath = '';
    if (videoPath.startsWith('/videos/')) {
        const relativePath = videoPath.replace('/videos/', '');
        fsPath = path.join(VIDEOS_DIR, relativePath);
    } else {
        // Fallback or other path structure
        continue;
    }

    if (!fs.existsSync(fsPath)) {
        console.warn(`File not found: ${fsPath}`);
        continue;
    }

    try {
        const duration = await new Promise<string>((resolve, reject) => {
            exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fsPath}"`, (error, stdout, _stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            });
        });

        if (duration) {
            const durationSec = parseFloat(duration);
            if (!isNaN(durationSec)) {
                await db.update(videos)
                    .set({ duration: Math.round(durationSec).toString() })
                    .where(eq(videos.id, video.id));
                console.log(`Updated duration for ${video.title}: ${Math.round(durationSec)}s`);
                updatedCount++;
            }
        }
    } catch (error) {
        console.error(`Error getting duration for ${video.title}:`, error);
    }
  }

  console.log(`Finished. Updated ${updatedCount} videos.`);
}

updateDurations().catch(console.error);
