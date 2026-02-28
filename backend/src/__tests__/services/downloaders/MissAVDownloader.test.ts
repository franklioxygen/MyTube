
import { spawn } from 'child_process';
import puppeteer from 'puppeteer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissAVDownloader } from '../../../services/downloaders/MissAVDownloader';

vi.mock('puppeteer');
vi.mock('../../../services/storageService', () => ({
  saveVideo: vi.fn(),
  updateActiveDownload: vi.fn(),
  getSettings: vi.fn().mockReturnValue({}),
  addVideoToAuthorCollection: vi.fn().mockReturnValue(null),
  getVideoById: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../utils/ytDlpUtils', () => ({
  getUserYtDlpConfig: vi.fn().mockReturnValue({}),
  getNetworkConfigFromUserConfig: vi.fn().mockReturnValue({}),
  flagsToArgs: vi.fn().mockReturnValue([]),
  getAxiosProxyConfig: vi.fn().mockReturnValue({}),
  InvalidProxyError: class InvalidProxyError extends Error {},
}));
vi.mock('../../../utils/downloadUtils', () => ({
  cleanupTemporaryFiles: vi.fn().mockResolvedValue(undefined),
  safeRemove: vi.fn().mockResolvedValue(undefined),
  isCancellationError: vi.fn().mockReturnValue(false),
}));
vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(1); // immediate non-zero exit; caught by .catch(() => {})
    }),
    kill: vi.fn(),
  }),
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

describe('MissAVDownloader', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getVideoInfo', () => {
    it('should extract author from domain name', async () => {
      const mockPage = {
        goto: vi.fn(),
        waitForNavigation: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
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

    it('should extract author from domain name for 123av', async () => {
      const mockPage = {
        goto: vi.fn(),
        waitForNavigation: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
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

    it('should navigate using the matched allowlisted origin for missav.ai', async () => {
      const mockPage = {
        goto: vi.fn(),
        waitForNavigation: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
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
        'https://missav.ai',
        expect.any(Object),
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

    function buildPageMock(
      waitForResponseResult: 'timeout' | 'non-timeout' | 'success',
      requestCallback?: { capture: (cb: (req: { url(): string }) => void) => void },
    ) {
      const mockResponse = { url: () => 'https://surrit.com/playlist.m3u8' };
      return {
        on: vi.fn((event: string, cb: (req: { url(): string }) => void) => {
          if (event === 'request') requestCallback?.capture(cb);
        }),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForNavigation: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForResponse: vi.fn().mockImplementation(() => {
          if (waitForResponseResult === 'timeout') return Promise.reject(makeTimeoutError());
          if (waitForResponseResult === 'non-timeout') return Promise.reject(new Error('Target closed'));
          return Promise.resolve(mockResponse);
        }),
        content: vi.fn().mockResolvedValue('<html><head></head><body></body></html>'),
      };
    }

    it('silences TimeoutError and falls through to "Could not find m3u8 URL"', async () => {
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.com/test-video'),
      ).rejects.toThrow('Could not find m3u8 URL in page source or network requests');

      expect(mockPage.waitForResponse).toHaveBeenCalledOnce();
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
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['https://surrit.com/playlist.m3u8']),
      );
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
  });
});
