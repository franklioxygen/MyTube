import { Request, Response } from 'express';
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanFiles, scanMountDirectories } from '../../controllers/scanController';
import { resolveMountDirectoriesByIds } from '../../config/mountDirectories';
import * as storageService from '../../services/storageService';
import {
  createStrictFeatureDisabledPayload,
  isStrictFeatureDisabled,
} from '../../utils/strictSecurity';

vi.mock('../../config/mountDirectories', () => ({
  resolveMountDirectoriesByIds: vi.fn(() => ({
    matchedDirectories: [{ id: 'videos', label: 'videos', path: '/mnt/videos' }],
    invalidDirectoryIds: [],
  })),
}));
vi.mock('../../services/storageService');
vi.mock('../../services/tmdbService', () => ({
  scrapeMetadataFromTMDB: vi.fn().mockResolvedValue(null), // Default to null (no metadata found)
}));
vi.mock('fs-extra', () => ({
  default: {
    existsSync: vi.fn(),
    pathExists: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    ensureDirSync: vi.fn(),
    ensureFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    moveSync: vi.fn(),
    removeSync: vi.fn(),
    remove: vi.fn(), // Added remove for fs.removeSync mock check if used
  },
  existsSync: vi.fn(),
  pathExists: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  ensureDirSync: vi.fn(),
  ensureFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  moveSync: vi.fn(),
  removeSync: vi.fn(), // direct export mock
  remove: vi.fn(),
}));
vi.mock('../../utils/security', () => ({
  execFileSafe: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  isPathWithinDirectory: vi.fn().mockReturnValue(true),
  resolveSafePath: vi.fn((path: string) => path),
  validateImagePath: vi.fn((path: string) => path),
}));
vi.mock('../../utils/strictSecurity', () => ({
  isStrictFeatureDisabled: vi.fn(),
  createStrictFeatureDisabledPayload: vi.fn(() => ({
    success: false,
    error: 'feature disabled',
    feature: 'mountDirectories',
  })),
}));
vi.mock('child_process');

describe('ScanController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isStrictFeatureDisabled).mockReturnValue(false);
    vi.mocked(resolveMountDirectoriesByIds).mockReturnValue({
      matchedDirectories: [{ id: 'videos', label: 'videos', path: '/mnt/videos' }],
      invalidDirectoryIds: [],
    });
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {};
    res = {
      json,
      status,
    };
  });

  describe('scanFiles', () => {
    it('should scan files and add new videos', async () => {
      (storageService.getVideos as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(true);
      (fs.readdir as any).mockResolvedValue([
        {
          name: 'video.mp4',
          isDirectory: () => false,
          isSymbolicLink: () => false,
        },
      ]);
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });

      // Mock execFileSafe from security utils
      const security = await import('../../utils/security');
      (security.execFileSafe as any).mockResolvedValue({ stdout: '120', stderr: '' });

      await scanFiles(req as Request, res as Response);

      expect(storageService.saveVideo).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({
        addedCount: 1
      }));
    }, 10000); // Increase timeout to 10 seconds

    it('should handle errors', async () => {
      (storageService.getVideos as any).mockImplementation(() => {
        throw new Error('Error');
      });

      try {
        await scanFiles(req as Request, res as Response);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Error');
      }
    });

    it('should refresh metadata when file size changes at same path', async () => {
      (storageService.getVideos as any).mockReturnValue([
        {
          id: 'existing-video-id',
          title: 'Old Title',
          videoPath: '/videos/video.mp4',
          fileSize: '100',
        },
      ]);
      (fs.pathExists as any).mockResolvedValue(true);
      (fs.readdir as any).mockResolvedValue([
        {
          name: 'video.mp4',
          isDirectory: () => false,
          isSymbolicLink: () => false,
        },
      ]);
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });

      const security = await import('../../utils/security');
      (security.execFileSafe as any).mockResolvedValue({ stdout: '120', stderr: '' });

      await scanFiles(req as Request, res as Response);

      expect(storageService.saveVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'existing-video-id',
          videoPath: '/videos/video.mp4',
          fileSize: '1024',
        }),
      );
    });
  });

  describe('scanMountDirectories', () => {
    it('should return 403 when mount directories API is disabled in strict mode', async () => {
      vi.mocked(isStrictFeatureDisabled).mockReturnValue(true);
      req = {
        body: {
          directoryIds: ['videos'],
        },
      };

      await scanMountDirectories(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(403);
      expect(createStrictFeatureDisabledPayload).toHaveBeenCalledWith('mountDirectories');
    });

    it('should reject unknown platform mount directory IDs', async () => {
      vi.mocked(resolveMountDirectoriesByIds).mockReturnValue({
        matchedDirectories: [],
        invalidDirectoryIds: ['unknown-id'],
      });
      req = {
        body: {
          directoryIds: ['unknown-id'],
        },
      };

      await scanMountDirectories(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          invalidDirectoryIds: ['unknown-id'],
        }),
      );
    });
  });
});
