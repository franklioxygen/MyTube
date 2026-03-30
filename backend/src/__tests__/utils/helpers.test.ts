import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    extractMissAVVideoId,
    extractSourceVideoId,
    extractTwitchChannelLogin,
    extractTwitchVideoId,
    extractYouTubeVideoId,
    extractBilibiliMid,
    extractBilibiliSeasonId,
    extractBilibiliSeriesId,
    extractBilibiliVideoId,
    extractUrlFromText,
    formatAvatarFilename,
    formatVideoFilename,
    generateTimestamp,
    getDomainFromUrl,
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
    sanitizeFilename,
    trimBilibiliUrl
} from '../../utils/helpers';

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
    });

    it('should normalize and return whitelisted short URL', async () => {
      const result = await resolveShortUrl('https://b23.tv/example');
      expect(result).toBe('https://b23.tv/example');
    });

    it('should return normalized short URL without outbound resolution', async () => {
      const result = await resolveShortUrl('https://b23.tv/fail');
      expect(result).toBe('https://b23.tv/fail');
    });

    it('should keep short URL path unchanged', async () => {
      const result = await resolveShortUrl('https://b23.tv/example');
      expect(result).toBe('https://b23.tv/example');
    });

    it('should reject non-whitelisted short URL hosts', async () => {
      await expect(resolveShortUrl('https://example.com/test')).rejects.toThrow('Invalid URL');
    });

    it('should reject short URL with credentials', async () => {
      await expect(resolveShortUrl('https://user:pass@b23.tv/example')).rejects.toThrow('Invalid URL');
    });

    it('should return normalized short URL with explicit path', async () => {
      const result = await resolveShortUrl('https://b23.tv/example');
      expect(result).toBe('https://b23.tv/example');
    });

    it('should reject invalid protocol and normalize traversal paths', async () => {
      await expect(resolveShortUrl('ftp://b23.tv/test')).rejects.toThrow('Invalid URL');
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

    it('should remove query parameters if no video ID found', () => {
      const url = 'https://www.bilibili.com/read/cv123456?from=search';
      expect(trimBilibiliUrl(url)).toBe('https://www.bilibili.com/read/cv123456');
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
    });

    it('should return null for invalid missav urls', () => {
      expect(extractMissAVVideoId('not-a-url')).toBe(null);
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

  describe('extractBilibiliSeasonId', () => {
    it('should extract season_id', () => {
      expect(extractBilibiliSeasonId('https://www.bilibili.com/bangumi/play/ss123?season_id=456')).toBe('456');
    });

    it('should return null for invalid season URL', () => {
      expect(extractBilibiliSeasonId('not-url')).toBe(null);
    });
  });

  describe('extractBilibiliSeriesId', () => {
    it('should extract series_id', () => {
      expect(extractBilibiliSeriesId('https://www.bilibili.com/video/BV1xx?series_id=789')).toBe('789');
    });

    it('should return null for invalid series URL', () => {
      expect(extractBilibiliSeriesId('not-url')).toBe(null);
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
