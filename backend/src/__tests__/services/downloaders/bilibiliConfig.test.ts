import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be declared before any imports that use them
const mockGetSettings = vi.fn().mockReturnValue({});
const mockGetUserYtDlpConfig = vi.fn().mockReturnValue({});
const mockGetNetworkConfigFromUserConfig = vi.fn().mockReturnValue({});

vi.mock('../../../services/storageService', () => ({
  getSettings: (...args: any[]) => mockGetSettings(...args),
}));

vi.mock('../../../utils/ytDlpUtils', () => ({
  getUserYtDlpConfig: (...args: any[]) => mockGetUserYtDlpConfig(...args),
  getNetworkConfigFromUserConfig: (...args: any[]) => mockGetNetworkConfigFromUserConfig(...args),
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { prepareBilibiliDownloadFlags } from '../../../services/downloaders/bilibili/bilibiliConfig';

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
    it('returns default H.264 format with mp4 merge output', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toContain('vcodec^=avc');
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

    it('applies default codec formatSort (vcodec:h264)', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.formatSort).toBe('vcodec:h264');
      expect(result.flags.formatSort).toBe('vcodec:h264');
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

    it('falls back to H.264 when codec setting is unrecognized', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: 'unknown_codec' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toContain('vcodec^=avc');
      expect(result.formatSort).toBe('vcodec:h264');
    });

    it('falls back to H.264 when codec setting is empty string', () => {
      mockGetSettings.mockReturnValue({ defaultVideoCodec: '  ' });

      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toContain('vcodec^=avc');
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

    it('no user config + no app codec: default h264', () => {
      const result = prepareBilibiliDownloadFlags(TEST_URL, TEST_OUTPUT);

      expect(result.flags.format).toContain('vcodec^=avc');
      expect(result.formatSort).toBe('vcodec:h264');
    });
  });
});
