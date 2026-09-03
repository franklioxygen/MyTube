import { Request, Response } from 'express';
import fs from 'fs-extra';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getScanStatus, scanFiles, scanMountDirectories } from '../../controllers/scanController';
import * as storageService from '../../services/storageService';

vi.mock('../../services/storageService');
vi.mock('../../services/tmdbService', async () => {
  // Keep the real filename parser - it is pure (path + types only) and the
  // episode designator the scan builds is exactly what needs exercising.
  const { parseFilename } = await import('../../services/tmdbService/filenameParser');
  return {
    parseFilename,
    scrapeMetadataFromTMDB: vi.fn().mockResolvedValue(null), // Default to null (no metadata found)
  };
});
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
      // Two videos, so the folder earns a collection and the link is exercised.
      (fs.readdir as any).mockImplementation((dir: string) =>
        dir === '/mnt/media'
          ? Promise.resolve([
              { name: 'Breaking Bad', isDirectory: () => true, isSymbolicLink: () => false },
            ])
          : Promise.resolve([
              { name: 'S01E01.mkv', isDirectory: () => false, isSymbolicLink: () => false },
              { name: 'S01E02.mkv', isDirectory: () => false, isSymbolicLink: () => false },
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

    it('leaves a single-video folder out of collections entirely', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([]);
      // A collection of that name already exists - left behind by an earlier
      // scan - and the lone film must not be swept back into it.
      (storageService.getCollections as any).mockReturnValue([
        { id: 'stale', title: 'Heat (1995)', name: 'Heat (1995)', videos: [] },
      ]);
      (fs.pathExists as any).mockResolvedValue(true);
      (fs.readdir as any).mockImplementation((dir: string) => {
        if (dir === '/mnt/media') {
          return Promise.resolve([
            { name: 'Heat (1995)', isDirectory: () => true, isSymbolicLink: () => false },
            { name: 'Breaking Bad', isDirectory: () => true, isSymbolicLink: () => false },
          ]);
        }
        if (dir === '/mnt/media/Heat (1995)') {
          return Promise.resolve([
            { name: 'Heat.mkv', isDirectory: () => false, isSymbolicLink: () => false },
          ]);
        }
        return Promise.resolve([
          { name: 'S01E01.mkv', isDirectory: () => false, isSymbolicLink: () => false },
          { name: 'S01E02.mkv', isDirectory: () => false, isSymbolicLink: () => false },
        ]);
      });
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });

      req = { body: { directories: ['/mnt/media'] } };

      await scanMountDirectories(req as Request, res as Response);

      // The single film gets no collection at all; the two-episode folder does.
      const created = (storageService.saveCollection as any).mock.calls.map(
        (call: any[]) => call[0].title,
      );
      expect(created).toEqual(['Breaking Bad']);
      expect(storageService.addVideoToCollection).not.toHaveBeenCalledWith(
        'stale',
        expect.anything(),
        expect.anything(),
      );
      expect(storageService.saveVideo).toHaveBeenCalledTimes(3);
    });

    it('keeps the episode number and names the collection after the matched show', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([]);
      (storageService.getCollections as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(true);
      const releaseFolder =
        'Five Days at Memorial (2022) Season 1 S01 (1080p ATVP WEB-DL x265 t3nzin)';
      (fs.readdir as any).mockImplementation((dir: string) =>
        dir === '/mnt/tv'
          ? Promise.resolve([
              { name: releaseFolder, isDirectory: () => true, isSymbolicLink: () => false },
            ])
          : Promise.resolve([
              {
                name: 'Five Days at Memorial (2022) - S01E01 - Day One (1080p).mkv',
                isDirectory: () => false,
                isSymbolicLink: () => false,
              },
              {
                name: 'Five Days at Memorial (2022) - S01E02 - Day Two (1080p).mkv',
                isDirectory: () => false,
                isSymbolicLink: () => false,
              },
            ]),
      );
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });
      const { scrapeMetadataFromTMDB } = await import('../../services/tmdbService');
      (scrapeMetadataFromTMDB as any).mockResolvedValue({ title: '医院五日' });

      req = { body: { directories: ['/mnt/tv'] } };

      await scanMountDirectories(req as Request, res as Response);

      // TMDB matches the series, so the episode designator has to come from
      // the filename or every episode reads identically.
      const titles = (storageService.saveVideo as any).mock.calls
        .map((call: any[]) => call[0].title)
        .sort();
      expect(titles).toEqual(['医院五日 - S01E01', '医院五日 - S01E02']);

      // The collection shows the recognized work, but keeps the folder as its
      // lookup key.
      const collection = (storageService.saveCollection as any).mock.calls[0][0];
      expect(collection.title).toBe('医院五日');
      expect(collection.name).toBe(releaseFolder);
    });

    it('skips trailers, samples and featurettes instead of importing them', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([]);
      (storageService.getCollections as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(true);
      // clearAllMocks keeps implementations, so pin this one: an earlier test
      // leaves a show title behind that would rename the collection.
      const { scrapeMetadataFromTMDB } = await import('../../services/tmdbService');
      (scrapeMetadataFromTMDB as any).mockResolvedValue(null);

      const dir = (name: string) => ({
        name,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      });
      const file = (name: string) => ({
        name,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      });

      // Shapes taken from a real library: bonus material in a Featurettes
      // folder, a release-group sample beside the film, and a genuine trilogy.
      const tree: Record<string, any[]> = {
        '/mnt/movies': [
          dir('Django Unchained (2012)'),
          dir('Blade.Runner.2049.2017.1080p'),
          dir('The.Godfather.Trilogy.1972-1990'),
        ],
        '/mnt/movies/Django Unchained (2012)': [
          file('Django Unchained (2012).mkv'),
          dir('Featurettes'),
        ],
        '/mnt/movies/Django Unchained (2012)/Featurettes': [
          file('The Costume Designs of Sharen Davis.mkv'),
          file('The Production Design of Django Unchained.mkv'),
        ],
        '/mnt/movies/Blade.Runner.2049.2017.1080p': [
          file('Blade.Runner.2049.2017.1080p.x265.mkv'),
          file('Blade.Runner.2049.2017.1080p.8CH.sample.mkv'),
        ],
        '/mnt/movies/The.Godfather.Trilogy.1972-1990': [
          file('The.Godfather.1972.mkv'),
          file('The.Godfather.Part.II.1974.mkv'),
          file('The.Godfather.Part.III.1990.mkv'),
        ],
      };
      (fs.readdir as any).mockImplementation((path: string) =>
        Promise.resolve(tree[path] ?? []),
      );
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });

      req = { body: { directories: ['/mnt/movies'] } };

      await scanMountDirectories(req as Request, res as Response);

      // Only the genuine set gets a collection: the two lone films had their
      // extras discounted.
      const created = (storageService.saveCollection as any).mock.calls.map(
        (call: any[]) => call[0].title,
      );
      expect(created).toEqual(['The.Godfather.Trilogy.1972-1990']);

      // 5 of the 8 files are imported: the extras never enter the library.
      const imported = (storageService.saveVideo as any).mock.calls
        .map((call: any[]) => path.basename(call[0].videoPath))
        .sort();
      expect(imported).toEqual([
        'Blade.Runner.2049.2017.1080p.x265.mkv',
        'Django Unchained (2012).mkv',
        'The.Godfather.1972.mkv',
        'The.Godfather.Part.II.1974.mkv',
        'The.Godfather.Part.III.1990.mkv',
      ]);
    });

    it('treats a top-level library named like a bonus folder as content', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      (storageService.getVideos as any).mockReturnValue([]);
      (storageService.getCollections as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(true);
      const { scrapeMetadataFromTMDB } = await import('../../services/tmdbService');
      (scrapeMetadataFromTMDB as any).mockResolvedValue(null);

      // "Shorts" here is a library, not bonus material beside a film.
      (fs.readdir as any).mockImplementation((dir: string) =>
        dir === '/mnt/media'
          ? Promise.resolve([
              { name: 'Shorts', isDirectory: () => true, isSymbolicLink: () => false },
            ])
          : Promise.resolve([
              { name: 'A Short Film.mkv', isDirectory: () => false, isSymbolicLink: () => false },
            ]),
      );
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });

      req = { body: { directories: ['/mnt/media'] } };

      await scanMountDirectories(req as Request, res as Response);

      expect(storageService.saveVideo).toHaveBeenCalledWith(
        expect.objectContaining({ videoPath: 'mount:/mnt/media/Shorts/A Short Film.mkv' }),
        expect.anything(),
      );
    });

    it('links an unchanged video once its folder earns a collection', async () => {
      process.env.MYTUBE_ADMIN_TRUST_LEVEL = 'host';
      // The first episode is already imported and unchanged; the second is new,
      // so the folder crosses the grouping threshold on this scan.
      (storageService.getVideos as any).mockReturnValue([
        {
          id: 'ep1',
          title: 'S01E01',
          videoPath: 'mount:/mnt/tv/Show/S01E01.mkv',
          fileSize: '1024',
        },
      ]);
      (storageService.getCollections as any).mockReturnValue([]);
      (fs.pathExists as any).mockResolvedValue(true);
      const { scrapeMetadataFromTMDB } = await import('../../services/tmdbService');
      (scrapeMetadataFromTMDB as any).mockResolvedValue(null);
      (fs.readdir as any).mockImplementation((dir: string) =>
        dir === '/mnt/tv'
          ? Promise.resolve([
              { name: 'Show', isDirectory: () => true, isSymbolicLink: () => false },
            ])
          : Promise.resolve([
              { name: 'S01E01.mkv', isDirectory: () => false, isSymbolicLink: () => false },
              { name: 'S01E02.mkv', isDirectory: () => false, isSymbolicLink: () => false },
            ]),
      );
      (fs.stat as any).mockResolvedValue({
        isDirectory: () => false,
        birthtime: new Date(),
        size: 1024,
      });

      req = { body: { directories: ['/mnt/tv'] } };

      await scanMountDirectories(req as Request, res as Response);

      // Without reconciliation the collection would hold only the new episode.
      expect(storageService.addVideoToCollection).toHaveBeenCalledWith(
        expect.any(String),
        'ep1',
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
