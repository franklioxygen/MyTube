import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    extractBilibiliMid,
    extractBilibiliSeasonId,
    extractBilibiliSeriesId,
    extractBilibiliVideoId,
    extractUrlFromText,
    isBilibiliUrl,
    isValidUrl,
    resolveShortUrl,
    sanitizeFilename,
    trimBilibiliUrl,
} from '../../utils/helpers';

vi.mock('axios');

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

    it('should resolve shortened URL', async () => {
      const mockResponse = {
        request: {
          res: {
            responseUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
          },
        },
      };
      (axios.head as any).mockResolvedValue(mockResponse);

      const result = await resolveShortUrl('https://b23.tv/example');
      expect(result).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
    });

    it('should return original URL if resolution fails', async () => {
      (axios.head as any).mockRejectedValue(new Error('Network error'));

      const result = await resolveShortUrl('https://b23.tv/fail');
      expect(result).toBe('https://b23.tv/fail');
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
});
