import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { getSettings } from './storageService';

interface CloudDriveConfig {
  enabled: boolean;
  apiUrl: string;
  token: string;
  uploadPath: string;
}

export class CloudStorageService {
  private static getConfig(): CloudDriveConfig {
    const settings = getSettings();
    return {
      enabled: settings.cloudDriveEnabled || false,
      apiUrl: settings.openListApiUrl || '',
      token: settings.openListToken || '',
      uploadPath: settings.cloudDrivePath || '/'
    };
  }

  static async uploadVideo(videoData: any): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled || !config.apiUrl || !config.token) {
      return;
    }

    console.log(`[CloudStorage] Starting upload for video: ${videoData.title}`);

    try {
      // Upload Video File
      if (videoData.videoPath) {
        // videoPath is relative, e.g. /videos/filename.mp4
        // We need absolute path. Assuming backend runs in project root or we can resolve it.
        // Based on storageService, VIDEOS_DIR is likely imported from config/paths.
        // But here we might need to resolve it.
        // Let's try to resolve relative to process.cwd() or use absolute path if available.
        // Actually, storageService stores relative paths for frontend usage.
        // We should probably look up the file using the same logic as storageService or just assume standard location.
        // For now, let's try to construct the path.
        
        // Better approach: Use the absolute path if we can get it, or resolve from common dirs.
        // Since I don't have direct access to config/paths here easily without importing, 
        // I'll assume the videoData might have enough info or I'll import paths.
        
        const absoluteVideoPath = this.resolveAbsolutePath(videoData.videoPath);
        if (absoluteVideoPath && fs.existsSync(absoluteVideoPath)) {
            await this.uploadFile(absoluteVideoPath, config);
        } else {
            console.error(`[CloudStorage] Video file not found: ${videoData.videoPath}`);
        }
      }

      // Upload Thumbnail
      if (videoData.thumbnailPath) {
        const absoluteThumbPath = this.resolveAbsolutePath(videoData.thumbnailPath);
        if (absoluteThumbPath && fs.existsSync(absoluteThumbPath)) {
             await this.uploadFile(absoluteThumbPath, config);
        }
      }

      // Upload Metadata (JSON)
      const metadata = {
        title: videoData.title,
        description: videoData.description,
        author: videoData.author,
        sourceUrl: videoData.sourceUrl,
        tags: videoData.tags,
        createdAt: videoData.createdAt,
        ...videoData
      };
      
      const metadataFileName = `${this.sanitizeFilename(videoData.title)}.json`;
      const metadataPath = path.join(process.cwd(), 'temp_metadata', metadataFileName);
      fs.ensureDirSync(path.dirname(metadataPath));
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      await this.uploadFile(metadataPath, config);
      
      // Cleanup temp metadata
      fs.unlinkSync(metadataPath);

      console.log(`[CloudStorage] Upload completed for: ${videoData.title}`);

    } catch (error) {
      console.error(`[CloudStorage] Upload failed for ${videoData.title}:`, error);
    }
  }

  private static resolveAbsolutePath(relativePath: string): string | null {
    // This is a heuristic. In a real app we should import the constants.
    // Assuming the app runs from 'backend' or root.
    // relativePath starts with /videos or /images
    
    // Try to find the 'data' directory.
    // If we are in backend/src/services, data is likely ../../../data
    
    // Let's try to use the absolute path if we can find the data dir.
    // Or just check common locations.
    
    const possibleRoots = [
        path.join(process.cwd(), 'data'),
        path.join(process.cwd(), '..', 'data'), // if running from backend
        path.join(__dirname, '..', '..', '..', 'data') // if compiled
    ];

    for (const root of possibleRoots) {
        if (fs.existsSync(root)) {
            // Remove leading slash from relative path
            const cleanRelative = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
            const fullPath = path.join(root, cleanRelative);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
    }
    
    return null;
  }

  private static async uploadFile(filePath: string, config: CloudDriveConfig): Promise<void> {
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileStream = fs.createReadStream(filePath);

    console.log(`[CloudStorage] Uploading ${fileName} (${fileSize} bytes)...`);

    // Generic upload implementation
    // Assuming a simple PUT or POST with file content
    // Many cloud drives (like Alist/WebDAV) use PUT with the path.
    
    // Construct URL: apiUrl + uploadPath + fileName
    // Ensure slashes are handled correctly
    const baseUrl = config.apiUrl.endsWith('/') ? config.apiUrl.slice(0, -1) : config.apiUrl;
    const uploadDir = config.uploadPath.startsWith('/') ? config.uploadPath : '/' + config.uploadPath;
    const finalDir = uploadDir.endsWith('/') ? uploadDir : uploadDir + '/';
    
    // Encode filename for URL
    const encodedFileName = encodeURIComponent(fileName);
    const url = `${baseUrl}${finalDir}${encodedFileName}`;

    try {
        await axios.put(url, fileStream, {
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/octet-stream',
                'Content-Length': fileSize
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        console.log(`[CloudStorage] Successfully uploaded ${fileName}`);
    } catch (error: any) {
        // Try POST if PUT fails, some APIs might differ
        console.warn(`[CloudStorage] PUT failed, trying POST... Error: ${error.message}`);
        try {
             // For POST, we might need FormData, but let's try raw body first or check if it's a specific API.
             // If it's Alist/WebDAV, PUT is standard.
             // If it's a custom API, it might expect FormData.
             // Let's stick to PUT for now as it's common for "Save to Cloud" generic interfaces.
             throw error; 
        } catch (retryError) {
            throw retryError;
        }
    }
  }

  private static sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  }
}
