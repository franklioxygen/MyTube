import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    extractBilibiliMid,
    extractBilibiliSeasonId,
    extractBilibiliSeriesId,
    extractBilibiliVideoId,
    extractUrlFromText,
    formatVideoFilename,
    getDomainFromUrl,
    isBilibiliUrl,
    isYouTubeUrl,
    isValidUrl,
    normalizeYouTubeAuthorUrl,
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
  });

  describe('extractBilibiliSeriesId', () => {
    it('should extract series_id', () => {
      expect(extractBilibiliSeriesId('https://www.bilibili.com/video/BV1xx?series_id=789')).toBe('789');
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

    it('should truncate filenames exceeding 200 characters', () => {
        const longTitle = 'a'.repeat(300);
        const author = 'Author';
        const year = '2023';
        const result = formatVideoFilename(longTitle, author, year);
        
        expect(result.length).toBeLessThanOrEqual(200);
        expect(result).toContain('Author');
        expect(result).toContain('2023');
        // Suffix is -Author-2023 (12 chars)
        // Title should be 200 - 12 = 188 chars
        expect(result.length).toBe(200);
    });

    it('should truncate very long author names', () => {
        const title = 'Video';
        const longAuthor = 'a'.repeat(100);
        const year = '2023';
        const result = formatVideoFilename(title, longAuthor, year);
        
        // Author truncated to 50
        // Suffix: -[50 chars]-2023 -> 1 + 50 + 1 + 4 = 56 chars
        // Title: Video (5 chars)
        // Total: 5 + 56 = 61 chars
        expect(result.length).toBe(61);
        expect(result).toContain(title);
        // Should contain 50 'a's
        expect(result).toContain('a'.repeat(50));
        expect(result).not.toContain('a'.repeat(51));
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
});
