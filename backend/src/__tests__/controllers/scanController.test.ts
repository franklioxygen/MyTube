import { Request, Response } from 'express';
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanFiles } from '../../controllers/scanController';
import * as storageService from '../../services/storageService';

vi.mock('../../services/storageService');
vi.mock('../../services/tmdbService', () => ({
  scrapeMetadataFromTMDB: vi.fn().mockResolvedValue(null), // Default to null (no metadata found)
}));
vi.mock('fs-extra', () => ({
  default: {
    existsSync: vi.fn(),
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
  resolveSafePath: vi.fn((path: string) => path),
  validateImagePath: vi.fn((path: string) => path),
}));
vi.mock('child_process');

describe('ScanController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
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
      (fs.existsSync as any).mockReturnValue(true);
      // Mock async readdir instead of readdirSync
      (fs.readdir as any).mockResolvedValue(['video.mp4']);
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });
      // Also mock readdirSync for getFilesRecursively if it's still used
      (fs.readdirSync as any).mockReturnValue(['video.mp4']);
      (fs.statSync as any).mockReturnValue({
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
  });
});
