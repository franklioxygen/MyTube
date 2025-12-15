import { Request, Response } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTempFiles } from '../../controllers/cleanupController';

// Mock config/paths to use a temp directory
vi.mock('../../config/paths', async () => {
  const path = await import('path');
  return {
    VIDEOS_DIR: path.default.join(process.cwd(), 'src', '__tests__', 'temp_cleanup_test_videos_dir')
  };
});

import { VIDEOS_DIR } from '../../config/paths';

// Mock storageService to simulate no active downloads
vi.mock('../../services/storageService', () => ({
  getDownloadStatus: vi.fn(() => ({ activeDownloads: [] }))
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

  it('should delete directories starting with temp_ recursively', async () => {
    // Create structure:
    // videos/
    //   temp_folder1/ (should be deleted)
    //     file.txt
    //   normal_folder/ (should stay)
    //     temp_nested/ (should be deleted per current recursive logic)
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
    await fs.ensureDir(nestedNormal);
    
    await fs.ensureFile(partFile);
    await fs.ensureFile(normalFile);

    await cleanupTempFiles(req, res);

    expect(await fs.pathExists(tempFolder1)).toBe(false);
    expect(await fs.pathExists(normalFolder)).toBe(true);
    expect(await fs.pathExists(nestedTemp)).toBe(false);
    expect(await fs.pathExists(nestedNormal)).toBe(true);
    expect(await fs.pathExists(partFile)).toBe(false);
    expect(await fs.pathExists(normalFile)).toBe(true);
  });
});
