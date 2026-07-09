import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be declared before any imports that use them
const mockGetSettings = vi.fn().mockReturnValue({});
const mockGetUserYtDlpConfig = vi.fn().mockReturnValue({});
const mockGetNetworkConfigFromUserConfig = vi.fn().mockReturnValue({});

vi.mock('../../../services/storageService', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

vi.mock('../../../utils/ytDlpUtils', () => ({
  getUserYtDlpConfig: (...args: unknown[]) => mockGetUserYtDlpConfig(...args),
  getNetworkConfigFromUserConfig: (...args: unknown[]) => mockGetNetworkConfigFromUserConfig(...args),
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  isLikelyBilibiliAuthFailure,
  prepareBilibiliDownloadFlags,
  resolveResolutionRetryTarget,
} from '../../../services/downloaders/bilibili/bilibiliConfig';

describe('prepareBilibiliDownloadFlags', () => {
  const TEST_URL = 'https://www.bilibili.com/video/BV1xx411c7mD';
  const TEST_OUTPUT = '/tmp/output/%(title)s.%(ext)s';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({});
    mockGetUserYtDlpConfig.mockReturnValue({});
    mockGetNetworkConfigFromUserConfig.mockReturnValue({});
  });

  describe('default behavior (no user config, no app settings)', () => {
    it('returns codec-neutral MP4 format with mp4 merge output', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      );
      expect(result.flags.mergeOutputFormat).toBe('mp4');
      expect(result.mergeOutputFormat).toBe('mp4');
    });

    it('sets default subtitle options', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.writeSubs).toBe(true);
      expect(result.flags.writeAutoSubs).toBe(true);
      expect(result.flags.convertSubs).toBe('vtt');
    });

    it('sets ignoreErrors and noWarnings', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.ignoreErrors).toBe(true);
      expect(result.flags.noWarnings).toBe(false);
    });

    it('does not apply codec formatSort by default', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.formatSort).toBeUndefined();
      expect(result.flags.formatSort).toBeUndefined();
    });

    it('sets the output template', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.output).toBe(TEST_OUTPUT);
    });
  });

  describe('app-level codec preference (defaultVideoCodec setting)', () => {
    it.each([
      ['h265', 'hevc', 'vcodec:h265'],
      ['av1', 'av01', 'vcodec:av01'],
      ['vp9', 'vp9', 'vcodec:vp9'],
      ['h264', 'avc', 'vcodec:h264'],
    ])('applies %s codec preference', (codec, vcodecFilter, expectedFormatSort) => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: codec });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toContain(`vcodec^=${vcodecFilter}`);
      expect(result.formatSort).toBe(expectedFormatSort);
      expect(result.flags.formatSort).toBe(expectedFormatSort);
    });

    it('falls back to codec-neutral default when codec setting is unrecognized', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: 'unknown_codec' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      );
      expect(result.formatSort).toBeUndefined();
    });

    it('falls back to codec-neutral default when codec setting is empty string', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: '  ' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      );
      expect(result.formatSort).toBeUndefined();
    });

    it('handles case-insensitive codec setting', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: 'H265' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toContain('vcodec^=hevc');
      expect(result.formatSort).toBe('vcodec:h265');
    });
  });

  describe('user-specified format (f or format)', () => {
    it('uses user format from "f" key', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ f: 'bestvideo+bestaudio' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe('bestvideo+bestaudio');
    });

    it('uses user format from "format" key', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ format: 'best[ext=mp4]' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe('best[ext=mp4]');
    });

    it('does not apply app codec preference when user specifies format', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: 'h265' });
      mockGetUserYtDlpConfig.mockReturnValue({ f: 'bestvideo+bestaudio' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe('bestvideo+bestaudio');
      // No formatSort since user controls format
      expect(result.formatSort).toBeUndefined();
    });

    it('prefers "f" over "format" when both are set', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ f: 'from-f', format: 'from-format' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe('from-f');
    });
  });

  describe('user-specified formatSort (S or formatSort)', () => {
    it('uses user formatSort from "S" key', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ S: 'res:720' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.formatSort).toBe('res:720');
      expect(result.flags.formatSort).toBe('res:720');
    });

    it('uses user formatSort from "formatSort" key', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ formatSort: 'ext:mp4' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.formatSort).toBe('ext:mp4');
    });

    it('uses default format string when only formatSort is set (not codec-aware)', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ S: 'res:720' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      // Should use the plain default, not codec-filtered format
      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      );
    });

    it('does not apply app codec formatSort when user specifies formatSort', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: 'h265' });
      mockGetUserYtDlpConfig.mockReturnValue({ S: 'res:1080' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.formatSort).toBe('res:1080');
      // User's sort takes priority over app codec preference
      expect(result.flags.formatSort).toBe('res:1080');
    });
  });

  describe('user subtitle preferences', () => {
    it('respects user writeSubs=false', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ writeSubs: false });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.writeSubs).toBe(false);
    });

    it('respects user writeAutoSubs=false', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ writeAutoSubs: false });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.writeAutoSubs).toBe(false);
    });

    it('respects user convertSubs override', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ convertSubs: 'srt' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.convertSubs).toBe('srt');
    });
  });

  describe('user mergeOutputFormat', () => {
    it('uses user mergeOutputFormat when specified', () => {
      mockGetUserYtDlpConfig.mockReturnValue({ mergeOutputFormat: 'mkv' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.mergeOutputFormat).toBe('mkv');
      expect(result.mergeOutputFormat).toBe('mkv');
    });

    it('defaults to mp4 when not specified', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.mergeOutputFormat).toBe('mp4');
    });

    it('uses app preferredVideoContainer when user mergeOutputFormat is not specified', () => {
      mockGetSettings.mockReturnValue({ preferredVideoContainer: 'mkv' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.mergeOutputFormat).toBe('mkv');
      expect(result.mergeOutputFormat).toBe('mkv');
    });

    it('falls back to mp4 for app WebM preference because Bilibili selects MP4/M4A streams', () => {
      mockGetSettings.mockReturnValue({ preferredVideoContainer: 'webm' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.mergeOutputFormat).toBe('mp4');
      expect(result.mergeOutputFormat).toBe('mp4');
    });

    it('keeps user mergeOutputFormat ahead of app preferredVideoContainer', () => {
      mockGetSettings.mockReturnValue({ preferredVideoContainer: 'webm' });
      mockGetUserYtDlpConfig.mockReturnValue({ mergeOutputFormat: 'mkv' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.mergeOutputFormat).toBe('mkv');
      expect(result.mergeOutputFormat).toBe('mkv');
    });
  });

  describe('network config passthrough', () => {
    it('spreads network config into flags', () => {
      mockGetNetworkConfigFromUserConfig.mockReturnValue({ proxy: 'socks5://127.0.0.1:1080' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.proxy).toBe('socks5://127.0.0.1:1080');
    });
  });

  describe('safe user config passthrough', () => {
    it('passes through non-reserved user config keys', () => {
      mockGetUserYtDlpConfig.mockReturnValue({
        noPlaylist: true,
        retries: 3,
      });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.noPlaylist).toBe(true);
      expect(result.flags.retries).toBe(3);
    });

    it('excludes reserved keys (output, o, f, format, S, formatSort) from safeUserConfig', () => {
      mockGetUserYtDlpConfig.mockReturnValue({
        output: '/user/output',
        o: '/user/o',
        f: 'bestvideo',
        format: 'best',
        S: 'res:720',
        formatSort: 'ext:mp4',
        customKey: 'kept',
      });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      // output should be the template, not user's
      expect(result.flags.output).toBe(TEST_OUTPUT);
      expect(result.flags.customKey).toBe('kept');
    });
  });

  describe('priority: user format > user formatSort > app codec > default', () => {
    it('user format + user formatSort: both applied, no app codec', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: 'h265' });
      mockGetUserYtDlpConfig.mockReturnValue({
        f: 'bestvideo+bestaudio',
        S: 'res:720',
      });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe('bestvideo+bestaudio');
      expect(result.formatSort).toBe('res:720');
    });

    it('no user config + app codec h265: codec-aware format + codecFormatSort', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: 'h265' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toContain('vcodec^=hevc');
      expect(result.formatSort).toBe('vcodec:h265');
    });

    it('no user config + no app codec: codec-neutral default', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      );
      expect(result.formatSort).toBeUndefined();
    });
  });

  describe('preferred video resolution (issue #295)', () => {
    it('soft preference adds res:H to formatSort and keeps selectors permissive', () => {
      mockGetSettings.mockReturnValue({ preferredVideoResolution: '1080' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      // Soft: selectors are not height-capped so every episode still downloads.
      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      );
      expect(result.formatSort).toBe('res:1080');
      expect(result.flags.formatSort).toBe('res:1080');
    });

    it('soft preference composes resolution before codec in formatSort', () => {
      mockGetSettings.mockReturnValue({
        preferredVideoResolution: '720',
        defaultVideoCodec: 'h265',
      });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.formatSort).toBe('res:720,vcodec:h265');
    });

    it('strict cap constrains every selector with height<=H', () => {
      mockGetSettings.mockReturnValue({
        preferredVideoResolution: '1080',
        preferredVideoResolutionStrict: true,
      });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/' +
          'best[ext=mp4][height<=1080]/best[height<=1080]'
      );
      expect(result.formatSort).toBe('res:1080');
    });

    it('"auto" or empty leaves selection unconstrained', () => {
      mockGetSettings.mockReturnValue({ preferredVideoResolution: 'auto' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
      );
      expect(result.formatSort).toBeUndefined();
    });

    it('ignores non-numeric resolution values', () => {
      mockGetSettings.mockReturnValue({ preferredVideoResolution: 'garbage' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.formatSort).toBeUndefined();
    });

    it('does not override a user-specified format', () => {
      mockGetSettings.mockReturnValue({
        preferredVideoResolution: '1080',
        preferredVideoResolutionStrict: true,
      });
      mockGetUserYtDlpConfig.mockReturnValue({ format: 'bestvideo+bestaudio' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toBe('bestvideo+bestaudio');
      expect(result.formatSort).toBeUndefined();
    });
  });

  describe('under-resolution retry floor (issue #295 2-1)', () => {
    it('pins a >= floor and keeps an unconstrained fallback so a file is always produced', () => {
      mockGetSettings.mockReturnValue({ preferredVideoResolution: '1080' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT, {
        retryFloorHeight: 1080,
      });

      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4][height>=1080]+bestaudio[ext=m4a]/' +
          'best[ext=mp4][height>=1080]/best[height>=1080]/best'
      );
      expect(result.formatSort).toBe('res:1080');
    });

    it('combines the retry floor with a strict ceiling and keeps the cap on the fallback', () => {
      mockGetSettings.mockReturnValue({
        preferredVideoResolution: '1080',
        preferredVideoResolutionStrict: true,
      });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT, {
        retryFloorHeight: 720,
      });

      // The guaranteed fallback is best[height<=1080], NOT an unconstrained best,
      // so a strict cap is never violated on retry (issue #295 2-1).
      expect(result.flags.format).toBe(
        'bestvideo[ext=mp4][height>=720][height<=1080]+bestaudio[ext=m4a]/' +
          'best[ext=mp4][height>=720][height<=1080]/' +
          'best[height>=720][height<=1080]/best[height<=1080]'
      );
      expect(result.flags.format).not.toMatch(/\/best$/);
    });
  });
});

