import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    extractMissAVVideoId,
    extractSourceVideoId,
    extractTwitchChannelLogin,
    extractTwitchVideoId,
    extractYouTubeVideoId,
    extractBilibiliMid,
    extractBilibiliVideoId,
    extractUrlFromText,
    formatAvatarFilename,
    formatVideoFilename,
    generateTimestamp,
    getDomainFromUrl,
    getMissAVPlaceholderTitle,
    isBilibiliShortUrl,
    isBilibiliUrl,
    isMissAVUrl,
    isTwitchChannelUrl,
    isTwitchUrl,
    isTwitchVideoUrl,
    isTwitterUrl,
    isYouTubeUrl,
    isValidUrl,
    normalizeTwitchChannelUrl,
    normalizeYouTubeAuthorUrl,
    processVideoUrl,
    resolveShortUrl,
    resetShortUrlResolutionCacheForTests,
    getShortUrlResolutionCacheSizeForTests,
    sanitizeFilename,
    targetsNonFirstBilibiliPart,
    trimBilibiliUrl
} from '../../utils/helpers';

const axiosHeadMock = vi.fn();
vi.mock('axios', () => ({
  default: {
    head: (...args: unknown[]) => axiosHeadMock(...args),
  },
}));

// getUserYtDlpConfig pulls in the storage layer; the short-URL resolver only
// needs the proxy field, so stub it. Defaults to a proxy-less config.
const userYtDlpConfigMock = vi.fn(() => ({}) as Record<string, unknown>);
vi.mock('../../utils/ytdlp/config', () => ({
  getUserYtDlpConfig: (...args: unknown[]) => userYtDlpConfigMock(...(args as [])),
}));

const axiosProxyConfigMock = vi.fn(() => ({}) as Record<string, unknown>);
vi.mock('../../utils/ytdlp/proxy', () => ({
  getAxiosProxyConfig: (...args: unknown[]) =>
    axiosProxyConfigMock(...(args as [])),
}));

/** Queue a redirect chain for the mocked axios.head to walk through. */
const mockRedirectChain = (...locations: (string | undefined)[]) => {
  axiosHeadMock.mockReset();
  for (const location of locations) {
    axiosHeadMock.mockResolvedValueOnce({ headers: location ? { location } : {} });
  }
};

