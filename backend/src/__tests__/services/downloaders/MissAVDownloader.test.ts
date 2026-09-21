
import { spawn } from 'child_process';
import axios from 'axios';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import puppeteer from 'puppeteer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissAVDownloader } from '../../../services/downloaders/MissAVDownloader';
import { cleanupTemporaryFiles, isCancellationError, isDownloadActive, safeRemove } from '../../../utils/downloadUtils';
import { flagsToArgs, getAxiosProxyConfig, getUserYtDlpConfig, isYtDlpImpersonateAvailable } from '../../../utils/ytDlpUtils';
import * as security from '../../../utils/security';
import { logger } from '../../../utils/logger';
import { getMissAVPlaceholderTitle } from '../../../utils/helpers';
import * as storageService from '../../../services/storageService';
import { VIDEOS_DIR, IMAGES_DIR } from '../../../config/paths';
import { verifyDownloadedMediaComplete } from '../../../services/downloaders/downloadIntegrity';
import * as outputPaths from '../../../services/downloaders/missav/outputPaths';
import * as allocator from '../../../services/filenameTemplate/outputPathAllocator';
import * as metadata from '../../../services/metadataService';
import * as mediaServer from '../../../services/mediaServerExport';
import * as thumbnailMirror from '../../../services/thumbnailMirrorService';

vi.mock('../../../services/downloaders/downloadIntegrity', () => ({
  verifyDownloadedMediaComplete: vi.fn().mockResolvedValue({ complete: true }),
}));

// The downloader fetches the HLS playlist to establish a source duration.
// Without this the suite makes real outbound requests and only passes because
// they fail. `playlistBody` is what a test wants that fetch to return.
const playlistBody = vi.hoisted(() => ({ value: null as string | null }));
// A playlist body the mocked browser reports having fetched itself. The real
// CDN fingerprints TLS and 403s a plain Node request, so this is the path
// that actually carries a duration in production.
const capturedPlaylist = vi.hoisted(() => ({ value: null as string | null }));
// Set to model the playlist request having been redirected.
const capturedPlaylistFinalUrl = vi.hoisted(() => ({ value: null as string | null }));
const capturedPlaylistHeaders = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (playlistBody.value === null) throw new Error('network disabled in tests');
      return { data: playlistBody.value, url };
    }),
  },
}));

vi.mock('puppeteer');
vi.mock('../../../services/storageService', () => ({
  saveVideo: vi.fn(),
  updateVideo: vi.fn(),
  updateActiveDownload: vi.fn(),
  getSettings: vi.fn().mockReturnValue({}),
  getVideos: vi.fn().mockReturnValue([]),
  getVideoBySourceUrl: vi.fn().mockReturnValue(null),
  checkVideoDownloadBySourceId: vi.fn().mockReturnValue({ found: false }),
  organizeVideoByAuthor: vi.fn().mockReturnValue(null),
  getVideoById: vi.fn().mockReturnValue(null),
  isVideoFileReferencedByOtherVideo: vi.fn().mockReturnValue(false),
  persistDownloadedMediaIdentity: vi.fn(({ video }) => video),
}));
vi.mock('../../../utils/ytDlpUtils', () => ({
  getUserYtDlpConfig: vi.fn().mockReturnValue({}),
  getNetworkConfigFromUserConfig: vi.fn().mockReturnValue({}),
  flagsToArgs: vi.fn().mockReturnValue([]),
  getAxiosProxyConfig: vi.fn().mockReturnValue({}),
  InvalidProxyError: class InvalidProxyError extends Error {},
  isYtDlpImpersonateAvailable: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../../utils/downloadUtils', () => ({
  cleanupTemporaryFiles: vi.fn().mockResolvedValue(undefined),
  safeRemove: vi.fn().mockResolvedValue(undefined),
  isCancellationError: vi.fn().mockReturnValue(false),
  isDownloadActive: vi.fn().mockReturnValue(true),
}));
vi.mock('../../../utils/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/security')>();
  return {
    ...actual,
    pathExistsTrustedSync: vi.fn(() => false),
  };
});
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));
vi.mock('fs-extra', () => ({
  default: {
    ensureDirSync: vi.fn(),
    ensureFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    removeSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    createWriteStream: vi.fn(() => ({
      on: (event: string, cb: () => void) => {
        if (event === 'finish') cb();
        return { on: () => {} };
      },
      write: () => {},
      end: () => {},
    })),
    statSync: vi.fn(() => ({ size: 1000 })),
  },
}));


function createAutoClosingSpawnProc(code = 1): any {
  const proc: {
    stdout: { on: ReturnType<typeof vi.fn> };
    stderr: { on: ReturnType<typeof vi.fn> };
    killed: boolean;
    exitCode: number;
    kill: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
  } = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    killed: false,
    exitCode: code,
    kill: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  };
  proc.on.mockImplementation((event: string, cb: (code: number) => void) => {
    if (event === 'close') queueMicrotask(() => cb(code));
    return proc;
  });
  proc.once.mockImplementation((event: string, cb: (code: number) => void) => {
    if (event === 'close') queueMicrotask(() => cb(code));
    return proc;
  });
  return proc;
}

