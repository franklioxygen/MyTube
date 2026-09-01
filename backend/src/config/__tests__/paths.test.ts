import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadPaths = async () => {
  vi.resetModules();
  return import('../paths');
};

describe('paths config', () => {
  const originalDataDir = process.env.MYTUBE_DATA_DIR;

  beforeEach(() => {
    delete process.env.MYTUBE_DATA_DIR;
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.MYTUBE_DATA_DIR;
    } else {
      process.env.MYTUBE_DATA_DIR = originalDataDir;
    }
    vi.resetModules();
  });

  it('should define paths relative to CWD', async () => {
    const paths = await loadPaths();
    const cwd = process.cwd();

    expect(paths.ROOT_DIR).toBe(cwd);
    expect(paths.UPLOADS_DIR).toBe(path.join(cwd, 'uploads'));
    expect(paths.VIDEOS_DIR).toBe(path.join(cwd, 'uploads', 'videos'));
    expect(paths.IMAGES_DIR).toBe(path.join(cwd, 'uploads', 'images'));
    expect(paths.IMAGES_SMALL_DIR).toBe(path.join(cwd, 'uploads', 'images-small'));
    expect(paths.SUBTITLES_DIR).toBe(path.join(cwd, 'uploads', 'subtitles'));
    expect(paths.CLOUD_THUMBNAIL_CACHE_DIR).toBe(path.join(cwd, 'uploads', 'cloud-thumbnail-cache'));
    expect(paths.DATA_DIR).toBe(path.join(cwd, 'data'));

    expect(paths.VIDEOS_DATA_PATH).toBe(path.join(cwd, 'data', 'videos.json'));
    expect(paths.STATUS_DATA_PATH).toBe(path.join(cwd, 'data', 'status.json'));
    expect(paths.COLLECTIONS_DATA_PATH).toBe(path.join(cwd, 'data', 'collections.json'));
  });

  it('should let MYTUBE_DATA_DIR relocate the data directory', async () => {
    process.env.MYTUBE_DATA_DIR = path.join(path.sep, 'srv', 'mytube-data');
    const paths = await loadPaths();

    expect(paths.DATA_DIR).toBe(path.join(path.sep, 'srv', 'mytube-data'));
    expect(paths.VIDEOS_DATA_PATH).toBe(path.join(path.sep, 'srv', 'mytube-data', 'videos.json'));
    expect(paths.HOOKS_DIR).toBe(path.join(path.sep, 'srv', 'mytube-data', 'hooks'));
  });

  it('should resolve a relative MYTUBE_DATA_DIR against CWD', async () => {
    process.env.MYTUBE_DATA_DIR = 'relative-data';
    const paths = await loadPaths();

    expect(paths.DATA_DIR).toBe(path.resolve(process.cwd(), 'relative-data'));
  });

  it('should leave the media directories alone when only the data dir moves', async () => {
    process.env.MYTUBE_DATA_DIR = path.join(path.sep, 'srv', 'mytube-data');
    const paths = await loadPaths();

    // Only DATA_DIR is relocatable; uploads still follow ROOT_DIR.
    expect(paths.UPLOADS_DIR).toBe(path.join(process.cwd(), 'uploads'));
    expect(paths.VIDEOS_DIR).toBe(path.join(process.cwd(), 'uploads', 'videos'));
  });
});
