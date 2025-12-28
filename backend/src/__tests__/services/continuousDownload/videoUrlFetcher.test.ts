import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoUrlFetcher } from '../../../services/continuousDownload/videoUrlFetcher';
import * as ytdlpHelpers from '../../../services/downloaders/ytdlp/ytdlpHelpers';
import * as helpers from '../../../utils/helpers';
import * as ytDlpUtils from '../../../utils/ytDlpUtils';

// Mock dependencies
vi.mock('../../../utils/ytDlpUtils');
vi.mock('../../../services/downloaders/ytdlp/ytdlpHelpers');
vi.mock('../../../utils/helpers');
vi.mock('axios');
vi.mock('../../../utils/logger');

describe('VideoUrlFetcher', () => {
  let fetcher: VideoUrlFetcher;
  const mockConfig = { proxy: 'http://proxy' };
  
  beforeEach(() => {
    vi.clearAllMocks();
    fetcher = new VideoUrlFetcher();
    
    // Default mocks
    (ytDlpUtils.getUserYtDlpConfig as any).mockReturnValue({});
    (ytDlpUtils.getNetworkConfigFromUserConfig as any).mockReturnValue(mockConfig);
    (ytdlpHelpers.getProviderScript as any).mockReturnValue(undefined);
  });

  describe('getVideoCount', () => {
    it('should return 0 for Bilibili', async () => {
      const count = await fetcher.getVideoCount('https://bilibili.com/foobar', 'Bilibili');
      expect(count).toBe(0);
    });

    it('should return 0 for YouTube channels (non-playlist)', async () => {
      const count = await fetcher.getVideoCount('https://youtube.com/@channel', 'YouTube');
      expect(count).toBe(0);
    });

    it('should return playlist count for YouTube playlists', async () => {
      (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue({ playlist_count: 42 });
      
      const count = await fetcher.getVideoCount('https://youtube.com/playlist?list=123', 'YouTube');
      
      expect(count).toBe(42);
      expect(ytDlpUtils.executeYtDlpJson).toHaveBeenCalledWith(
        expect.stringContaining('list=123'),
        expect.objectContaining({ playlistStart: 1, playlistEnd: 1 })
      );
    });

    it('should handle errors gracefully and return 0', async () => {
      (ytDlpUtils.executeYtDlpJson as any).mockRejectedValue(new Error('Fetch failed'));
      const count = await fetcher.getVideoCount('https://youtube.com/playlist?list=123', 'YouTube');
      expect(count).toBe(0);
    });
  });

  describe('getVideoUrlsIncremental', () => {
    it('should fetch range of videos for YouTube playlist', async () => {
      const mockResult = {
        entries: [
          { id: 'vid1', url: 'http://vid1' },
          { id: 'vid2', url: 'http://vid2' }
        ]
      };
      (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue(mockResult);

      const urls = await fetcher.getVideoUrlsIncremental('https://youtube.com/playlist?list=123', 'YouTube', 10, 5);

      expect(urls).toEqual(['http://vid1', 'http://vid2']);
      expect(ytDlpUtils.executeYtDlpJson).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
            playlistStart: 11, // 1-indexed (10 + 1)
            playlistEnd: 15    // 10 + 5
        })
      );
    });

    it('should skip channel entries in playlist', async () => {
       const mockResult = {
        entries: [
          { id: 'UCchannel', url: 'http://channel' }, // Should be skipped
          { id: 'vid1', url: undefined }             // Should construct URL
        ]
      };
      (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue(mockResult);

      const urls = await fetcher.getVideoUrlsIncremental('https://youtube.com/playlist?list=123', 'YouTube', 0, 10);

      expect(urls).toEqual(['https://www.youtube.com/watch?v=vid1']);
    });
  });
  
  describe('getAllVideoUrls (YouTube)', () => {
    it('should fetch all videos for channel using pagination', async () => {
        // Mock two pages
        (ytDlpUtils.executeYtDlpJson as any)
            .mockResolvedValueOnce({ entries: Array(100).fill({ id: 'vid' }) }) // Page 1 full
            .mockResolvedValueOnce({ entries: [{ id: 'vid-last' }] });          // Page 2 partial

        const urls = await fetcher.getAllVideoUrls('https://youtube.com/@channel', 'YouTube');

        expect(urls.length).toBe(101);
        expect(ytDlpUtils.executeYtDlpJson).toHaveBeenCalledTimes(2);
    });
    
     it('should handle channel URL formatting', async () => {
        (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue({ entries: [] });

        await fetcher.getAllVideoUrls('https://youtube.com/@channel/', 'YouTube');
        
        expect(ytDlpUtils.executeYtDlpJson).toHaveBeenCalledWith(
            'https://youtube.com/@channel/videos', 
            expect.anything()
        );
    });
  });
  
  describe('getBilibiliVideoUrls', () => {
    it('should throw if invalid space URL', async () => {
        (helpers.extractBilibiliMid as any).mockReturnValue(null);
        
        await expect(fetcher.getAllVideoUrls('invalid', 'Bilibili'))
            .rejects.toThrow('Invalid Bilibili space URL');
    });

    it('should use yt-dlp first', async () => {
        (helpers.extractBilibiliMid as any).mockReturnValue('123');
        (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue({
            entries: [{ id: 'BV123', url: 'http://bilibili/1' }]
        });

        const urls = await fetcher.getAllVideoUrls('http://space.bilibili.com/123', 'Bilibili');
        
        expect(urls).toContain('http://bilibili/1');
    });

    it('should fallback to API if yt-dlp returns empty', async () => {
        (helpers.extractBilibiliMid as any).mockReturnValue('123');
        (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue({ entries: [] });
        
        // Mock axios fallback
        (axios.get as any).mockResolvedValue({
            data: {
                code: 0,
                data: {
                    list: {
                        vlist: [{ bvid: 'BVfallback' }]
                    },
                    page: { count: 1 }
                }
            }
        });

        const urls = await fetcher.getAllVideoUrls('http://space.bilibili.com/123', 'Bilibili');
        
        expect(urls).toContain('https://www.bilibili.com/video/BVfallback');
        expect(axios.get).toHaveBeenCalled();
    });
  });
});