describe('Helpers', () => {
  describe('isValidUrl', () => {
    it('should return true for valid URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('isBilibiliUrl', () => {
    it('should return true for bilibili.com URLs', () => {
      expect(isBilibiliUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    });

    it('should return true for b23.tv URLs', () => {
      expect(isBilibiliUrl('https://b23.tv/example')).toBe(true);
    });

    it('should return false for other URLs', () => {
      expect(isBilibiliUrl('https://youtube.com')).toBe(false);
    });

    it('should return false for URLs with credentials or explicit ports', () => {
      expect(isBilibiliUrl('https://user:pass@www.bilibili.com/video/BV1xx')).toBe(false);
      expect(isBilibiliUrl('https://www.bilibili.com:8443/video/BV1xx')).toBe(false);
    });
  });

  describe('isYouTubeUrl', () => {
    it('should return true for normal YouTube URLs', () => {
      expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
      expect(isYouTubeUrl('https://youtu.be/abc123')).toBe(true);
    });

    it('should return false for URLs with credentials or explicit ports', () => {
      expect(isYouTubeUrl('https://user:pass@youtube.com/watch?v=abc123')).toBe(false);
      expect(isYouTubeUrl('https://youtube.com:8443/watch?v=abc123')).toBe(false);
    });
  });

  describe('other domain classifiers', () => {
    it('should validate bilibili short URLs', () => {
      expect(isBilibiliShortUrl('https://b23.tv/abc')).toBe(true);
      expect(isBilibiliShortUrl('https://bili2233.cn/abc')).toBe(true);
      expect(isBilibiliShortUrl('https://example.com/abc')).toBe(false);
    });

    it('should validate missav and twitter URL domains', () => {
      expect(isMissAVUrl('https://missav.com/abc')).toBe(true);
      expect(isMissAVUrl('https://123av.ai/abc')).toBe(true);
      expect(isMissAVUrl('https://javxx.com/en/v/fc2-ppv-2683017')).toBe(true);
      expect(isMissAVUrl('https://user:pass@missav.com/abc')).toBe(false);
      expect(isTwitterUrl('https://x.com/user')).toBe(true);
      expect(isTwitterUrl('https://twitter.com/user')).toBe(true);
      expect(isTwitterUrl('https://youtube.com/user')).toBe(false);
    });

    it('should validate twitch channel domains', () => {
      expect(isTwitchUrl('https://www.twitch.tv/example')).toBe(true);
      expect(isTwitchUrl('https://m.twitch.tv/example/videos')).toBe(true);
      expect(isTwitchUrl('https://example.com/example')).toBe(false);
    });
  });

  describe('twitch channel helpers', () => {
    it('should normalize twitch channel URLs and strip tab paths', () => {
      expect(
        normalizeTwitchChannelUrl('https://www.twitch.tv/TestUser/videos')
      ).toBe('https://www.twitch.tv/testuser');
      expect(
        normalizeTwitchChannelUrl('https://m.twitch.tv/TestUser/about/')
      ).toBe('https://www.twitch.tv/testuser');
    });

    it('should extract twitch channel login and reject non-channel routes', () => {
      expect(
        extractTwitchChannelLogin('https://www.twitch.tv/TestUser/schedule')
      ).toBe('testuser');
      expect(isTwitchChannelUrl('https://www.twitch.tv/TestUser')).toBe(true);
      expect(isTwitchChannelUrl('https://www.twitch.tv/_TestUser')).toBe(false);
      expect(isTwitchChannelUrl('https://clips.twitch.tv/FunnyClipSlug')).toBe(false);
      expect(isTwitchChannelUrl('https://www.twitch.tv/videos/12345')).toBe(false);
      expect(isTwitchChannelUrl('https://www.twitch.tv/directory')).toBe(false);
    });

    it('should extract twitch video ids', () => {
      expect(extractTwitchVideoId('https://www.twitch.tv/videos/12345')).toBe('12345');
      expect(isTwitchVideoUrl('https://www.twitch.tv/videos/12345')).toBe(true);
      expect(extractTwitchVideoId('https://www.twitch.tv/example')).toBe(null);
    });
  });

  describe('normalizeYouTubeAuthorUrl', () => {
    it('should strip /featured from @handle URLs', () => {
      expect(
        normalizeYouTubeAuthorUrl('https://www.youtube.com/@huzeyfekurt/featured')
      ).toBe('https://www.youtube.com/@huzeyfekurt');
    });

    it('should strip /videos, /playlists, /streams, /shorts from @handle URLs', () => {
      expect(
        normalizeYouTubeAuthorUrl('https://www.youtube.com/@channel/videos')
      ).toBe('https://www.youtube.com/@channel');
      expect(
        normalizeYouTubeAuthorUrl('https://youtube.com/@user/playlists')
      ).toBe('https://youtube.com/@user');
      expect(
        normalizeYouTubeAuthorUrl('https://www.youtube.com/@name/streams')
      ).toBe('https://www.youtube.com/@name');
      expect(
        normalizeYouTubeAuthorUrl('https://www.youtube.com/@name/shorts')
      ).toBe('https://www.youtube.com/@name');
    });

    it('should leave @handle-only URL unchanged', () => {
      const url = 'https://www.youtube.com/@huzeyfekurt';
      expect(normalizeYouTubeAuthorUrl(url)).toBe(url);
    });

    it('should normalize /channel/ID and /user/name and /c/name with trailing path', () => {
      expect(
        normalizeYouTubeAuthorUrl('https://www.youtube.com/channel/UCxxx/videos')
      ).toBe('https://www.youtube.com/channel/UCxxx');
      expect(
        normalizeYouTubeAuthorUrl('https://www.youtube.com/user/name/featured')
      ).toBe('https://www.youtube.com/user/name');
      expect(
        normalizeYouTubeAuthorUrl('https://www.youtube.com/c/MyChannel/streams')
      ).toBe('https://www.youtube.com/c/MyChannel');
    });

    it('should return non-YouTube URLs unchanged', () => {
      const url = 'https://space.bilibili.com/123';
      expect(normalizeYouTubeAuthorUrl(url)).toBe(url);
    });
  });

  describe('extractUrlFromText', () => {
    it('should extract URL from text', () => {
      expect(extractUrlFromText('Check this out: https://example.com')).toBe('https://example.com');
    });

    it('should return original text if no URL found', () => {
      expect(extractUrlFromText('No URL here')).toBe('No URL here');
    });
  });

  describe('resolveShortUrl', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      axiosHeadMock.mockReset();
      userYtDlpConfigMock.mockReset();
      userYtDlpConfigMock.mockReturnValue({});
      axiosProxyConfigMock.mockReset();
      axiosProxyConfigMock.mockReturnValue({});
      resetShortUrlResolutionCacheForTests();
    });

    it('should follow the redirect to the canonical Bilibili video URL', async () => {
      mockRedirectChain(
        'https://www.bilibili.com/video/BV1xx411c7mD?share_source=copy_web'
      );
      await expect(resolveShortUrl('https://b23.tv/zKTXLw5')).resolves.toBe(
        'https://www.bilibili.com/video/BV1xx411c7mD?share_source=copy_web'
      );
      expect(extractBilibiliVideoId(await resolveShortUrl('https://b23.tv/zKTXLw5')))
        .toBe('BV1xx411c7mD');
    });

    it('should follow a multi-hop chain that stays on allowed hosts', async () => {
      mockRedirectChain(
        'https://bili2233.cn/hop',
        'https://m.bilibili.com/video/BV1xx411c7mD'
      );
      await expect(resolveShortUrl('https://b23.tv/zKTXLw5')).resolves.toBe(
        'https://m.bilibili.com/video/BV1xx411c7mD'
      );
    });

    it('should preserve the subdomain a short link actually points at', async () => {
      // Collapsing live./space. onto www. would silently point the download at
      // an unrelated page.
      mockRedirectChain('https://live.bilibili.com/1234');
      await expect(resolveShortUrl('https://b23.tv/live')).resolves.toBe(
        'https://live.bilibili.com/1234'
      );
    });

    it('should fill out a bare bilibili.com host to www', async () => {
      mockRedirectChain('https://bilibili.com/video/BV1xx411c7mD');
      await expect(resolveShortUrl('https://b23.tv/bare')).resolves.toBe(
        'https://www.bilibili.com/video/BV1xx411c7mD'
      );
    });

    it('should reject a redirect that carries credentials', async () => {
      mockRedirectChain('https://user:pass@www.bilibili.com/video/BV1xx411c7mD');
      await expect(resolveShortUrl('https://b23.tv/creds')).resolves.toBe(
        'https://b23.tv/creds'
      );
    });

    it('should resolve a relative Location header against the current hop', async () => {
      // A relative hop that stays on the shortener is joined against the
      // current URL and then followed like any other hop.
      mockRedirectChain(
        '/s/zKTXLw5',
        'https://www.bilibili.com/video/BV1xx411c7mD'
      );
      await expect(resolveShortUrl('https://b23.tv/zKTXLw5')).resolves.toBe(
        'https://www.bilibili.com/video/BV1xx411c7mD'
      );
      expect(axiosHeadMock).toHaveBeenNthCalledWith(
        2,
        'https://b23.tv/s/zKTXLw5',
        expect.objectContaining({ maxRedirects: 0 })
      );
    });

    it('should never follow a redirect off the allow-list', async () => {
      mockRedirectChain('http://169.254.169.254/latest/meta-data');
      // The off-list hop is rejected before it is requested, so the caller is
      // left on the short URL rather than being pointed at the internal host.
      await expect(resolveShortUrl('https://b23.tv/evil')).resolves.toBe(
        'https://b23.tv/evil'
      );
      expect(axiosHeadMock).toHaveBeenCalledTimes(1);
      expect(axiosHeadMock).toHaveBeenCalledWith(
        'https://b23.tv/evil',
        expect.objectContaining({ maxRedirects: 0 })
      );
    });

    it('should fall back to the short URL when resolution fails', async () => {
      axiosHeadMock.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(resolveShortUrl('https://b23.tv/fail')).resolves.toBe(
        'https://b23.tv/fail'
      );
    });

    it('should fall back to the short URL when no redirect is returned', async () => {
      mockRedirectChain(undefined);
      await expect(resolveShortUrl('https://b23.tv/example')).resolves.toBe(
        'https://b23.tv/example'
      );
    });

    it('should give up on a redirect loop that never leaves the shorteners', async () => {
      axiosHeadMock.mockResolvedValue({
        headers: { location: 'https://b23.tv/loop' },
      });
      await expect(resolveShortUrl('https://b23.tv/loop')).resolves.toBe(
        'https://b23.tv/loop'
      );
      expect(axiosHeadMock).toHaveBeenCalledTimes(5);
    });

    it('should carry a part selector through resolution and trimming', async () => {
      // The controller feeds the resolved URL straight into trimBilibiliUrl, so
      // a short link to part 2 must still name part 2 at the end of that chain.
      mockRedirectChain(
        'https://www.bilibili.com/video/BV1xx411c7mD?p=2&share_source=COPY&unique_k=zKTXLw5'
      );
      const resolved = await resolveShortUrl('https://b23.tv/zKTXLw5');
      expect(trimBilibiliUrl(resolved)).toBe(
        'https://www.bilibili.com/video/BV1xx411c7mD?p=2'
      );
    });

    it('should route the request through a configured proxy', async () => {
      userYtDlpConfigMock.mockReturnValue({ proxy: 'socks5://127.0.0.1:1080' });
      axiosProxyConfigMock.mockReturnValue({ proxy: false, httpsAgent: 'agent' });
      mockRedirectChain('https://www.bilibili.com/video/BV1xx411c7mD');

      await resolveShortUrl('https://b23.tv/zKTXLw5');

      expect(axiosProxyConfigMock).toHaveBeenCalledWith('socks5://127.0.0.1:1080');
      expect(axiosHeadMock).toHaveBeenCalledWith(
        'https://b23.tv/zKTXLw5',
        expect.objectContaining({ proxy: false, httpsAgent: 'agent' })
      );
    });

    it('should never fall back to a direct request when the proxy is invalid', async () => {
      // getAxiosProxyConfig throws precisely to stop a silent direct connection
      // from exposing the user's real IP, so resolution must abort entirely.
      userYtDlpConfigMock.mockReturnValue({ proxy: 'not-a-proxy' });
      axiosProxyConfigMock.mockImplementation(() => {
        throw new Error('Invalid proxy URL: not-a-proxy');
      });

      await expect(resolveShortUrl('https://b23.tv/zKTXLw5')).resolves.toBe(
        'https://b23.tv/zKTXLw5'
      );
      expect(axiosHeadMock).not.toHaveBeenCalled();
    });

    it('should cache a resolved short URL instead of re-requesting it', async () => {
      mockRedirectChain('https://www.bilibili.com/video/BV1xx411c7mD');
      const first = await resolveShortUrl('https://b23.tv/zKTXLw5');
      const second = await resolveShortUrl('https://b23.tv/zKTXLw5');
      expect(second).toBe(first);
      expect(axiosHeadMock).toHaveBeenCalledTimes(1);
    });

    it('should evict expired entries instead of growing forever', async () => {
      vi.useFakeTimers();
      try {
        // One-off links are never requested a second time, so expiry-on-read
        // alone would never reclaim them.
        for (let i = 0; i < 3; i++) {
          mockRedirectChain(`https://www.bilibili.com/video/BV100${i}`);
          await resolveShortUrl(`https://b23.tv/oneoff${i}`);
        }
        expect(getShortUrlResolutionCacheSizeForTests()).toBe(3);

        // Past the TTL, the next write sweeps every stale entry.
        vi.advanceTimersByTime(11 * 60 * 1000);
        mockRedirectChain('https://www.bilibili.com/video/BV2000');
        await resolveShortUrl('https://b23.tv/fresh');

        expect(getShortUrlResolutionCacheSizeForTests()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should keep the cache bounded when entries have not expired', async () => {
      for (let i = 0; i < 505; i++) {
        mockRedirectChain(`https://www.bilibili.com/video/BV${i}`);
        await resolveShortUrl(`https://b23.tv/bulk${i}`);
      }
      expect(getShortUrlResolutionCacheSizeForTests()).toBe(500);
    });

    it('should reject non-whitelisted short URL hosts', async () => {
      await expect(resolveShortUrl('https://example.com/test')).rejects.toThrow('Invalid URL');
      expect(axiosHeadMock).not.toHaveBeenCalled();
    });

    it('should reject short URL with credentials', async () => {
      await expect(resolveShortUrl('https://user:pass@b23.tv/example')).rejects.toThrow('Invalid URL');
      expect(axiosHeadMock).not.toHaveBeenCalled();
    });

    it('should reject invalid protocol and normalize traversal paths', async () => {
      await expect(resolveShortUrl('ftp://b23.tv/test')).rejects.toThrow('Invalid URL');
      mockRedirectChain(undefined);
      await expect(resolveShortUrl('https://b23.tv/../test')).resolves.toBe('https://b23.tv/test');
    });
  });

  describe('trimBilibiliUrl', () => {
    it('should trim bilibili URL with BV ID', () => {
      const url = 'https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.999.0.0';
      expect(trimBilibiliUrl(url)).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
    });

    it('should trim bilibili URL with av ID', () => {
      const url = 'https://www.bilibili.com/video/av123456?spm_id_from=333.999.0.0';
      expect(trimBilibiliUrl(url)).toBe('https://www.bilibili.com/video/av123456');
    });

    it('should keep the part selector while dropping tracking params', () => {
      // Dropping ?p= silently downloads part 1 of a multipart video instead of
      // the part the link actually points at.
      expect(
        trimBilibiliUrl(
          'https://www.bilibili.com/video/BV1xx411c7mD?p=2&spm_id_from=333.999.0.0&share_source=COPY'
        )
      ).toBe('https://www.bilibili.com/video/BV1xx411c7mD?p=2');
      expect(
        trimBilibiliUrl('https://www.bilibili.com/video/av123456?p=13')
      ).toBe('https://www.bilibili.com/video/av123456?p=13');
    });

    it('should ignore a malformed part selector', () => {
      for (const part of ['0', '-1', 'abc', '2; DROP TABLE', '']) {
        expect(
          trimBilibiliUrl(
            `https://www.bilibili.com/video/BV1xx411c7mD?p=${encodeURIComponent(part)}`
          )
        ).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
      }
    });

    it('should remove query parameters if no video ID found', () => {
      const url = 'https://www.bilibili.com/read/cv123456?from=search';
      expect(trimBilibiliUrl(url)).toBe('https://www.bilibili.com/read/cv123456');
    });

    it('should identify URLs that target a part other than the first', () => {
      // p=1 and a bare URL are the same video, so only p>=2 needs the
      // part-aware duplicate check.
      expect(
        targetsNonFirstBilibiliPart('https://www.bilibili.com/video/BV1x?p=2')
      ).toBe(true);
      expect(
        targetsNonFirstBilibiliPart('https://www.bilibili.com/video/BV1x?p=1')
      ).toBe(false);
      expect(
        targetsNonFirstBilibiliPart('https://www.bilibili.com/video/BV1x')
      ).toBe(false);
      expect(
        targetsNonFirstBilibiliPart('https://www.bilibili.com/video/BV1x?p=abc')
      ).toBe(false);
      expect(targetsNonFirstBilibiliPart('not-a-url')).toBe(false);
    });

    it('should return original value when URL parsing fails', () => {
      expect(trimBilibiliUrl('invalid-url')).toBe('invalid-url');
    });
  });

  describe('extractBilibiliVideoId', () => {
    it('should extract BV ID', () => {
      expect(extractBilibiliVideoId('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('BV1xx411c7mD');
    });

    it('should extract av ID', () => {
      expect(extractBilibiliVideoId('https://www.bilibili.com/video/av123456')).toBe('av123456');
    });

    it('should return null if no ID found', () => {
      expect(extractBilibiliVideoId('https://www.bilibili.com/')).toBe(null);
    });
  });

  describe('extractYouTubeVideoId', () => {
    it('should extract watch/short/embed/shorts ids', () => {
      expect(extractYouTubeVideoId('https://youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
      expect(extractYouTubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
      expect(extractYouTubeVideoId('https://youtube.com/embed/abcdefghijk')).toBe('abcdefghijk');
      expect(extractYouTubeVideoId('https://youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    });

    it('should return null when youtube id cannot be extracted', () => {
      expect(extractYouTubeVideoId('https://youtube.com/watch?v=short')).toBe(null);
    });
  });

  describe('extractMissAVVideoId', () => {
    it('should extract missav id from last path segment', () => {
      expect(extractMissAVVideoId('https://missav.ai/dm29/en/juq-643-uncensored-leak')).toBe(
        'juq-643-uncensored-leak'
      );
      expect(extractMissAVVideoId('https://missav.ai/v/ABCD123')).toBe('ABCD123');
      expect(extractMissAVVideoId('https://123av.com/en/v/fc2_ppv-2683017')).toBe('fc2_ppv-2683017');
    });

    it('should return null for invalid missav urls', () => {
      expect(extractMissAVVideoId('not-a-url')).toBe(null);
    });
  });

  describe('getMissAVPlaceholderTitle', () => {
    it('should create source-aware placeholder titles from URLs', () => {
      expect(getMissAVPlaceholderTitle('https://123av.com/en/v/fc2-ppv-2683017')).toBe(
        '123AV: FC2-PPV-2683017'
      );
      expect(getMissAVPlaceholderTitle('https://missav.ai/dm29/en/juq-643-uncensored-leak')).toBe(
        'MissAV: JUQ-643-UNCENSORED-LEAK'
      );
      expect(getMissAVPlaceholderTitle('https://njavtv.com/en/v/abc-123')).toBe(
        'NJAVTV: ABC-123'
      );
      expect(getMissAVPlaceholderTitle('https://javxx.com/en/v/fc2-ppv-2683017')).toBe(
        'JAVXX: FC2-PPV-2683017'
      );
    });

    it('should fall back to a generic title for invalid or unsafe URLs', () => {
      expect(getMissAVPlaceholderTitle('not-a-url')).toBe('MissAV Video');
      expect(getMissAVPlaceholderTitle('https://user:pass@123av.com/en/v/fc2-ppv-2683017')).toBe(
        'MissAV Video'
      );
    });
  });

  describe('extractSourceVideoId and processVideoUrl', () => {
    it('should detect source IDs by platform and fallback for unknown', () => {
      expect(extractSourceVideoId('https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({
        id: 'BV1xx411c7mD',
        platform: 'bilibili',
      });
      expect(extractSourceVideoId('https://youtube.com/watch?v=abcdefghijk')).toEqual({
        id: 'abcdefghijk',
        platform: 'youtube',
      });
      expect(extractSourceVideoId('https://missav.ai/v/ABC-123')).toEqual({
        id: 'ABC-123',
        platform: 'missav',
      });
      expect(extractSourceVideoId('https://www.twitch.tv/videos/12345')).toEqual({
        id: '12345',
        platform: 'twitch',
      });
      expect(extractSourceVideoId('https://example.com/video/1')).toEqual({
        id: 'https://example.com/video/1',
        platform: 'other',
      });
    });

    it('should process text-wrapped URLs and resolve bilibili short links', async () => {
      resetShortUrlResolutionCacheForTests();
      mockRedirectChain('https://www.bilibili.com/video/BV1xx411c7mD');
      await expect(
        processVideoUrl('Title https://b23.tv/xyz')
      ).resolves.toEqual({
        videoUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
        sourceVideoId: 'BV1xx411c7mD',
        platform: 'bilibili',
      });
    });

    it('should still classify a short link that cannot be resolved', async () => {
      resetShortUrlResolutionCacheForTests();
      axiosHeadMock.mockReset();
      axiosHeadMock.mockRejectedValue(new Error('offline'));
      await expect(
        processVideoUrl('Title https://b23.tv/xyz')
      ).resolves.toEqual({
        videoUrl: 'https://b23.tv/xyz',
        sourceVideoId: null,
        platform: 'bilibili',
      });
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove hashtags', () => {
      expect(sanitizeFilename('Video #tag1 #tag2')).toBe('Video');
    });

    it('should replace unsafe characters', () => {
      expect(sanitizeFilename('Video/with:unsafe*chars?')).toBe('Video_with_unsafe_chars_');
    });

    it('should replace spaces with underscores', () => {
      expect(sanitizeFilename('Video with spaces')).toBe('Video_with_spaces');
    });

    it('should preserve non-Latin characters', () => {
      expect(sanitizeFilename('测试视频')).toBe('测试视频');
    });
  });

  describe('extractBilibiliMid', () => {
    it('should extract mid from space URL', () => {
      expect(extractBilibiliMid('https://space.bilibili.com/123456')).toBe('123456');
    });

    it('should extract mid from query params', () => {
      expect(extractBilibiliMid('https://api.bilibili.com/x/space?mid=123456')).toBe('123456');
    });

    it('should return null if no mid found', () => {
      expect(extractBilibiliMid('https://www.bilibili.com/')).toBe(null);
    });
  });

  describe('formatVideoFilename', () => {
    it('should format filename with title, author and year', () => {
      expect(formatVideoFilename('My Video', 'Author Name', '20230101')).toBe('My.Video-Author.Name-2023');
    });

    it('should remove symbols from title and author', () => {
      expect(formatVideoFilename('My #Video!', '@Author!', '20230101')).toBe('My.Video-Author-2023');
    });

    it('should handle missing author', () => {
      expect(formatVideoFilename('My Video', '', '20230101')).toBe('My.Video-Unknown-2023');
    });

    it('should handle missing date', () => {
      const year = new Date().getFullYear();
      expect(formatVideoFilename('My Video', 'Author', '')).toBe(`My.Video-Author-${year}`);
    });

    it('should preserve non-Latin characters', () => {
      expect(formatVideoFilename('测试视频', '作者', '20230101')).toBe('测试视频-作者-2023');
    });
    
    it('should replace multiple spaces with single dot', () => {
      expect(formatVideoFilename('My   Video', 'Author   Name', '20230101')).toBe('My.Video-Author.Name-2023');
    });

    it('should truncate filenames exceeding 200 bytes', () => {
        const longTitle = 'a'.repeat(300);
        const author = 'Author';
        const year = '2023';
        const result = formatVideoFilename(longTitle, author, year);

        expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
        expect(result).toContain('Author');
        expect(result).toContain('2023');
        // Suffix is -Author-2023 (12 bytes, all ASCII)
        // Title should be 200 - 12 = 188 bytes = 188 ASCII chars
        expect(Buffer.byteLength(result, 'utf8')).toBe(200);
    });

    it('should truncate very long author names', () => {
        const title = 'Video';
        const longAuthor = 'a'.repeat(100);
        const year = '2023';
        const result = formatVideoFilename(title, longAuthor, year);

        // Author truncated to 50 bytes (50 ASCII 'a' chars = 50 bytes)
        // Suffix: -[50 chars]-2023 -> 1 + 50 + 1 + 4 = 56 bytes
        // Title: Video (5 bytes)
        // Total: 5 + 56 = 61 bytes
        expect(Buffer.byteLength(result, 'utf8')).toBe(61);
        expect(result).toContain(title);
        // Should contain 50 'a's
        expect(result).toContain('a'.repeat(50));
        expect(result).not.toContain('a'.repeat(51));
    });

    // CJK / MissAV long-title regression tests
    // Each CJK character is 3 bytes in UTF-8 — the old .length check allowed
    // filenames of up to 600 bytes, causing [Errno 36] on Linux (255-byte limit).

    it('should keep byte length ≤ 200 for a long CJK title', () => {
        // 80 Chinese characters × 3 bytes = 240 bytes — would breach the old limit
        const longCjkTitle = '有'.repeat(80);
        const result = formatVideoFilename(longCjkTitle, '作者', '20260228');
        expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
    });

    it('should not split a CJK character when truncating the title', () => {
        const longCjkTitle = '有'.repeat(80);
        const result = formatVideoFilename(longCjkTitle, '作者', '20260228');
        // Every remaining character must decode cleanly — no replacement chars
        expect(result).not.toContain('\uFFFD');
        // The result must still be valid Unicode (Buffer round-trip is identical)
        expect(Buffer.from(result, 'utf8').toString('utf8')).toBe(result);
    });

    it('should truncate a long CJK author to ≤ 50 bytes', () => {
        // 30 CJK chars × 3 bytes = 90 bytes > 50-byte author cap
        const longCjkAuthor = '佐'.repeat(30);
        const result = formatVideoFilename('Video', longCjkAuthor, '20260228');
        // Extract the author portion from the result
        const withoutYear = result.replace(/-\d{4}$/, '');
        const authorPart = withoutYear.split('-').slice(1).join('-');
        expect(Buffer.byteLength(authorPart, 'utf8')).toBeLessThanOrEqual(50);
    });

    it('should reproduce and fix the MissAV SONE-652 long-title failure', () => {
        // Exact title that triggered [Errno 36] File name too long in Docker
        const title = 'SONE-652 有一天當我正隨意地對著一個糖爹自慰的時候一個老男人給了我一種奇怪的藥物也就是眾所周知的春藥從那時起我就一直渴望一根好雞巴我的陰部一直無法控制地濕潤';
        const author = '白神佐喜香 白上咲花';
        const result = formatVideoFilename(title, author, '20260228');
        // Must fit within 200 bytes (yt-dlp appends .mp4.ytdl during download)
        expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
        // Must not contain any broken multi-byte sequences
        expect(result).not.toContain('\uFFFD');
    });
  });

  describe('sanitizeFilename - CJK byte-length truncation', () => {
    it('should keep byte length ≤ 200 for a long CJK string', () => {
        // 80 CJK chars × 3 bytes = 240 bytes — exceeds the 200-byte limit
        const longCjk = '試'.repeat(80);
        const result = sanitizeFilename(longCjk);
        expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
    });

    it('should not split a CJK character when truncating', () => {
        const longCjk = '試'.repeat(80);
        const result = sanitizeFilename(longCjk);
        expect(result).not.toContain('\uFFFD');
        expect(Buffer.from(result, 'utf8').toString('utf8')).toBe(result);
    });

    it('should leave short CJK filenames unchanged', () => {
        const short = '測試視頻作者';
        expect(sanitizeFilename(short)).toBe(short);
    });
  });

  describe('getDomainFromUrl', () => {
    it('should extract domain from simplified URL', () => {
      expect(getDomainFromUrl('https://example.com/video')).toBe('example.com');
    });

    it('should extract domain from simplified URL with www', () => {
      expect(getDomainFromUrl('https://www.example.com/video')).toBe('example.com');
    });

    it('should extract domain from simplified URL with subdomain', () => {
      expect(getDomainFromUrl('https://sub.example.com/video')).toBe('sub.example.com');
    });

    it('should return Unknown for invalid URL', () => {
      expect(getDomainFromUrl('invalid-url')).toBe('Unknown');
    });
    
    it('should handle xvideos.red', () => {
        expect(getDomainFromUrl('https://xvideos.red/video/123')).toBe('xvideos.red');
    });
  });

  describe('formatAvatarFilename and generateTimestamp', () => {
    it('should format avatar filename with normalized values', () => {
      expect(formatAvatarFilename('YouTube', 'Eric Cartman')).toBe(
        'youtube-eric.cartman.jpg'
      );
      expect(formatAvatarFilename('YouTube!', '')).toBe('youtube-unknown.jpg');
    });

    it('should truncate very long avatar author values', () => {
      const longAuthor = 'A'.repeat(200);
      const filename = formatAvatarFilename('X', longAuthor);
      expect(filename.startsWith('x-')).toBe(true);
      expect(filename.endsWith('.jpg')).toBe(true);
      expect(filename.length).toBeLessThanOrEqual(110);
    });

    it('should generate timestamp in expected format', () => {
      const ts = generateTimestamp();
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
    });
  });
});
