import { Request, Response } from 'express';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getScanStatus, scanFiles, scanMountDirectories } from '../../controllers/scanController';
import * as storageService from '../../services/storageService';

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
vi.mock('../../utils/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/security')>();
  return {
    ...actual,
    execFileSafe: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    imagePathExists: vi.fn().mockResolvedValue(true),
    isPathWithinDirectory: vi.fn((target: string, allowedDir: string) =>
      actual.isPathWithinDirectory(target, allowedDir),
    ),
    normalizeSafeAbsolutePath: vi.fn((target: string) =>
      actual.normalizeSafeAbsolutePath(target),
    ),
    pathExistsSafe: vi.fn((target: string, allowedDirOrDirs: string | readonly string[]) =>
      actual.pathExistsSafe(target, allowedDirOrDirs),
    ),
    readdirDirentsSafe: vi.fn((target: string, allowedDirOrDirs: string | readonly string[]) =>
      actual.readdirDirentsSafe(target, allowedDirOrDirs),
    ),
    removeImagePath: vi.fn().mockResolvedValue(undefined),
    resolveSafeChildPath: vi.fn((baseDir: string, childPath: string) =>
      actual.resolveSafeChildPath(baseDir, childPath),
    ),
    resolveSafePath: vi.fn((target: string, allowedDir: string) =>
      actual.resolveSafePath(target, allowedDir),
    ),
    statSafe: vi.fn((target: string, allowedDirOrDirs: string | readonly string[]) =>
      actual.statSafe(target, allowedDirOrDirs),
    ),
    validateImagePath: vi.fn((target: string) => actual.validateImagePath(target)),
  };
});
vi.mock('child_process');

