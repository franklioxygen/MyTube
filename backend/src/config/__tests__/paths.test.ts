import path from 'path';
import { describe, expect, it } from 'vitest';

describe('paths config', () => {
  it('should define paths relative to CWD', async () => {
    // We can't easily mock process.cwd() for top-level imports without jump through hoops (like unique helper files or resetting modules)
    // So we will verify the structure relative to whatever the current CWD is.
    
    // Dynamically import to ensure we get a fresh execution if possible, though mostly for show in this simple case
    const paths = await import('../paths');
    
    const cwd = process.cwd();
    
    expect(paths.ROOT_DIR).toBe(cwd);
    expect(paths.UPLOADS_DIR).toBe(path.join(cwd, 'uploads'));
    expect(paths.VIDEOS_DIR).toBe(path.join(cwd, 'uploads', 'videos'));
    expect(paths.IMAGES_DIR).toBe(path.join(cwd, 'uploads', 'images'));
    expect(paths.SUBTITLES_DIR).toBe(path.join(cwd, 'uploads', 'subtitles'));
    expect(paths.CLOUD_THUMBNAIL_CACHE_DIR).toBe(path.join(cwd, 'uploads', 'cloud-thumbnail-cache'));
    expect(paths.DATA_DIR).toBe(path.join(cwd, 'data'));
    
    expect(paths.VIDEOS_DATA_PATH).toBe(path.join(cwd, 'data', 'videos.json'));
    expect(paths.STATUS_DATA_PATH).toBe(path.join(cwd, 'data', 'status.json'));
    expect(paths.COLLECTIONS_DATA_PATH).toBe(path.join(cwd, 'data', 'collections.json'));
  });
});
