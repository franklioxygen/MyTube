
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import puppeteer from 'puppeteer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissAVDownloader } from '../../../services/downloaders/MissAVDownloader';
import { cleanupTemporaryFiles, isCancellationError } from '../../../utils/downloadUtils';
import { flagsToArgs, getUserYtDlpConfig, isYtDlpImpersonateAvailable } from '../../../utils/ytDlpUtils';
import * as security from '../../../utils/security';
import { logger } from '../../../utils/logger';
import { getMissAVPlaceholderTitle } from '../../../utils/helpers';
import * as storageService from '../../../services/storageService';

vi.mock('puppeteer');
vi.mock('../../../services/storageService', () => ({
  saveVideo: vi.fn(),
  updateVideo: vi.fn(),
  updateActiveDownload: vi.fn(),
  getSettings: vi.fn().mockReturnValue({}),
  getVideos: vi.fn().mockReturnValue([]),
  getVideoBySourceUrl: vi.fn().mockReturnValue(null),
  organizeVideoByAuthor: vi.fn().mockReturnValue(null),
  getVideoById: vi.fn().mockReturnValue(null),
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
        on: vi.fn((event: string, cb: (req: { url(): string }) => void) => {
          if (event === 'request') requestCallback?.capture(cb);
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

    it('silences TimeoutError and falls through to "Could not find m3u8 URL"', async () => {
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://missav.com/test-video'),
      ).rejects.toThrow('Could not find m3u8 URL in page source or network requests');

      expect(mockPage.waitForResponse).toHaveBeenCalledOnce();
    });

    it('preserves the 123av /v/ route during download navigation', async () => {
      const mockPage = buildPageMock('timeout');
      const mockBrowser = { newPage: vi.fn().mockResolvedValue(mockPage), close: vi.fn().mockResolvedValue(undefined) };
      (puppeteer.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

      await expect(
        MissAVDownloader.downloadVideo('https://123av.com/en/v/fc2-ppv-2683017'),
      ).rejects.toThrow('Could not find m3u8 URL in page source or network requests');

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
      ).rejects.toThrow('Could not find m3u8 URL in page source or network requests');

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
      ).rejects.toThrow('Could not find m3u8 URL in page source or network requests');

      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://missav.ai/dm30/en/juq-819-uncensored-leak',
        expect.any(Object),
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