describe('ScanController', () => {
  const originalTrustLevel = process.env.MYTUBE_ADMIN_TRUST_LEVEL;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  afterEach(() => {
    if (originalTrustLevel === undefined) {
      delete process.env.MYTUBE_ADMIN_TRUST_LEVEL;
    } else {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = originalTrustLevel;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
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
        { statisticsReason: 'scan' },
      );
    });
  });

  describe('scan status', () => {
    it('reports an idle scanner', async () => {
      await getScanStatus(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        scanning: false,
        scanType: null,
        startedAt: null,
      });
    });

    it('reports the running scan and rejects a concurrent one', async () => {
      (storageService.getVideos as any).mockReturnValue([]);

      // Hold the first scan open at its first await so a second request
      // arrives while it is still running.
      let releaseFirstScan: () => void = () => undefined;
      (fs.pathExists as any).mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            releaseFirstScan = () => resolve(false);
          }),
      );

      const firstScan = scanFiles(req as Request, res as Response);

      await getScanStatus(req as Request, res as Response);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ scanning: true, scanType: 'files' }),
      );

      const secondJson = vi.fn();
      const secondStatus = vi.fn().mockReturnValue({ json: secondJson });
      await scanFiles(req as Request, {
        json: secondJson,
        status: secondStatus,
      } as unknown as Response);

      expect(secondStatus).toHaveBeenCalledWith(409);
      expect(secondJson).toHaveBeenCalledWith(
        expect.objectContaining({ errorKey: 'scanAlreadyRunning' }),
      );

      releaseFirstScan();
      await firstScan;

      // The lock is released once the scan finishes.
      const thirdJson = vi.fn();
      const thirdStatus = vi.fn().mockReturnValue({ json: thirdJson });
      await getScanStatus(req as Request, {
        json: thirdJson,
        status: thirdStatus,
      } as unknown as Response);
      expect(thirdJson).toHaveBeenCalledWith(
        expect.objectContaining({ scanning: false }),
      );
    });
  });

  describe('scanMountDirectories', () => {
    it('should reject scanning when deployment trust is not host', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'container';
      req = {
        body: {
          directories: ['/mnt/videos'],
        },
      };

      await scanMountDirectories(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(403);
    });

    it('should reject relative mount directories', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      req = {
        body: {
          directories: ['../unsafe/path'],
        },
      };

      await scanMountDirectories(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          invalidDirectories: ['../unsafe/path'],
        }),
      );
    });

    it('skips hidden and NAS system directories', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(true);
      // QNAP/Synology drop generated previews beside the media; entering one
      // would import its clips as real videos.
      (fs.readdir as any).mockImplementation((dir: string) =>
        dir === '/mnt/media'
          ? Promise.resolve([
              { name: '.@__thumb', isDirectory: () => true, isSymbolicLink: () => false },
              { name: '@Recycle', isDirectory: () => true, isSymbolicLink: () => false },
              { name: 'real.mp4', isDirectory: () => false, isSymbolicLink: () => false },
            ])
          : Promise.resolve([
              { name: 'preview.mp4', isDirectory: () => false, isSymbolicLink: () => false },
            ]),
      );
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });
      const security = await import('../../utils/security');
      (security.execFileSafe as any).mockResolvedValue({ stdout: '120', stderr: '' });

      req = { body: { directories: ['/mnt/media'] } };

      await scanMountDirectories(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(200);
      expect(storageService.saveVideo).toHaveBeenCalledTimes(1);
      expect(storageService.saveVideo).toHaveBeenCalledWith(
        expect.objectContaining({ videoPath: 'mount:/mnt/media/real.mp4' }),
        expect.anything(),
      );
    });

    it('retries TMDB with the identifying folder when the filename does not match', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(true);
      (fs.readdir as any).mockImplementation((dir: string) => {
        if (dir === '/mnt/tv') {
          return Promise.resolve([
            { name: 'Breaking Bad (2008)', isDirectory: () => true, isSymbolicLink: () => false },
          ]);
        }
        if (dir === '/mnt/tv/Breaking Bad (2008)') {
          return Promise.resolve([
            { name: 'Season 1', isDirectory: () => true, isSymbolicLink: () => false },
          ]);
        }
        return Promise.resolve([
          {
            name: 'BrBa.S01E02.1080p.BluRay.x265-Silence.mkv',
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
        ]);
      });
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });
      const { scrapeMetadataFromTMDB } = await import('../../services/tmdbService');
      (scrapeMetadataFromTMDB as any).mockResolvedValue(null);

      req = { body: { directories: ['/mnt/tv'] } };

      await scanMountDirectories(req as Request, res as Response);

      // First on the release-name file, then on the show folder - "Season 1"
      // identifies nothing, so it is walked past.
      expect(scrapeMetadataFromTMDB).toHaveBeenCalledWith(
        'BrBa.S01E02.1080p.BluRay.x265-Silence.mkv',
        expect.any(String),
      );
      expect(scrapeMetadataFromTMDB).toHaveBeenCalledWith(
        'Breaking Bad (2008).mkv',
        expect.any(String),
      );
    });

    it('never relocates mount media when linking it to a collection', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([]);
      (storageService.getCollections as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(true);
      (fs.readdir as any).mockImplementation((dir: string) =>
        dir === '/mnt/media'
          ? Promise.resolve([
              { name: 'Heat (1995)', isDirectory: () => true, isSymbolicLink: () => false },
            ])
          : Promise.resolve([
              { name: 'Heat.mkv', isDirectory: () => false, isSymbolicLink: () => false },
            ]),
      );
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });

      req = { body: { directories: ['/mnt/media'] } };

      await scanMountDirectories(req as Request, res as Response);

      expect(storageService.addVideoToCollection).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { moveFiles: false },
      );
    });

    it('drops mount records that are no longer under a configured directory', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([
        { id: 'gone', title: 'Removed library', videoPath: 'mount:/mnt/removed/movie.mkv' },
      ]);
      (storageService.deleteVideo as any).mockReturnValue(true);
      (fs.pathExists as any).mockResolvedValue(true);
      (fs.readdir as any).mockResolvedValue([]);

      req = { body: { directories: ['/mnt/media'] } };

      await scanMountDirectories(req as Request, res as Response);

      expect(storageService.deleteVideo).toHaveBeenCalledWith('gone');
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ deletedCount: 1 }),
      );
    });

    it('should accept directory names that merely contain ".."', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(false);
      req = {
        body: {
          directories: ['/mnt/media/03..intro', '/mnt/media/Cat\'s in the Bag...'],
        },
      };

      await scanMountDirectories(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ scannedDirectories: 2 }),
      );
    });
  });
});