describe('MissAVDownloader', () => {
  const expectedChromeFallbackPath =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : process.platform === 'win32'
        ? `${process.env.PROGRAMFILES || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`
        : '/usr/bin/google-chrome-stable';

  beforeEach(() => {
    vi.mocked(spawn).mockImplementation(() => createAutoClosingSpawnProc(1));
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(security.pathExistsTrustedSync).mockReturnValue(false);
    vi.mocked(storageService.getSettings).mockReturnValue({} as any);
    vi.mocked(isDownloadActive).mockReturnValue(true);
    playlistBody.value = null;
    capturedPlaylist.value = null;
    capturedPlaylistFinalUrl.value = null;
    capturedPlaylistHeaders.value = {};
    (getUserYtDlpConfig as ReturnType<typeof vi.fn>).mockReturnValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockImplementation(() => createAutoClosingSpawnProc(1));
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.PUPPETEER_HEADLESS;
  });

  describe('getVideoInfo', () => {
    it('should extract author from domain name', async () => {
      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Title'),
        content: vi.fn().mockResolvedValue('<html><head><meta property="og:title" content="Test Title"><meta property="og:image" content="http://test.com/img.jpg"></head><body></body></html>'),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      const url = 'https://missav.com/test-video';
      const info = await MissAVDownloader.getVideoInfo(url);

      expect(info.author).toBe('missav.com');
    });

    it('closes the browser when navigation throws', async () => {
      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Just a moment...'),
        content: vi.fn().mockResolvedValue('<html><body>cf-turnstile</body></html>'),
        waitForFunction: vi.fn().mockRejectedValue(new Error('timeout')),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      await MissAVDownloader.getVideoInfo('https://missav.com/test-video');

      // Closing only on the happy path orphaned one Chromium per failed
      // lookup, and a Cloudflare challenge - a run of which is exactly when
      // they pile up - throws out of navigation every time.
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('reports a Cloudflare challenge instead of silently returning placeholder metadata', async () => {
      const mockPage = {
        goto: vi.fn(),
        // Not the exact title navigateMissAvPage probes for, so the challenge
        // reaches the metadata parser unremarked.
        title: vi.fn().mockResolvedValue('Attention Required!'),
        content: vi.fn().mockResolvedValue(
          '<html><head></head><body><div class="cf-turnstile"></div></body></html>',
        ),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const info = await MissAVDownloader.getVideoInfo('https://missav.com/test-video');

      // The contract stays best-effort - callers rely on placeholder metadata
      // rather than a throw - but the reason has to be visible, otherwise a
      // challenge is indistinguishable from a page carrying no og: tags.
      expect(
        warnSpy.mock.calls.some((call) =>
          call.some((arg) => typeof arg === 'string' && arg.includes('Cloudflare')),
        ),
      ).toBe(true);
      expect(info.title).toBe(getMissAVPlaceholderTitle('https://missav.com/test-video'));
      warnSpy.mockRestore();
    });

    it('should extract author from domain name for 123av', async () => {
      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Title'),
        content: vi.fn().mockResolvedValue('<html><head><meta property="og:title" content="Test Title"></head><body></body></html>'),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      const url = 'https://123av.com/test-video';
      const info = await MissAVDownloader.getVideoInfo(url);

      expect(info.author).toBe('123av.com');
    });

    it('should preserve the 123av video route when navigating', async () => {
      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Title'),
        content: vi.fn().mockResolvedValue('<html><head><meta property="og:title" content="Test Title"></head><body></body></html>'),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      await MissAVDownloader.getVideoInfo('https://123av.com/en/v/fc2-ppv-2683017');

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://123av.com/en/v/fc2-ppv-2683017',
        expect.any(Object),
      );
    });

    it('should preserve the javxx video route when navigating', async () => {
      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Title'),
        content: vi.fn().mockResolvedValue('<html><head><meta property="og:title" content="Test Title"></head><body></body></html>'),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      await MissAVDownloader.getVideoInfo('https://javxx.com/en/v/fc2-ppv-2683017');

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://javxx.com/en/v/fc2-ppv-2683017',
        expect.any(Object),
      );
    });

    it('should preserve the missav route prefix when navigating', async () => {
      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Title'),
        content: vi.fn().mockResolvedValue('<html><head><meta property="og:title" content="Test Title"></head><body></body></html>'),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      await MissAVDownloader.getVideoInfo('https://missav.ai/dm30/en/juq-819-uncensored-leak');

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://missav.ai/dm30/en/juq-819-uncensored-leak',
        expect.any(Object),
      );
    });

    it('should navigate using the matched allowlisted origin for missav.ai', async () => {
      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Title'),
        content: vi
          .fn()
          .mockResolvedValue(
            '<html><head><meta property="og:title" content="Test Title"></head><body></body></html>',
          ),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      await MissAVDownloader.getVideoInfo('https://missav.ai/en/fc2-ppv-1627274');

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://missav.ai/en/fc2-ppv-1627274',
        expect.any(Object),
      );
    });

    it('should use the configured Puppeteer executable path override', async () => {
      process.env.PUPPETEER_EXECUTABLE_PATH = '/custom/chrome';

      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Title'),
        content: vi.fn().mockResolvedValue('<html><head><meta property="og:title" content="Test Title"></head><body></body></html>'),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      await MissAVDownloader.getVideoInfo('https://missav.ai/en/fc2-ppv-1627274');

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: '/custom/chrome',
        }),
      );
    });

    it('should fall back to a local Chrome install when no override is configured', async () => {
      vi.mocked(security.pathExistsTrustedSync).mockImplementation((targetPath: any) =>
        targetPath === expectedChromeFallbackPath,
      );

      const mockPage = {
        goto: vi.fn(),
        title: vi.fn().mockResolvedValue('Test Title'),
        content: vi.fn().mockResolvedValue('<html><head><meta property="og:title" content="Test Title"></head><body></body></html>'),
        close: vi.fn(),
      };
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      (puppeteer.launch as any).mockResolvedValue(mockBrowser);

      await MissAVDownloader.getVideoInfo('https://missav.ai/en/fc2-ppv-1627274');

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: expectedChromeFallbackPath,
        }),
      );
    });

    it('should block URLs with explicit port before browser launch', async () => {
      const info = await MissAVDownloader.getVideoInfo('https://missav.com:8443/test-video');

      expect(info.title).toBe('MissAV Video');
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });

    it('should block URLs with credentials before browser launch', async () => {
      const info = await MissAVDownloader.getVideoInfo('https://user:pass@missav.com/test-video');

      expect(info.title).toBe('MissAV Video');
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });
  });

  describe('downloadVideo – m3u8 wait behavior', () => {
    function makeTimeoutError(): Error {
      const err = new Error('Waiting for response failed: timeout 20000ms exceeded.');
      err.name = 'TimeoutError';
      return err;
    }

    function makeNavigationTimeoutError(): Error {
      const err = new Error('Navigation timeout of 60000 ms exceeded');
      err.name = 'TimeoutError';
      return err;
    }

    function buildPageMock(
      waitForResponseResult: 'timeout' | 'non-timeout' | 'success',
      requestCallback?: { capture: (cb: (req: { url(): string }) => void) => void },
      html = '<html><head></head><body></body></html>',
    ) {
      const mockResponse = { url: () => 'https://surrit.com/playlist.m3u8' };
      return {
        on: vi.fn((event: string, cb: (req: any) => void) => {
          if (event === 'request') requestCallback?.capture(cb);
          if (event === 'response' && capturedPlaylist.value !== null) {
            // What the browser received for the playlist it fetched itself.
            // `finalUrl` models a redirect: the body arrives under the URL the
            // request ended at, while the request listener saw where it started.
            cb({
              url: () => capturedPlaylistFinalUrl.value ?? 'https://surrit.com/playlist.m3u8',
              status: () => 200,
              headers: () => capturedPlaylistHeaders.value,
              text: async () => capturedPlaylist.value,
              request: () => ({
                redirectChain: () =>
                  capturedPlaylistFinalUrl.value
                    ? [{ url: () => 'https://surrit.com/playlist.m3u8' }]
                    : [],
              }),
            });
          }
        }),
        goto: vi.fn().mockResolvedValue(undefined),
        title: vi.fn().mockResolvedValue('Test Title'),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        waitForResponse: vi.fn().mockImplementation(() => {
          if (waitForResponseResult === 'timeout') return Promise.reject(makeTimeoutError());
          if (waitForResponseResult === 'non-timeout') return Promise.reject(new Error('Target closed'));
          return Promise.resolve(mockResponse);
        }),
        content: vi.fn().mockResolvedValue(html),
      };
    }

    describe('download integrity', () => {
      const url = 'https://missav.com/test-video';
      const release = vi.fn();
      let videoPath: string;
      let thumbnailPath: string;
      let stagingVideoPath: string | null;
      let producedOutput: boolean;

      beforeEach(() => {
        videoPath = path.join(VIDEOS_DIR, 'MissAV.TESTVIDEO-missavcom-2026_2.mp4');
        thumbnailPath = path.join(IMAGES_DIR, 'MissAV.TESTVIDEO-missavcom-2026_2.jpg');
        stagingVideoPath = null;
        vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue(undefined);
        vi.mocked(storageService.checkVideoDownloadBySourceId).mockReturnValue({ found: false });
        vi.mocked(verifyDownloadedMediaComplete).mockReset().mockResolvedValue({ complete: true });
        vi.mocked(puppeteer.launch).mockResolvedValue({
          newPage: vi.fn().mockResolvedValue(buildPageMock('success')),
          close: vi.fn().mockResolvedValue(undefined),
        } as any);
        vi.mocked(spawn).mockImplementation(() => createAutoClosingSpawnProc(0));
        vi.spyOn(outputPaths, 'planMissAvOutputPaths').mockImplementation(() => ({
          finalVideoFilename: path.basename(videoPath), newVideoPath: videoPath,
          finalThumbnailFilename: path.basename(thumbnailPath), newThumbnailPath: thumbnailPath,
          finalVideoWebPath: `/videos/${path.relative(VIDEOS_DIR, videoPath)}`,
          finalThumbnailWebPath: `/images/${path.relative(IMAGES_DIR, thumbnailPath)}`,
          releaseOutputReservation: release,
        }));
        vi.spyOn(allocator, 'planOwnedReplacementStagingPathSync').mockReturnValue(null);
        vi.spyOn(allocator, 'replaceOwnedFileWithBackupSync').mockImplementation(() => {});
        // The downloader now refuses to publish an output it cannot find, so the
        // harness has to model yt-dlp actually having written one. `producedOutput`
        // is the switch a test flips to simulate a run that wrote nothing.
        producedOutput = true;
        vi.spyOn(security, 'pathExistsSafeSync').mockImplementation(
          candidate => producedOutput && (candidate === videoPath || candidate === stagingVideoPath),
        );
        vi.spyOn(metadata, 'getVideoDuration').mockResolvedValue(600);
        vi.spyOn(metadata, 'getVideoDimensions').mockResolvedValue(null);
        vi.spyOn(mediaServer, 'syncMediaServerArtifactsForRecord').mockImplementation(() => {});
        vi.spyOn(mediaServer, 'removeMediaServerArtifactsForVideo').mockImplementation(() => {});
      });

      afterEach(() => {
        vi.restoreAllMocks();
        vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue(undefined);
        vi.mocked(storageService.updateVideo).mockReset();
        vi.mocked(verifyDownloadedMediaComplete).mockReset().mockResolvedValue({ complete: true });
      });

      function stageReplacement() {
        const stage = path.join(VIDEOS_DIR, '.mytube-redownload-integrity.mp4');
        stagingVideoPath = stage;
        const thumbStage = path.join(IMAGES_DIR, '.mytube-redownload-integrity.jpg');
        const existing = { id: 'existing', title: 'Existing video', mediaType: 'video' as const,
          sourceUrl: url, createdAt: '2026-01-01T00:00:00.000Z',
          videoFilename: path.basename(videoPath), videoPath: `/videos/${path.basename(videoPath)}` };
        vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue(existing);
        vi.mocked(storageService.updateVideo).mockImplementation((id, updates) => ({ ...existing, ...updates, id }));
        vi.mocked(allocator.planOwnedReplacementStagingPathSync)
          .mockReturnValueOnce({ stagingPath: stage, stagingRootDir: VIDEOS_DIR,
            finalPath: videoPath, destinationRootDir: VIDEOS_DIR })
          .mockReturnValueOnce({ stagingPath: thumbStage, stagingRootDir: IMAGES_DIR,
            finalPath: thumbnailPath, destinationRootDir: IMAGES_DIR });
        return { stage, thumbStage };
      }

      function expectNotPublished() {
        expect(storageService.saveVideo).not.toHaveBeenCalled();
        expect(storageService.updateVideo).not.toHaveBeenCalled();
        expect(storageService.persistDownloadedMediaIdentity).not.toHaveBeenCalled();
        expect(allocator.replaceOwnedFileWithBackupSync).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledOnce();
      }

      it('refuses to publish when yt-dlp exited cleanly but wrote no file', async () => {
        // The completeness probe is fail-open, so it reports an unreadable file as
        // unknown rather than broken and cannot answer this on its own.
        producedOutput = false;

        await expect(MissAVDownloader.downloadVideo(url)).rejects.toThrow(
          'MissAV download produced no output',
        );

        expect(verifyDownloadedMediaComplete).not.toHaveBeenCalled();
        expect(storageService.saveVideo).not.toHaveBeenCalled();
        expect(storageService.persistDownloadedMediaIdentity).not.toHaveBeenCalled();
        expect(storageService.updateVideo).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledOnce();
      });

      it('does not replace an existing library copy when the re-download wrote nothing', async () => {
        stageReplacement();
        producedOutput = false;

        await expect(MissAVDownloader.downloadVideo(url)).rejects.toThrow(
          'MissAV download produced no output',
        );

        expect(allocator.replaceOwnedFileWithBackupSync).not.toHaveBeenCalled();
        expect(storageService.updateVideo).not.toHaveBeenCalled();
      });

      it('passes the playlist duration to the completeness check', async () => {
        playlistBody.value = [
          '#EXTM3U', '#EXTINF:10.000,', 'a.ts', '#EXTINF:14.500,', 'b.ts', '#EXT-X-ENDLIST', '',
        ].join('\n');

        await MissAVDownloader.downloadVideo(url);

        expect(verifyDownloadedMediaComplete).toHaveBeenCalledExactlyOnceWith(videoPath, {
          sourceDurationSeconds: 24.5, userConfig: {},
        });
      });

      it('uses the playlist body the browser already fetched', async () => {
        // The CDN 403s a plain Node request, so a direct fetch would yield
        // nothing; axios must not be consulted at all for this URL.
        capturedPlaylist.value = [
          '#EXTM3U', '#EXTINF:30.000,', 'a.ts', '#EXTINF:30.000,', 'b.ts', '#EXT-X-ENDLIST', '',
        ].join('\n');
        playlistBody.value = null;

        await MissAVDownloader.downloadVideo(url);

        expect(verifyDownloadedMediaComplete).toHaveBeenCalledExactlyOnceWith(videoPath, {
          sourceDurationSeconds: 60, userConfig: {},
        });
        expect(axios.get).not.toHaveBeenCalled();
      });

      it('falls back to an unknown source duration when the playlist cannot be read', async () => {
        // Degrades to the track comparison rather than guessing: a source
        // duration wrong in the long direction would reject good downloads.
        playlistBody.value = null;

        await MissAVDownloader.downloadVideo(url);

        expect(verifyDownloadedMediaComplete).toHaveBeenCalledExactlyOnceWith(videoPath, {
          sourceDurationSeconds: null, userConfig: {},
        });
      });

      it('finds a captured body under the URL the request started at', async () => {
        // The request listener records the pre-redirect URL, so that is what the
        // selector picks; the body arrives under the post-redirect URL. Keyed
        // only by the latter, the lookup would miss and the direct fallback
        // would then refuse the redirect, leaving no duration at all.
        capturedPlaylistFinalUrl.value = 'https://cdn.surrit.com/final/playlist.m3u8';
        capturedPlaylist.value = [
          '#EXTM3U', '#EXTINF:20.000,', 'a.ts', '#EXTINF:20.000,', 'b.ts', '#EXT-X-ENDLIST', '',
        ].join('\n');

        await MissAVDownloader.downloadVideo(url);

        expect(verifyDownloadedMediaComplete).toHaveBeenCalledExactlyOnceWith(videoPath, {
          sourceDurationSeconds: 40, userConfig: {},
        });
        expect(axios.get).not.toHaveBeenCalled();
      });

      it('does not materialize a body that declares itself oversized', async () => {
        capturedPlaylistHeaders.value = { 'content-length': String(64 * 1024 * 1024) };
        // A body that would otherwise have produced a 5s duration.
        capturedPlaylist.value = '#EXTM3U\n#EXTINF:5.000,\na.ts\n#EXT-X-ENDLIST\n';

        await MissAVDownloader.downloadVideo(url);

        // Refused before reading, so no duration and a direct retry instead.
        expect(verifyDownloadedMediaComplete).toHaveBeenCalledExactlyOnceWith(videoPath, {
          sourceDurationSeconds: null, userConfig: {},
        });
      });

      it('does not follow redirects when fetching a playlist directly', async () => {
        // The origin check runs before the request, so a same-origin rendition
        // answering 302 with an internal Location would otherwise be followed.
        playlistBody.value = ['#EXTM3U', '#EXTINF:5.000,', 'a.ts', '#EXT-X-ENDLIST', ''].join('\n');

        await MissAVDownloader.downloadVideo(url);

        expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
          maxRedirects: 0,
        }));
      });

      it('honors an explicit direct connection for the playlist fetch', async () => {
        vi.mocked(getUserYtDlpConfig).mockReturnValue({ proxy: '' });
        vi.mocked(getAxiosProxyConfig).mockReturnValue({ proxy: false });

        await MissAVDownloader.downloadVideo(url);

        expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
          proxy: false,
        }));
      });

      it('checks the actual output before saving', async () => {
        await MissAVDownloader.downloadVideo(url);
        expect(verifyDownloadedMediaComplete).toHaveBeenCalledExactlyOnceWith(videoPath, {
          sourceDurationSeconds: null, userConfig: {},
        });
        expect(storageService.persistDownloadedMediaIdentity).toHaveBeenCalledOnce();
        expect(cleanupTemporaryFiles).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledOnce();
      });

      it.each(['collision', 'template'])('cleans only allocated paths after rejecting a %s output', async (mode) => {
        if (mode === 'template') {
          videoPath = path.join(VIDEOS_DIR, 'Author/Season/Episode.mp4');
          thumbnailPath = path.join(IMAGES_DIR, 'Author/Season/Episode.jpg');
        }
        vi.mocked(verifyDownloadedMediaComplete).mockResolvedValue({
          complete: false, reason: 'video is 600s but audio is 100s',
        });
        await expect(MissAVDownloader.downloadVideo(url)).rejects.toThrow('MissAV download is incomplete');
        expect(cleanupTemporaryFiles).toHaveBeenCalledExactlyOnceWith(videoPath);
        // Exact call sets also exclude recomputed legacy paths belonging to another item.
        expect(safeRemove).toHaveBeenCalledExactlyOnceWith(thumbnailPath);
        expectNotPublished();
      });

      it('probes and discards a rejected staging file without touching the library copy', async () => {
        const { stage, thumbStage } = stageReplacement();
        vi.mocked(verifyDownloadedMediaComplete).mockResolvedValue({ complete: false, reason: 'short audio' });
        await expect(MissAVDownloader.downloadVideo(url)).rejects.toThrow('short audio');
        expect(verifyDownloadedMediaComplete).toHaveBeenCalledWith(stage, expect.any(Object));
        expect(cleanupTemporaryFiles).toHaveBeenCalledExactlyOnceWith(stage);
        expect(safeRemove).toHaveBeenCalledExactlyOnceWith(thumbStage);
        expectNotPublished();
      });

      it.each([
        { replacement: false, trigger: 'callback' },
        { replacement: true, trigger: 'callback' },
        { replacement: false, trigger: 'active-list' },
      ])('honors cancellation while the probe is pending: %o', async ({ replacement, trigger }) => {
        const pendingVideo = replacement ? stageReplacement().stage : videoPath;
        let finishProbe!: (value: { complete: boolean }) => void;
        vi.mocked(verifyDownloadedMediaComplete).mockReturnValue(new Promise(resolve => { finishProbe = resolve; }));
        let cancel!: () => void;
        const result = MissAVDownloader.downloadVideo(url, 'integrity-test', fn => { cancel = fn; });
        const rejection = expect(result).rejects.toThrow('Download cancelled by user');
        await vi.waitFor(() => expect(verifyDownloadedMediaComplete).toHaveBeenCalledOnce());
        if (trigger === 'callback') await cancel();
        else vi.mocked(isDownloadActive).mockReturnValue(false);
        finishProbe({ complete: true }); // Includes the probe's fail-open result.
        await rejection;
        expect(cleanupTemporaryFiles).toHaveBeenCalledExactlyOnceWith(pendingVideo);
        expectNotPublished();
      });

      it('does not delete a published replacement if later metadata persistence fails', async () => {
        const { stage, thumbStage } = stageReplacement();
        vi.mocked(storageService.persistDownloadedMediaIdentity).mockImplementationOnce(() => { throw new Error('database failed'); });
        await expect(MissAVDownloader.downloadVideo(url)).rejects.toThrow('database failed');
        expect(allocator.replaceOwnedFileWithBackupSync).toHaveBeenCalledOnce();
        expect(cleanupTemporaryFiles).toHaveBeenCalledExactlyOnceWith(stage);
        expect(safeRemove).toHaveBeenCalledExactlyOnceWith(thumbStage);
        expect(release).toHaveBeenCalledOnce();
      });

      it.each(['identity', 'artifacts', 'row-update'])('protects a changed filename at the row-update boundary: %s failure', async (failure) => {
        const oldPath = path.join(VIDEOS_DIR, 'old-title.mp4');
        const existing = { id: 'existing', title: 'Old title', sourceUrl: url,
          createdAt: '2026-01-01T00:00:00.000Z', videoFilename: 'old-title.mp4',
          videoPath: '/videos/old-title.mp4' };
        vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue(existing);
        vi.mocked(storageService.updateVideo).mockImplementation((id, updates) => ({ ...existing, ...updates, id }));
        vi.mocked(puppeteer.launch).mockResolvedValue({
          newPage: vi.fn().mockResolvedValue(buildPageMock('success', undefined,
            '<meta property="og:image" content="https://example.com/cover.jpg">')),
          close: vi.fn().mockResolvedValue(undefined),
        } as any);
        vi.spyOn(MissAVDownloader.prototype as any, 'downloadThumbnail').mockResolvedValue(true);
        // The download wrote its output and the superseded copy is still on disk;
        // both must read as existing or the downloader's no-output gate fires first.
        vi.spyOn(security, 'pathExistsSafeSync').mockImplementation(
          candidate => candidate === oldPath || candidate === videoPath,
        );
        const unlink = vi.spyOn(security, 'unlinkSafeSync').mockImplementation(() => {});
        const deleteMirror = vi.spyOn(thumbnailMirror, 'deleteSmallThumbnailMirrorSync').mockImplementation(() => {});
        if (failure === 'identity') {
          vi.mocked(storageService.persistDownloadedMediaIdentity).mockImplementationOnce(() => { throw new Error('identity failed'); });
        } else if (failure === 'artifacts') {
          vi.mocked(mediaServer.removeMediaServerArtifactsForVideo).mockImplementationOnce(() => { throw new Error('artifacts failed'); });
        } else {
          vi.mocked(storageService.updateVideo).mockReturnValueOnce(null);
        }

        await expect(MissAVDownloader.downloadVideo(url)).rejects.toThrow(
          failure === 'row-update' ? 'Failed to update existing MissAV video' : `${failure} failed`,
        );

        expect(allocator.planOwnedReplacementStagingPathSync).toHaveReturnedWith(null);
        expect(allocator.replaceOwnedFileWithBackupSync).not.toHaveBeenCalled();
        expect(storageService.updateVideo).toHaveBeenCalledWith(existing.id, expect.objectContaining({
          videoPath: `/videos/${path.basename(videoPath)}`,
          thumbnailPath: `/images/${path.basename(thumbnailPath)}`,
        }));
        if (failure === 'row-update') {
          expect(unlink).not.toHaveBeenCalled();
          expect(cleanupTemporaryFiles).toHaveBeenCalledExactlyOnceWith(videoPath);
          expect(safeRemove).toHaveBeenCalledExactlyOnceWith(thumbnailPath);
        } else {
          // The old copy is already gone; deleting the new output would lose both.
          expect(unlink).toHaveBeenCalledExactlyOnceWith(oldPath, VIDEOS_DIR);
          expect(cleanupTemporaryFiles).not.toHaveBeenCalled();
          expect(safeRemove).not.toHaveBeenCalled();
          expect(deleteMirror).not.toHaveBeenCalled();
        }
        expect(release).toHaveBeenCalledOnce();
      });

      it.each(['collision', 'template'])('preserves a persisted fresh %s download after organization fails', async (mode) => {
        if (mode === 'template') {
          videoPath = path.join(VIDEOS_DIR, 'Author/Season/Episode.mp4');
          thumbnailPath = path.join(IMAGES_DIR, 'Author/Season/Episode.jpg');
        }
        vi.mocked(storageService.getSettings).mockReturnValue({ authorOrganizationMode: 'author_collection_linked' });
        vi.mocked(puppeteer.launch).mockResolvedValue({
          newPage: vi.fn().mockResolvedValue(buildPageMock('success', undefined,
            '<meta property="og:image" content="https://example.com/cover.jpg">')),
          close: vi.fn().mockResolvedValue(undefined),
        } as any);
        vi.spyOn(MissAVDownloader.prototype as any, 'downloadThumbnail').mockResolvedValue(true);
        const deleteMirror = vi.spyOn(thumbnailMirror, 'deleteSmallThumbnailMirrorSync');
        vi.mocked(storageService.organizeVideoByAuthor).mockImplementationOnce(() => { throw new Error('organization failed'); });

        await expect(MissAVDownloader.downloadVideo(url)).rejects.toThrow('organization failed');

        expect(storageService.persistDownloadedMediaIdentity).toHaveBeenCalledWith(expect.objectContaining({
          video: expect.objectContaining({ thumbnailFilename: path.basename(thumbnailPath) }),
        }));
        expect(cleanupTemporaryFiles).not.toHaveBeenCalled();
        expect(safeRemove).not.toHaveBeenCalled();
        expect(deleteMirror).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledOnce();
      });

      it('does not delete a persisted fresh video through a stale cancel callback', async () => {
        let cancel!: () => void;
        await MissAVDownloader.downloadVideo(url, undefined, fn => { cancel = fn; });
        expect(storageService.persistDownloadedMediaIdentity).toHaveBeenCalledOnce();

        await cancel();

        expect(cleanupTemporaryFiles).not.toHaveBeenCalled();
        expect(safeRemove).not.toHaveBeenCalled();
      });

      it('still discards a fresh download when persistence fails', async () => {
        vi.mocked(storageService.persistDownloadedMediaIdentity).mockImplementationOnce(() => { throw new Error('database failed'); });
        await expect(MissAVDownloader.downloadVideo(url)).rejects.toThrow('database failed');
        expect(cleanupTemporaryFiles).toHaveBeenCalledExactlyOnceWith(videoPath);
        expect(safeRemove).toHaveBeenCalledExactlyOnceWith(thumbnailPath);
      });
    });

    it('does not report the interstitial status after a challenge cleared', async () => {
      const mockPage = buildPageMock('timeout');
      // 403 is the interstitial's own status; it navigates again once cleared,
      // so quoting it here would blame a block that was already got past.
      mockPage.goto = vi.fn().mockResolvedValue({ status: () => 403 });
      mockPage.title = vi.fn().mockResolvedValue('Just a moment...');
      mockPage.waitForFunction = vi.fn().mockResolvedValue(undefined);
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      const error = await MissAVDownloader.downloadVideo(
        'https://missav.com/test-video',
      ).catch((e: Error) => e);

      expect((error as Error).message).not.toContain('HTTP 403');
      expect((error as Error).message).toContain('challenge was served and cleared');
    });

    it('reports the response status rather than assuming the page was served fine', async () => {
      const mockPage = buildPageMock('timeout');
      // An origin error page or a WAF denial without our markers reaches this
      // branch too, so the diagnosis must not claim the fetch went fine. The
      // status is the one fact available.
      mockPage.goto = vi.fn().mockResolvedValue({ status: () => 403 });
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.com/test-video'),
      ).rejects.toThrow('(HTTP 403)');
    });

    it('does not blame Cloudflare when the page loaded but the player never started', async () => {
      const mockPage = buildPageMock('timeout');
      // A normal page behind Cloudflare carries its bot-management beacon. That
      // used to match the challenge check, which only runs once no m3u8 was
      // captured - so a player that never started was reported as a block.
      mockPage.content = vi.fn().mockResolvedValue(
        '<html><head><meta property="og:title" content="TEST"></head><body>' +
          '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>' +
          '</body></html>',
      );
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.com/test-video'),
      ).rejects.toThrow('returned no video stream URL');
    });

    it('silences TimeoutError and falls through to the no-stream error', async () => {
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.com/test-video'),
      ).rejects.toThrow('returned no video stream URL');

      expect(mockPage.waitForResponse).toHaveBeenCalledOnce();
      expect(cleanupTemporaryFiles).not.toHaveBeenCalled();
      expect(safeRemove).not.toHaveBeenCalled();
    });

    it('preserves the 123av /v/ route during download navigation', async () => {
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://123av.com/en/v/fc2-ppv-2683017'),
      ).rejects.toThrow('returned no video stream URL');

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://123av.com/en/v/fc2-ppv-2683017',
        expect.any(Object),
      );
    });

    it('preserves the javxx /v/ route during download navigation', async () => {
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://javxx.com/en/v/fc2-ppv-2683017'),
      ).rejects.toThrow('returned no video stream URL');

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://javxx.com/en/v/fc2-ppv-2683017',
        expect.any(Object),
      );
    });

    it('preserves the missav route prefix during download navigation', async () => {
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.ai/dm30/en/juq-819-uncensored-leak'),
      ).rejects.toThrow('returned no video stream URL');

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://missav.ai/dm30/en/juq-819-uncensored-leak',
        expect.any(Object),
      );
    });

    it('resolves the row to replace by source identity, not by URL string', async () => {
      // The duplicate gate keys on (sourceVideoId, platform, mediaType), so a
      // forced re-download it let through must resolve the same row here even
      // when the URL is spelled differently - another mirror, a fragment, a
      // locale segment. Resolving by exact URL missed it and inserted a
      // duplicate beside the row the download meant to replace.
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      vi.mocked(storageService.checkVideoDownloadBySourceId).mockReturnValue({
        found: true,
        status: 'exists',
        videoId: 'local-1',
      } as any);
      vi.mocked(storageService.getVideoById).mockReturnValue({
        id: 'local-1',
        mediaType: 'video',
        // Stored on a different mirror, with a fragment.
        sourceUrl: 'https://missav.ws/dm30/juq-819-uncensored-leak#frag',
        videoPath: '/videos/Episode.mp4',
      } as any);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.ai/dm30/en/juq-819-uncensored-leak'),
      ).rejects.toThrow('returned no video stream URL');

      expect(storageService.checkVideoDownloadBySourceId).toHaveBeenCalledWith(
        'juq-819-uncensored-leak',
        'missav',
        'video',
      );
      // Identity answered, so the URL lookup is never consulted.
      expect(storageService.getVideoBySourceUrl).not.toHaveBeenCalled();
    });

    it('falls back to the URL lookup when nothing tracks the source id', async () => {
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      vi.mocked(storageService.checkVideoDownloadBySourceId).mockReturnValue({
        found: false,
      } as any);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.ai/dm30/en/juq-819-uncensored-leak'),
      ).rejects.toThrow('returned no video stream URL');

      // Rows predating the tracking table are still reachable.
      expect(storageService.getVideoBySourceUrl).toHaveBeenCalledWith(
        'https://missav.ai/dm30/en/juq-819-uncensored-leak',
        'video',
      );
    });

    it('re-throws non-TimeoutError from waitForResponse', async () => {
      const mockPage = buildPageMock('non-timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.com/test-video'),
      ).rejects.toThrow('Target closed');

      expect(mockPage.waitForResponse).toHaveBeenCalledOnce();
      // Verify the finally block always closes the browser, even on error paths.
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('does not mask the original error when browser.close() also fails', async () => {
      const mockPage = buildPageMock('non-timeout');
      const mockBrowser = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockRejectedValue(new Error('Browser already crashed')),
      };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      // The original 'Target closed' error must propagate, not the close error.
      await expect(
        MissAVDownloader.downloadVideo('https://missav.com/test-video'),
      ).rejects.toThrow('Target closed');

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('incorporates waitForResponse URL into m3u8 candidate selection', async () => {
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      // spawn exits with code 1 (top-level mock); swallow the resulting error
      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      // The URL resolved by waitForResponse must have been selected and forwarded to yt-dlp
      expect(
        vi.mocked(spawn).mock.calls.some(
          ([, args]) => Array.isArray(args) && args.includes('https://surrit.com/playlist.m3u8'),
        ),
      ).toBe(true);
    });

    it('uses the global --impersonate flag (not the generic extractor-arg) to bypass the Cloudflare CDN block', async () => {
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      // spawn exits with code 1 (top-level mock); swallow the resulting error
      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      // The global `--impersonate` flag impersonates the whole session, including
      // the m3u8 manifest/segment fetches. The `generic:impersonate` extractor-arg
      // only covers the initial webpage fetch and leaves the m3u8 download to 403,
      // so it must NOT be used here.
      expect(flags.impersonate).toBe('chrome');
      expect(flags.extractorArgs).toBeUndefined();
      // Referer is the only extra header the CDN needs once impersonation is on;
      // the earlier Origin/Sec-Fetch headers were a red herring and are dropped.
      expect(flags.addHeader).toEqual(['Referer:https://missav.com/']);
    });

    it('omits --impersonate when curl_cffi is unavailable instead of hard-failing', async () => {
      (isYtDlpImpersonateAvailable as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      // spawn exits with code 1 (top-level mock); swallow the resulting error
      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      // Without curl_cffi, `--impersonate` would error ("target not available"),
      // so the flag must be omitted and the download attempted unimpersonated.
      expect(flags.impersonate).toBeUndefined();
      expect(flags.addHeader).toEqual(['Referer:https://missav.com/']);
    });

    it('does not override the browser User-Agent', async () => {
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      // A hardcoded macOS Chrome string used to be forced here, but Chromium
      // keeps reporting the real platform through the Sec-CH-UA-Platform hint,
      // navigator.platform and the WebGL renderer - Linux, in Docker. A macOS
      // User-Agent beside Linux client hints in one request contradicts itself,
      // which is easier to detect than an honest string, not harder.
      const launchOptions = (puppeteer.launch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(
        (launchOptions?.args ?? []).some((arg: string) => arg.startsWith('--user-agent')),
      ).toBe(false);
    });

    it('tells Chromium to connect directly when proxyOnlyYoutube took the download off the proxy', async () => {
      (getUserYtDlpConfig as ReturnType<typeof vi.fn>).mockReturnValue({ proxy: '' });
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      // Chromium reads http_proxy from the same environment yt-dlp does, so
      // without this the page load that discovers the m3u8 would keep taking
      // the proxy the download it feeds has just been taken off - and a proxy
      // that cannot reach MissAV fails here, before yt-dlp ever runs.
      const launchOptions = (puppeteer.launch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(launchOptions?.args).toContain('--no-proxy-server');
    });

    it('leaves Chromium on the ambient proxy configuration when no direct connection was requested', async () => {
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const launchOptions = (puppeteer.launch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(launchOptions?.args).not.toContain('--no-proxy-server');
    });

    it('fetches HLS fragments in parallel by default', async () => {
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      // yt-dlp defaults --concurrent-fragments to 1, which serialises every one
      // of a stream's hundreds of fragments on its own round trip. Behind an
      // outbound proxy that alone collapses throughput (issue #446).
      expect(flags.N).toBe(4);
    });

    it('honours a user-configured --concurrent-fragments', async () => {
      (getUserYtDlpConfig as ReturnType<typeof vi.fn>).mockReturnValue({ N: '8' });
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      // The MissAV flag set is built from the network config, which carries no
      // -N, so the user's own setting used to be dropped here.
      expect(flags.N).toBe(8);
    });

    it('falls back to the default when the configured fragment count is not a number', async () => {
      (getUserYtDlpConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        concurrentFragments: 'lots',
      });
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      // Forwarding it would make yt-dlp reject the whole invocation, breaking a
      // download that works today.
      expect(flags.N).toBe(4);
    });

    it('uses the app preferred container for MissAV when user mergeOutputFormat is not set', async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        preferredVideoContainer: 'mkv',
      } as any);
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      expect(flags.mergeOutputFormat).toBe('mkv');
      expect(flags.output).toMatch(/\.mkv$/);
    });

    it('keeps MP4 for MissAV when the app preferred container is WebM', async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        preferredVideoContainer: 'webm',
      } as any);
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      expect(flags.mergeOutputFormat).toBe('mp4');
      expect(flags.output).toMatch(/\.mp4$/);
    });

    it('keeps explicit MissAV mergeOutputFormat ahead of the app preferred container', async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        preferredVideoContainer: 'mkv',
      } as any);
      (getUserYtDlpConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        mergeOutputFormat: 'mp4',
      });
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      expect(flags.mergeOutputFormat).toBe('mp4');
      expect(flags.output).toMatch(/\.mp4$/);
    });

    it('keeps explicit MissAV WebM mergeOutputFormat ahead of the app compatibility guard', async () => {
      vi.mocked(storageService.getSettings).mockReturnValue({
        preferredVideoContainer: 'webm',
      } as any);
      (getUserYtDlpConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        mergeOutputFormat: 'webm',
      });
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      const calls = (flagsToArgs as ReturnType<typeof vi.fn>).mock.calls;
      const flags = calls[calls.length - 1]?.[0] ?? {};

      expect(flags.mergeOutputFormat).toBe('webm');
      expect(flags.output).toMatch(/\.webm$/);
    });

    it('treats SIGTERM from user cancellation as DownloadCancelledError', async () => {
      const mockPage = buildPageMock('success');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);
      (isCancellationError as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

      const mockChild = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        killed: boolean;
        exitCode: number | null;
        pid: number;
        kill: ReturnType<typeof vi.fn>;
      };
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.killed = false;
      mockChild.exitCode = null;
      mockChild.pid = 4242;
      mockChild.kill = vi.fn((signal?: NodeJS.Signals) => {
        mockChild.killed = true;
        mockChild.emit('close', null, signal ?? 'SIGTERM');
        return true;
      });
      (spawn as ReturnType<typeof vi.fn>).mockImplementation((command: string, args?: string[]) => {
        const list = Array.isArray(args) ? args : [];
        if (
          list.includes('--version') ||
          list.includes('--help') ||
          list.includes('--list-impersonate-targets')
        ) {
          const probe: any = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            killed: false,
            exitCode: 0,
            kill: vi.fn(),
            on: vi.fn(),
            once: vi.fn(),
          };
          const finish = (cb: (code: number) => void) => queueMicrotask(() => cb(0));
          probe.on.mockImplementation((event: string, cb: (code: number) => void) => {
            if (event === 'close') finish(cb);
            return probe;
          });
          probe.once.mockImplementation((event: string, cb: (code: number) => void) => {
            if (event === 'close') finish(cb);
            return probe;
          });
          return probe;
        }
        return mockChild;
      });

      let cancelDownload: (() => void | Promise<void>) | undefined;
      const downloadPromise = MissAVDownloader.downloadVideo(
        'https://missav.com/test-video',
        'cancel-1',
        (cancel) => {
          cancelDownload = cancel;
        },
      );

      await vi.waitFor(() => {
        if (!cancelDownload) {
          throw new Error('cancel callback not registered yet');
        }
      });
      await cancelDownload?.();

      await expect(downloadPromise).rejects.toThrow('Download cancelled by user');
      expect(mockChild.kill).toHaveBeenCalled();
      expect(cleanupTemporaryFiles).toHaveBeenCalledTimes(1);
    });

    it('skips waitForResponse when m3u8 is captured during navigation', async () => {
      let capturedCb: ((req: { url(): string }) => void) | null = null;
      const requestHook = { capture: (cb: (req: { url(): string }) => void) => { capturedCb = cb; } };

      const mockPage = buildPageMock('timeout', requestHook);
      // Fire the m3u8 request inside goto so it is captured before the waitForResponse check
      mockPage.goto.mockImplementation(async () => {
        capturedCb?.({ url: () => 'https://surrit.com/playlist.m3u8' });
      });

      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      // download may fail at yt-dlp stage; we only care about the waitForResponse assertion
      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      expect(mockPage.waitForResponse).not.toHaveBeenCalled();
    });

    it('continues with captured m3u8 URLs when navigation times out after capture', async () => {
      let capturedCb: ((req: { url(): string }) => void) | null = null;
      const requestHook = { capture: (cb: (req: { url(): string }) => void) => { capturedCb = cb; } };

      const mockPage = buildPageMock('timeout', requestHook);
      mockPage.goto.mockImplementation(async () => {
        capturedCb?.({ url: () => 'https://surrit.com/playlist.m3u8' });
        throw makeNavigationTimeoutError();
      });

      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await MissAVDownloader.downloadVideo('https://missav.com/test-video').catch(() => {});

      expect(mockPage.waitForResponse).not.toHaveBeenCalled();
      expect(
        vi.mocked(spawn).mock.calls.some(
          ([, args]) => Array.isArray(args) && args.includes('https://surrit.com/playlist.m3u8'),
        ),
      ).toBe(true);
      const downloadArgs = vi.mocked(spawn).mock.calls.find(
        ([, args]) => Array.isArray(args) && args.includes('https://surrit.com/playlist.m3u8'),
      )?.[1] as string[] | undefined;
      expect(downloadArgs?.slice(-2)).toEqual([
        '--',
        'https://surrit.com/playlist.m3u8',
      ]);
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('re-throws navigation timeouts when no m3u8 URL was captured', async () => {
      const mockPage = buildPageMock('timeout');
      mockPage.goto.mockRejectedValue(makeNavigationTimeoutError());

      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.com/test-video'),
      ).rejects.toThrow('Navigation timeout of 60000 ms exceeded');

      expect(mockPage.waitForResponse).not.toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('logs failed browser requests before surfacing an early connection reset', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      let requestFailedCb: ((req: {
        url(): string;
        resourceType(): string;
        method(): string;
        failure(): { errorText: string };
      }) => void) | null = null;

      const resetError = new Error('net::ERR_CONNECTION_RESET at https://missav.com/test-video');
      const mockPage = {
        on: vi.fn((event: string, cb: typeof requestFailedCb) => {
          if (event === 'requestfailed') requestFailedCb = cb;
        }),
        goto: vi.fn().mockImplementation(async () => {
          requestFailedCb?.({
            url: () => 'https://missav.com/test-video',
            resourceType: () => 'document',
            method: () => 'GET',
            failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET' }),
          });
          throw resetError;
        }),
        title: vi.fn().mockResolvedValue('Test Title'),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        waitForResponse: vi.fn(),
        content: vi.fn().mockResolvedValue('<html><head></head><body></body></html>'),
      };
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      try {
        await expect(
          MissAVDownloader.downloadVideo('https://missav.com/test-video'),
        ).rejects.toThrow('net::ERR_CONNECTION_RESET');

        expect(warnSpy).toHaveBeenCalledWith(
          '[MissAV request failed] resource=document method=GET error=net::ERR_CONNECTION_RESET https://missav.com/test-video',
        );
        expect(mockPage.waitForResponse).not.toHaveBeenCalled();
        expect(mockBrowser.close).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('surfaces a Cloudflare challenge as a specific error', async () => {
      const mockPage = buildPageMock(
        'timeout',
        undefined,
        '<html><head><title>Just a moment...</title></head><body>Performing security verification<input name="cf-turnstile-response"></body></html>',
      );
      mockPage.title.mockResolvedValue('Just a moment...');

      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.ai/dm30/en/juq-819-uncensored-leak'),
      ).rejects.toThrow('MissAV access is blocked by Cloudflare verification');

      expect(mockPage.waitForFunction).toHaveBeenCalledOnce();
    });

    it('surfaces a Cloudflare timeout during navigation as a specific error', async () => {
      const mockPage = buildPageMock(
        'timeout',
        undefined,
        '<html><head><title>Just a moment...</title></head><body>Performing security verification<input name="cf-turnstile-response"></body></html>',
      );
      const waitTimeoutError = new Error('Waiting failed');
      waitTimeoutError.name = 'TimeoutError';
      mockPage.title.mockResolvedValue('Just a moment...');
      mockPage.waitForFunction.mockRejectedValue(waitTimeoutError);

      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.ai/dm30/en/juq-819-uncensored-leak'),
      ).rejects.toThrow('MissAV access is blocked by Cloudflare verification');
    });
  });
});
