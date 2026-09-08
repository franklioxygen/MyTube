import { Request, Response } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTempFiles } from '../../controllers/cleanupController';

// Mock config/paths to use a temp directory
vi.mock('../../config/paths', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/paths')>();
  const path = await import('path');
  return {
    ...original,
    VIDEOS_DIR: path.default.join(process.cwd(), 'src', '__tests__', 'temp_cleanup_test_videos_dir')
  };
});

import { VIDEOS_DIR } from '../../config/paths';

// Mock storageService to simulate no active downloads
vi.mock('../../services/storageService', () => ({
  getDownloadStatus: vi.fn(() => ({ activeDownloads: [] })),
  getVideosStrict: vi.fn(() => [])
}));

describe('cleanupController', () => {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  } as unknown as Response;

  beforeEach(async () => {
    // Ensure test directory exists
    await fs.ensureDir(VIDEOS_DIR);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test directory
    if (await fs.pathExists(VIDEOS_DIR)) {
      await fs.remove(VIDEOS_DIR);
    }
  });

  it('preserves temp_ folders and completed files while removing partial files inside them', async () => {
    // Create structure:
    // videos/
    //   temp_folder1/ (should stay)
    //     file.txt
    //   normal_folder/ (should stay)
    //     temp_nested/ (should stay)
    //     normal_nested/ (should stay)
    //   video.mp4 (should stay)
    //   video.mp4.part (should be deleted)

    const tempFolder1 = path.join(VIDEOS_DIR, 'temp_folder1');
    const normalFolder = path.join(VIDEOS_DIR, 'normal_folder');
    const nestedTemp = path.join(normalFolder, 'temp_nested');
    const nestedNormal = path.join(normalFolder, 'normal_nested');
    const partFile = path.join(VIDEOS_DIR, 'video.mp4.part');
    const normalFile = path.join(VIDEOS_DIR, 'video.mp4');

    await fs.ensureDir(tempFolder1);
    await fs.writeFile(path.join(tempFolder1, 'file.txt'), 'content');
    
    await fs.ensureDir(normalFolder);
    await fs.ensureDir(nestedTemp);
    await fs.writeFile(path.join(nestedTemp, 'keep.mp4'), 'completed video');
    await fs.writeFile(path.join(nestedTemp, 'abandoned.mp4.part'), 'partial');
    await fs.ensureDir(nestedNormal);
    
    await fs.ensureFile(partFile);
    await fs.ensureFile(normalFile);

    await cleanupTempFiles(req, res);

    expect(await fs.readFile(path.join(tempFolder1, 'file.txt'), 'utf8')).toBe('content');
    expect(await fs.pathExists(normalFolder)).toBe(true);
    expect(await fs.readFile(path.join(nestedTemp, 'keep.mp4'), 'utf8')).toBe('completed video');
    expect(await fs.pathExists(path.join(nestedTemp, 'abandoned.mp4.part'))).toBe(false);
    expect(await fs.pathExists(nestedNormal)).toBe(true);
    expect(await fs.pathExists(partFile)).toBe(false);
    expect(await fs.pathExists(normalFile)).toBe(true);
  });
});
