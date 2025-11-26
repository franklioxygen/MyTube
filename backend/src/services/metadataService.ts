import { exec } from 'child_process';
import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import { VIDEOS_DIR } from '../config/paths';
import { db } from '../db';
import { videos } from '../db/schema';

export const backfillDurations = async () => {
  console.log('Starting duration backfill...');
  
  try {
    const allVideos = await db.select().from(videos).all();
    console.log(`Found ${allVideos.length} videos to check for duration.`);

    let updatedCount = 0;

    for (const video of allVideos) {
      if (video.duration) {
          continue; 
      }

      let videoPath = video.videoPath;
      if (!videoPath) continue;

      let fsPath = '';
      if (videoPath.startsWith('/videos/')) {
          const relativePath = videoPath.replace('/videos/', '');
          fsPath = path.join(VIDEOS_DIR, relativePath);
      } else {
          continue;
      }

      if (!fs.existsSync(fsPath)) {
          // console.warn(`File not found: ${fsPath}`); // Reduce noise
          continue;
      }

      try {
          const duration = await new Promise<string>((resolve, reject) => {
              exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fsPath}"`, (error, stdout, stderr) => {
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

    if (updatedCount > 0) {
        console.log(`Duration backfill finished. Updated ${updatedCount} videos.`);
    } else {
        console.log('Duration backfill finished. No videos needed update.');
    }
  } catch (error) {
    console.error("Error during duration backfill:", error);
  }
};