describe('resolveResolutionRetryTarget', () => {
  it('returns null when there is no resolution preference', () => {
    expect(
      resolveResolutionRetryTarget({ height: null, strict: false }, 480, [
        720, 1080,
      ])
    ).toBeNull();
  });

  it('returns null when the actual height is unknown', () => {
    expect(
      resolveResolutionRetryTarget({ height: 1080, strict: false }, null, [
        720, 1080,
      ])
    ).toBeNull();
  });

  it('returns null when no formats are available', () => {
    expect(
      resolveResolutionRetryTarget({ height: 1080, strict: false }, 480, [])
    ).toBeNull();
  });

  it('retries to the target when a higher format is available (soft)', () => {
    expect(
      resolveResolutionRetryTarget({ height: 1080, strict: false }, 480, [
        360, 480, 720, 1080, 2160,
      ])
    ).toBe(1080);
  });

  it('does not retry when already at the best the source offers (soft)', () => {
    expect(
      resolveResolutionRetryTarget({ height: 1080, strict: false }, 720, [
        480, 720,
      ])
    ).toBeNull();
  });

  it('retries up to the source ceiling capped by the target (strict)', () => {
    expect(
      resolveResolutionRetryTarget({ height: 1080, strict: true }, 480, [
        480, 720, 2160,
      ])
    ).toBe(720);
  });

  it('does not retry in strict mode when already at the capped best', () => {
    expect(
      resolveResolutionRetryTarget({ height: 1080, strict: true }, 1080, [
        1080, 2160,
      ])
    ).toBeNull();
  });
});

describe('isLikelyBilibiliAuthFailure', () => {
  it.each([
    'ERROR: HTTP Error 412: Precondition Failed',
    'bilibili API error code -352',
    'code -101 (not logged in)',
    '请先登录后再试',
    'request blocked by risk control',
  ])('treats %s as an auth/risk-control failure', (message) => {
    expect(isLikelyBilibiliAuthFailure(message)).toBe(true);
  });

  it.each([
    'network error',
    'Requested format is not available',
    'Connection timed out',
    '',
    undefined,
    null,
  ])('treats %s as a generic failure', (message) => {
    expect(isLikelyBilibiliAuthFailure(message as any)).toBe(false);
  });
});
