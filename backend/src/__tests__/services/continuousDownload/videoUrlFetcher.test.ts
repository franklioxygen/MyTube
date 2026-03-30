import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sortVideoEntries, VideoUrlFetcher } from '../../../services/continuousDownload/videoUrlFetcher';
import * as downloadService from '../../../services/downloadService';
import * as bilibiliCollection from '../../../services/downloaders/bilibili/bilibiliCollection';
import * as ytdlpTwitch from '../../../services/downloaders/ytdlp/ytdlpTwitch';
import * as twitchService from '../../../services/twitchService';
import * as ytdlpHelpers from '../../../services/downloaders/ytdlp/ytdlpHelpers';
import * as helpers from '../../../utils/helpers';
import * as ytDlpUtils from '../../../utils/ytDlpUtils';

// Mock dependencies
vi.mock('../../../utils/ytDlpUtils');
vi.mock('../../../services/downloaders/ytdlp/ytdlpHelpers');
vi.mock('../../../utils/helpers');
vi.mock('../../../services/downloadService', () => ({
  checkBilibiliCollectionOrSeries: vi.fn(),
}));
vi.mock('../../../services/downloaders/bilibili/bilibiliCollection', () => ({
  getCollectionVideos: vi.fn(),
  getSeriesVideos: vi.fn(),
}));
vi.mock('../../../services/downloaders/ytdlp/ytdlpTwitch', () => ({
  getTwitchChannelVideos: vi.fn(),
}));
vi.mock('../../../services/twitchService', () => ({
  twitchApiService: {
    isConfigured: vi.fn(),
    getChannelByLogin: vi.fn(),
    listVideosByBroadcaster: vi.fn(),
  },
}));
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
    (helpers.extractBilibiliMid as any).mockReturnValue('123');
    (helpers.extractBilibiliVideoId as any).mockReturnValue(null);
    (helpers.extractTwitchChannelLogin as any).mockReturnValue('streamer');
    (helpers.normalizeTwitchChannelUrl as any).mockImplementation((url: string) => url);
    (twitchService.twitchApiService.isConfigured as any).mockReturnValue(true);
    (downloadService.checkBilibiliCollectionOrSeries as any).mockResolvedValue({
      success: false,
      type: 'none',
    });
    (bilibiliCollection.getCollectionVideos as any).mockResolvedValue({
      success: false,
      videos: [],
    });
    (bilibiliCollection.getSeriesVideos as any).mockResolvedValue({
      success: false,
      videos: [],
    });
  });

  describe('sortVideoEntries', () => {
    const baseEntries = [
      { url: 'u1', uploadDate: '20240201', viewCount: 100, sourceIndex: 0 },
      { url: 'u2', uploadDate: '20240101', viewCount: 500, sourceIndex: 1 },
      { url: 'u3', uploadDate: '20240101', viewCount: 500, sourceIndex: 2 },
      { url: 'u4', uploadDate: '20230101', viewCount: 1, sourceIndex: 3 },
    ];

    it('should sort by dateDesc (newest first)', () => {
      const sorted = sortVideoEntries(baseEntries, 'dateDesc');
      expect(sorted.map((x) => x.url)).toEqual(['u1', 'u2', 'u3', 'u4']);
    });

    it('should sort by dateAsc (oldest first)', () => {
      const sorted = sortVideoEntries(baseEntries, 'dateAsc');
      expect(sorted.map((x) => x.url)).toEqual(['u4', 'u2', 'u3', 'u1']);
    });

    it('should sort by viewsDesc with uploadDate as tie-breaker', () => {
      const sorted = sortVideoEntries(baseEntries, 'viewsDesc');
      expect(sorted.map((x) => x.url)).toEqual(['u2', 'u3', 'u1', 'u4']);
    });

    it('should sort by viewsAsc with uploadDate as tie-breaker', () => {
      const sorted = sortVideoEntries(baseEntries, 'viewsAsc');
      expect(sorted.map((x) => x.url)).toEqual(['u4', 'u1', 'u2', 'u3']);
    });

    it('should keep deterministic order when primary and secondary keys tie', () => {
      const tied = [
        { url: 't1', uploadDate: '20240101', viewCount: 10, sourceIndex: 8 },
        { url: 't2', uploadDate: '20240101', viewCount: 10, sourceIndex: 3 },
        { url: 't3', uploadDate: '20240101', viewCount: 10, sourceIndex: 5 },
      ];
      const sorted = sortVideoEntries(tied, 'viewsDesc');
      expect(sorted.map((x) => x.url)).toEqual(['t2', 't3', 't1']);
    });
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

    it('should include provider extractor args when provider script exists', async () => {
      (ytdlpHelpers.getProviderScript as any).mockReturnValue('/tmp/provider.js');
      (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue({});

      const count = await fetcher.getVideoCount(
        'https://youtube.com/playlist?list=123',
        'YouTube'
      );

      expect(count).toBe(0);
      expect(ytDlpUtils.executeYtDlpJson).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          extractorArgs: 'youtubepot-bgutilscript:script_path=/tmp/provider.js',
        })
      );
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

    it('should return empty array when playlist batch fetch throws', async () => {
      (ytDlpUtils.executeYtDlpJson as any).mockRejectedValue(
        new Error('playlist batch failed')
      );

      const urls = await fetcher.getVideoUrlsIncremental(
        'https://youtube.com/playlist?list=123',
        'YouTube',
        0,
        10
      );

      expect(urls).toEqual([]);
    });

    it('should delegate non-playlist incremental requests to full YouTube fetch', async () => {
      const allSpy = vi
        .spyOn(fetcher as any, 'getYouTubeVideoUrls')
        .mockResolvedValue(['https://youtube.com/watch?v=delegated']);

      const urls = await fetcher.getVideoUrlsIncremental(
        'https://youtube.com/@channel',
        'YouTube',
        3,
        5
      );

      expect(urls).toEqual(['https://youtube.com/watch?v=delegated']);
      allSpy.mockRestore();
    });

    it('should rethrow incremental fetch errors', async () => {
      const incrementalSpy = vi
        .spyOn(fetcher as any, 'getYouTubeVideoUrlsIncremental')
        .mockRejectedValue(new Error('incremental exploded'));

      await expect(
        fetcher.getVideoUrlsIncremental(
          'https://youtube.com/@channel',
          'YouTube',
          0,
          10
        )
      ).rejects.toThrow('incremental exploded');

      incrementalSpy.mockRestore();
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

    it('should return empty for playlist when first page is empty', async () => {
      (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue({ entries: [] });

      const urls = await fetcher.getAllVideoUrls(
        'https://youtube.com/playlist?list=empty',
        'YouTube'
      );

      expect(urls).toEqual([]);
    });

    it('should stop playlist pagination when page fetch fails', async () => {
      (ytdlpHelpers.getProviderScript as any).mockReturnValue('/tmp/provider.js');
      (ytDlpUtils.executeYtDlpJson as any).mockRejectedValue(
        new Error('playlist page failed')
      );

      const urls = await fetcher.getAllVideoUrls(
        'https://youtube.com/playlist?list=boom',
        'YouTube'
      );

      expect(urls).toEqual([]);
      expect(ytDlpUtils.executeYtDlpJson).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          extractorArgs: 'youtubepot-bgutilscript:script_path=/tmp/provider.js',
        })
      );
    });

    it('should stop channel pagination when page fetch fails', async () => {
      (ytDlpUtils.executeYtDlpJson as any).mockRejectedValue(
        new Error('channel page failed')
      );

      const urls = await fetcher.getAllVideoUrls(
        'https://youtube.com/@channel/',
        'YouTube'
      );

      expect(urls).toEqual([]);
      expect(ytDlpUtils.executeYtDlpJson).toHaveBeenCalledWith(
        'https://youtube.com/@channel/videos',
        expect.anything()
      );
    });

    it('should rethrow top-level all-videos errors', async () => {
      const allSpy = vi
        .spyOn(fetcher as any, 'getYouTubeVideoUrls')
        .mockRejectedValue(new Error('all videos exploded'));

      await expect(
        fetcher.getAllVideoUrls('https://youtube.com/@channel', 'YouTube')
      ).rejects.toThrow('all videos exploded');

      allSpy.mockRestore();
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

    it('should resolve collection videos from a bilibili video URL', async () => {
      (helpers.extractBilibiliMid as any).mockReturnValue(null);
      (helpers.extractBilibiliVideoId as any).mockReturnValue('BVCOLL');
      (downloadService.checkBilibiliCollectionOrSeries as any).mockResolvedValue({
        success: true,
        type: 'collection',
        mid: 100,
        id: 200,
      });
      (bilibiliCollection.getCollectionVideos as any).mockResolvedValue({
        success: true,
        videos: [{ bvid: 'BV111' }, { bvid: 'BV222' }],
      });

      const urls = await fetcher.getAllVideoUrls(
        'https://www.bilibili.com/video/BVCOLL',
        'Bilibili'
      );

      expect(urls).toEqual([
        'https://www.bilibili.com/video/BV111',
        'https://www.bilibili.com/video/BV222',
      ]);
      expect(bilibiliCollection.getCollectionVideos).toHaveBeenCalledWith(100, 200);
    });

    it('should resolve series videos and apply incremental slicing', async () => {
      (helpers.extractBilibiliMid as any).mockReturnValue(null);
      (helpers.extractBilibiliVideoId as any).mockReturnValue('BVSERIES');
      (downloadService.checkBilibiliCollectionOrSeries as any).mockResolvedValue({
        success: true,
        type: 'series',
        mid: 300,
        id: 400,
      });
      (bilibiliCollection.getSeriesVideos as any).mockResolvedValue({
        success: true,
        videos: [{ bvid: 'BV1' }, { bvid: 'BV2' }, { bvid: 'BV3' }],
      });

      const urls = await fetcher.getVideoUrlsIncremental(
        'https://www.bilibili.com/video/BVSERIES',
        'Bilibili',
        1,
        1
      );

      expect(urls).toEqual(['https://www.bilibili.com/video/BV2']);
      expect(bilibiliCollection.getSeriesVideos).toHaveBeenCalledWith(300, 400);
    });

    it('should throw on unsupported collection type from bilibili metadata', async () => {
      (helpers.extractBilibiliMid as any).mockReturnValue(null);
      (helpers.extractBilibiliVideoId as any).mockReturnValue('BVX');
      (downloadService.checkBilibiliCollectionOrSeries as any).mockResolvedValue({
        success: true,
        type: 'unsupported',
        mid: 1,
        id: 2,
      });

      await expect(
        fetcher.getAllVideoUrls('https://www.bilibili.com/video/BVX', 'Bilibili')
      ).rejects.toThrow('Unsupported Bilibili type: unsupported');
    });

    it('should throw when collection lookup succeeds but returns no videos', async () => {
      (helpers.extractBilibiliMid as any).mockReturnValue(null);
      (helpers.extractBilibiliVideoId as any).mockReturnValue('BVEMPTY');
      (downloadService.checkBilibiliCollectionOrSeries as any).mockResolvedValue({
        success: true,
        type: 'series',
        mid: 1,
        id: 2,
      });
      (bilibiliCollection.getSeriesVideos as any).mockResolvedValue({
        success: false,
        videos: [],
      });

      await expect(
        fetcher.getAllVideoUrls('https://www.bilibili.com/video/BVEMPTY', 'Bilibili')
      ).rejects.toThrow('Failed to get videos from series');
    });

    it('should handle yt-dlp and API fallback failures gracefully', async () => {
      (helpers.extractBilibiliMid as any).mockReturnValue('999');
      (ytDlpUtils.executeYtDlpJson as any).mockRejectedValue(
        new Error('yt-dlp page failed')
      );
      (axios.get as any).mockRejectedValue(new Error('api failed'));

      const urls = await fetcher.getAllVideoUrls(
        'https://space.bilibili.com/999',
        'Bilibili'
      );

      expect(urls).toEqual([]);
      expect(axios.get).toHaveBeenCalled();
    });

    it('should stop API fallback loop on invalid response payload', async () => {
      (helpers.extractBilibiliMid as any).mockReturnValue('1000');
      (ytDlpUtils.executeYtDlpJson as any).mockResolvedValue({ entries: [] });
      (axios.get as any).mockResolvedValue({ data: { code: 1 } });

      const urls = await fetcher.getAllVideoUrls(
        'https://space.bilibili.com/1000',
        'Bilibili'
      );

      expect(urls).toEqual([]);
      expect(axios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAllVideoEntries', () => {
    it('should include Bilibili metadata from collection API when available', async () => {
      (helpers.extractBilibiliMid as any).mockReturnValue(null);
      (helpers.extractBilibiliVideoId as any).mockReturnValue('BVCOLL');
      (downloadService.checkBilibiliCollectionOrSeries as any).mockResolvedValue({
        success: true,
        type: 'collection',
        mid: 100,
        id: 200,
      });
      (bilibiliCollection.getCollectionVideos as any).mockResolvedValue({
        success: true,
        videos: [
          { bvid: 'BV111', uploadDate: '20240220', viewCount: 1234 },
          { bvid: 'BV222', uploadDate: '20240219', viewCount: 12 },
        ],
      });

      const entries = await fetcher.getAllVideoEntries(
        'https://www.bilibili.com/video/BVCOLL',
        'Bilibili'
      );

      expect(entries).toEqual([
        {
          url: 'https://www.bilibili.com/video/BV111',
          uploadDate: '20240220',
          viewCount: 1234,
          sourceIndex: 0,
        },
        {
          url: 'https://www.bilibili.com/video/BV222',
          uploadDate: '20240219',
          viewCount: 12,
          sourceIndex: 1,
        },
      ]);
    });

    it('should collect Twitch archives and uploads with pagination metadata', async () => {
      (twitchService.twitchApiService.isConfigured as any).mockReturnValue(true);
      (helpers.normalizeTwitchChannelUrl as any).mockReturnValue(
        'https://www.twitch.tv/streamer'
      );
      (helpers.extractTwitchChannelLogin as any).mockReturnValue('streamer');
      (twitchService.twitchApiService.getChannelByLogin as any).mockResolvedValue({
        id: 'user-1',
        login: 'streamer',
        displayName: 'Streamer',
        url: 'https://www.twitch.tv/streamer',
      });
      (twitchService.twitchApiService.listVideosByBroadcaster as any)
        .mockResolvedValueOnce({
          videos: [
            {
              id: 'archive-1',
              url: 'https://www.twitch.tv/videos/101',
              publishedAt: '2026-03-04T10:00:00Z',
              viewCount: 550,
            },
          ],
          cursor: 'archives-next',
        })
        .mockResolvedValueOnce({
          videos: [
            {
              id: 'archive-2',
              url: 'https://www.twitch.tv/videos/102',
              publishedAt: '2026-03-03T11:00:00Z',
              viewCount: 120,
            },
          ],
          cursor: undefined,
        })
        .mockResolvedValueOnce({
          videos: [
            {
              id: 'upload-1',
              url: 'https://www.twitch.tv/videos/201',
              publishedAt: '2026-03-02T12:00:00Z',
              viewCount: 9000,
            },
          ],
          cursor: undefined,
        });

      const entries = await fetcher.getAllVideoEntries(
        'https://www.twitch.tv/streamer/videos',
        'Twitch'
      );

      expect(entries).toEqual([
        {
          url: 'https://www.twitch.tv/videos/101',
          uploadDate: '20260304',
          viewCount: 550,
          sourceIndex: 0,
        },
        {
          url: 'https://www.twitch.tv/videos/102',
          uploadDate: '20260303',
          viewCount: 120,
          sourceIndex: 1,
        },
        {
          url: 'https://www.twitch.tv/videos/201',
          uploadDate: '20260302',
          viewCount: 9000,
          sourceIndex: 2,
        },
      ]);
      expect(twitchService.twitchApiService.listVideosByBroadcaster).toHaveBeenNthCalledWith(
        1,
        'user-1',
        { after: undefined, first: 100, type: 'archive' }
      );
      expect(twitchService.twitchApiService.listVideosByBroadcaster).toHaveBeenNthCalledWith(
        2,
        'user-1',
        { after: 'archives-next', first: 100, type: 'archive' }
      );
      expect(twitchService.twitchApiService.listVideosByBroadcaster).toHaveBeenNthCalledWith(
        3,
        'user-1',
        { after: undefined, first: 100, type: 'upload' }
      );
    });

    it('should collect Twitch entries via yt-dlp when credentials are not configured', async () => {
      (twitchService.twitchApiService.isConfigured as any).mockReturnValue(false);
      (helpers.normalizeTwitchChannelUrl as any).mockReturnValue(
        'https://www.twitch.tv/streamer'
      );
      (helpers.extractTwitchChannelLogin as any).mockReturnValue('streamer');
      (ytdlpTwitch.getTwitchChannelVideos as any)
        .mockResolvedValueOnce({
          channelName: 'Streamer',
          channelLogin: 'streamer',
          videos: [
            {
              id: '3001',
              url: 'https://www.twitch.tv/videos/3001',
              title: 'Fallback newest',
              author: 'Streamer',
              authorLogin: 'streamer',
              uploadDate: '20260304',
              viewCount: 123,
              sourceIndex: 0,
            },
            {
              id: '3000',
              url: 'https://www.twitch.tv/videos/3000',
              title: 'Fallback older',
              author: 'Streamer',
              authorLogin: 'streamer',
              uploadDate: '20260303',
              viewCount: 45,
              sourceIndex: 1,
            },
          ],
        })
        .mockResolvedValueOnce({
          channelName: 'Streamer',
          channelLogin: 'streamer',
          videos: [],
        });

      const entries = await fetcher.getAllVideoEntries(
        'https://www.twitch.tv/streamer/videos',
        'Twitch'
      );

      expect(entries).toEqual([
        {
          url: 'https://www.twitch.tv/videos/3001',
          uploadDate: '20260304',
          viewCount: 123,
          sourceIndex: 0,
        },
        {
          url: 'https://www.twitch.tv/videos/3000',
          uploadDate: '20260303',
          viewCount: 45,
          sourceIndex: 1,
        },
      ]);
      expect(ytdlpTwitch.getTwitchChannelVideos).toHaveBeenNthCalledWith(1, 'https://www.twitch.tv/streamer', {
        startIndex: 0,
        limit: 100,
      });
      expect(ytdlpTwitch.getTwitchChannelVideos).toHaveBeenCalledTimes(1);
    });

    it('should return Twitch URLs through the full-fetch path', async () => {
      (twitchService.twitchApiService.isConfigured as any).mockReturnValue(true);
      (twitchService.twitchApiService.getChannelByLogin as any).mockResolvedValue({
        id: 'user-1',
        login: 'streamer',
        displayName: 'Streamer',
        url: 'https://www.twitch.tv/streamer',
      });
      (twitchService.twitchApiService.listVideosByBroadcaster as any)
        .mockResolvedValueOnce({
          videos: [
            {
              id: 'archive-1',
              url: 'https://www.twitch.tv/videos/101',
              publishedAt: '2026-03-04T10:00:00Z',
              viewCount: 550,
            },
          ],
          cursor: undefined,
        })
        .mockResolvedValueOnce({
          videos: [],
          cursor: undefined,
        });

      const urls = await fetcher.getAllVideoUrls(
        'https://www.twitch.tv/streamer',
        'Twitch'
      );

      expect(urls).toEqual(['https://www.twitch.tv/videos/101']);
    });
  });
});
