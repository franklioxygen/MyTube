import { beforeEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
import { db } from '../../db';
import { DuplicateError, NotFoundError, ValidationError } from '../../errors/DownloadErrors';
import { BilibiliDownloader } from '../../services/downloaders/BilibiliDownloader';
import { getProviderScript } from '../../services/downloaders/ytdlp/ytdlpHelpers';
import { YtDlpDownloader } from '../../services/downloaders/YtDlpDownloader';
import * as downloadService from '../../services/downloadService';
import * as storageService from '../../services/storageService';
import { subscriptionService } from '../../services/subscriptionService';
import { TelegramService } from '../../services/telegramService';
import { executeYtDlpJson } from '../../utils/ytDlpUtils';

// Test setup
vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  }
}));

// Mock schema to avoid actual DB dependency issues in table definitions if any
vi.mock('../../db/schema', () => ({
  subscriptions: {
    id: 'id',
    author: 'author',
    authorUrl: 'authorUrl',
    retentionDays: 'retentionDays',
    collectionId: 'collectionId',
    // add other fields if needed for referencing columns
  }
}));

vi.mock('../../services/downloadService');
vi.mock('../../services/storageService');
// Passthrough queue: execute the downloadFn immediately and resolve with its
// result, so every existing assertion on downloadService.* still validates
// the real subscription semantics.
vi.mock('../../services/downloadManager', () => ({
  default: {
    addDownload: vi.fn(
      (downloadFn: (registerCancel: (cancel: () => void) => void) => Promise<unknown>) =>
        downloadFn(vi.fn())
    ),
  },
}));
vi.mock('../../services/telegramService', () => ({
  TelegramService: {
    notifyTaskComplete: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../services/subscriptionRetentionService', () => ({
  runSubscriptionRetentionCleanup: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/downloaders/BilibiliDownloader');
vi.mock('../../services/downloaders/BilibiliDownloader');
vi.mock('../../services/downloaders/YtDlpDownloader');
vi.mock('../../services/downloaders/ytdlp/ytdlpHelpers', () => ({
  getProviderScript: vi.fn(),
}));
vi.mock('../../utils/ytDlpUtils', () => ({
  executeYtDlpJson: vi.fn(),
  getUserYtDlpConfig: vi.fn().mockReturnValue({}),
  getEffectiveUserYtDlpConfig: vi.fn().mockReturnValue({}),
  getNetworkConfigFromUserConfig: vi.fn().mockReturnValue({}),
}));
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  }
}));

// Mock UUID to predict IDs
vi.mock('uuid', () => ({
  v4: () => 'test-uuid'
}));

describe('SubscriptionService', () => {
  // Setup chainable db mocks
  const createMockQueryBuilder = (result: any) => {
    const builder: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(result).then(resolve)
    };
    // Circular references for chaining
    builder.from.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    builder.limit.mockReturnValue(builder);
    builder.values.mockReturnValue(builder);
    builder.set.mockReturnValue(builder);
    builder.returning.mockReturnValue(builder);
    
    return builder;
  };
  
  let mockBuilder: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProviderScript).mockReturnValue('');
    
    mockBuilder = createMockQueryBuilder([]);

    (db.select as any).mockReturnValue(mockBuilder);
    (db.insert as any).mockReturnValue(mockBuilder);
    (db.delete as any).mockReturnValue(mockBuilder);
    (db.update as any).mockReturnValue(mockBuilder);
  });

  describe('subscribe', () => {
    it('should subscribe to a YouTube channel', async () => {
      const url = 'https://www.youtube.com/@testuser';
      // Mock empty result for "where" check (no existing sub)
      // Since we use the same builder for everything, we just rely on it returning empty array by default
      // Mock insert result?
      (executeYtDlpJson as any).mockResolvedValue({ uploader: 'User' });
      
      const result = await subscriptionService.subscribe(url, 60, undefined, true);

      expect(result).toMatchObject({
        id: 'test-uuid',
        author: 'User',
        platform: 'YouTube',
        interval: 60,
        downloadShorts: 1
      });
      expect(db.insert).toHaveBeenCalled();
      expect(mockBuilder.values).toHaveBeenCalled();
    });

    it('should subscribe to a Bilibili space', async () => {
      const url = 'https://space.bilibili.com/123456';
      // Default mock builder returns empty array which satisfies "not existing"
      (BilibiliDownloader.getAuthorInfo as any).mockResolvedValue({ name: 'BilibiliUser' });

      const result = await subscriptionService.subscribe(url, 30);

      expect(result).toMatchObject({
        author: 'BilibiliUser',
        platform: 'Bilibili'
      });
      expect(db.insert).toHaveBeenCalled();
    });

    it('should throw DuplicateError if already subscribed', async () => {
      const url = 'https://www.youtube.com/@testuser';
      mockBuilder.then = (cb: any) => Promise.resolve([{ id: 'existing' }]).then(cb);

      (executeYtDlpJson as any).mockResolvedValue({ uploader: 'User' });

      await expect(subscriptionService.subscribe(url, 60))
        .rejects.toThrow(DuplicateError);
    });

    it('should throw ValidationError for unsupported URL', async () => {
        const url = 'https://example.com/user';
        await expect(subscriptionService.subscribe(url, 60))
          .rejects.toThrow(ValidationError);
      });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe successfully', async () => {
      const subId = 'sub-1';
      // Existence check returns the subscription; the delete reports one row changed.
      mockBuilder.then = (cb: any) =>
        Promise.resolve([{ id: subId, author: 'User', platform: 'YouTube' }]).then(cb);
      mockBuilder.run = vi.fn().mockReturnValue({ changes: 1 });

      await subscriptionService.unsubscribe(subId);

      expect(db.delete).toHaveBeenCalled();
    });

    it('should handle non-existent subscription gracefully', async () => {
      const subId = 'non-existent';
      // First call returns empty
      mockBuilder.then = (cb: any) => Promise.resolve([]).then(cb);

      await subscriptionService.unsubscribe(subId);

      expect(db.delete).not.toHaveBeenCalled();
    });
  });

  describe('checkSubscriptions', () => {
    it('should check subscriptions and download new video', async () => {
      const sub = {
        id: 'sub-1',
        author: 'User',
        platform: 'YouTube',
        authorUrl: 'url',
        lastCheck: 0,
        interval: 10,
        lastVideoLink: 'old-link'
      };

      // We need to handle multiple queries here.
      // 1. listSubscriptions
      // Then loop:
      // 2. verify existence
      // 3. update (in case of success/failure)

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount > 1) return Promise.resolve([sub]).then(cb); // verify existence, updates etc.
        return Promise.resolve([]).then(cb); // subsequents return array
      };

      // Mock getting latest video
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('new-link');

      // Mock download
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
        videoData: { id: 'vid-1', title: 'New Video' }
      });
      
      await subscriptionService.checkSubscriptions();

      expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith(
        'new-link',
        expect.objectContaining({
          downloadId: 'test-uuid',
          onStart: expect.any(Function),
          filenameTemplateSourceOptions: expect.objectContaining({
            sourceCustomName: 'User',
            sourceCollectionName: 'User',
            sourceCollectionType: 'channel',
          }),
          subscriptionYtdlpConfig: undefined,
        })
      );
      expect(storageService.addDownloadHistoryItem).toHaveBeenCalledWith(expect.objectContaining({
        status: 'success'
      }));
      expect(TelegramService.notifyTaskComplete).toHaveBeenCalledWith({
        taskTitle: 'New Video',
        status: 'success',
        sourceUrl: 'new-link',
      });
      expect(db.update).toHaveBeenCalled();
    });

    it('should check and download Shorts if enabled', async () => {
      const sub = {
        id: 'sub-shorts',
        author: 'User',
        platform: 'YouTube',
        authorUrl: 'url',
        lastCheck: 0,
        interval: 10,
        lastVideoLink: 'same-link',
        downloadShorts: 1,
        lastShortVideoLink: 'old-short'
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        return Promise.resolve([sub]).then(cb);
      };

      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');
      (YtDlpDownloader.getLatestShortsUrl as any).mockResolvedValue('new-short');
      
      (downloadService.downloadYouTubeVideo as any)
          .mockResolvedValueOnce({ videoData: { id: 'vid-short', title: 'New Short' } });

      await subscriptionService.checkSubscriptions();

      expect(YtDlpDownloader.getLatestShortsUrl).toHaveBeenCalled();
      expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith(
        'new-short',
        expect.objectContaining({
          downloadId: 'test-uuid',
          onStart: expect.any(Function),
          filenameTemplateSourceOptions: expect.objectContaining({
            sourceCustomName: 'User',
            sourceCollectionName: 'User',
            sourceCollectionType: 'channel',
          }),
          subscriptionYtdlpConfig: undefined,
        })
      );
      expect(TelegramService.notifyTaskComplete).toHaveBeenCalledWith({
        taskTitle: 'New Short',
        status: 'success',
        sourceUrl: 'new-short',
      });
      expect(db.update).toHaveBeenCalled();
    });

    it('should skip if no new video', async () => {
      const sub = {
        id: 'sub-1',
        author: 'User',
        platform: 'YouTube',
        authorUrl: 'url',
        lastCheck: 0,
        interval: 10,
        lastVideoLink: 'same-link'
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([sub]).then(cb); // verify existence (lastCheck)
        if (callCount === 3) return Promise.resolve([sub]).then(cb); // verify existence (update)
        return Promise.resolve([sub]).then(cb); // updates return row
      };

      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');

      await subscriptionService.checkSubscriptions();

      expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
      // Should still update lastCheck
      expect(db.update).toHaveBeenCalled();
    });

    it('polls Bilibili collection playlist subscriptions through the collection API', async () => {
      const sub = {
        id: 'bili-playlist-sub',
        author: '合集标题 - Bilibili 12345',
        platform: 'Bilibili',
        authorUrl: 'https://www.bilibili.com/video/BVseed',
        lastCheck: 0,
        interval: 10,
        lastVideoLink: 'https://www.bilibili.com/video/BVold',
        subscriptionType: 'playlist',
        playlistId: '9988',
        collectionId: 'existing-col',
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb);
        return Promise.resolve([sub]).then(cb);
      };
      (storageService.getCollectionById as any).mockReturnValue({
        id: 'existing-col',
        sourcePlatform: 'bilibili',
        sourceType: 'collection',
        sourceMid: '12345',
        sourceId: '9988',
      });
      (downloadService.getBilibiliCollectionVideos as any).mockResolvedValue({
        success: true,
        videos: [{ bvid: 'BVnew', title: 'New', aid: 1 }],
      });
      (downloadService.downloadSingleBilibiliPart as any).mockResolvedValue({
        videoData: { id: 'video-new', title: 'New Bili Video' },
      });

      await subscriptionService.checkSubscriptions();

      expect(downloadService.getBilibiliCollectionVideos).toHaveBeenCalledWith(
        12345,
        9988,
        { pageSize: 1, maxPages: 1 }
      );
      expect(executeYtDlpJson).not.toHaveBeenCalled();
      expect(downloadService.downloadSingleBilibiliPart).toHaveBeenCalledWith(
        'https://www.bilibili.com/video/BVnew',
        1,
        1,
        '',
        'test-uuid',
        expect.any(Function),
        undefined,
        expect.objectContaining({
          sourceCollectionId: '9988',
          sourceCollectionType: 'playlist',
        }),
        { subscriptionYtdlpConfig: undefined }
      );
      expect(storageService.addVideoToCollection).toHaveBeenCalledWith(
        'existing-col',
        'video-new'
      );
    });

    it('updates lastCheck when a playlist probe fails to back off retries', async () => {
      const sub = {
        id: 'playlist-probe-fail-sub',
        author: 'Playlist Author',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/playlist?list=PLFAIL',
        interval: 60,
        lastCheck: 0,
        lastVideoLink: 'https://www.youtube.com/watch?v=old',
        subscriptionType: 'playlist',
        collectionId: 'collection-1',
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb);
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb);
        return Promise.resolve([]).then(cb);
      };
      const recordSpy = vi
        .spyOn(subscriptionService as any, 'recordSubscriptionCheckCompleted')
        .mockResolvedValue(undefined);
      (executeYtDlpJson as any).mockRejectedValue(
        new Error('playlist lookup failed')
      );

      await subscriptionService.checkSubscriptions();

      expect(mockBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({ lastCheck: expect.any(Number) })
      );
      expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
      expect(recordSpy).toHaveBeenCalledWith(
        sub,
        'fail',
        expect.objectContaining({ failureReason: expect.any(String) })
      );

      recordSpy.mockRestore();
    });

    it('should skip shorts when subscription is deleted before lastCheck update', async () => {
      const sub = {
        id: 'sub-deleted',
        author: 'User',
        platform: 'YouTube',
        authorUrl: 'url',
        lastCheck: 0,
        interval: 10,
        lastVideoLink: 'same-link',
        downloadShorts: 1,
        lastShortVideoLink: 'old-short'
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([]).then(cb); // update lastCheck returns 0 rows
        return Promise.resolve([]).then(cb);
      };

      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');

      await subscriptionService.checkSubscriptions();

      expect(YtDlpDownloader.getLatestShortsUrl).not.toHaveBeenCalled();
      expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
    });
  });

  describe('checkSubscriptions concurrency', () => {
    const makeSub = (id: string) => ({
      id,
      author: `Author-${id}`,
      platform: 'YouTube',
      authorUrl: `https://youtube.com/@${id}`,
      lastCheck: 0,
      interval: 10,
      lastVideoLink: 'same-link',
    });

    // First select is listSubscriptions; every later builder await (lastCheck
    // updates etc.) returns a matched row.
    const primeListSubscriptions = (subs: unknown[]) => {
      let firstSelect = true;
      mockBuilder.then = (cb: any) => {
        if (firstSelect) {
          firstSelect = false;
          return Promise.resolve(subs).then(cb);
        }
        return Promise.resolve([{ id: 'row' }]).then(cb);
      };
    };

    it('checks due subscriptions with bounded concurrency and completes all of them', async () => {
      const subs = ['s1', 's2', 's3', 's4', 's5'].map(makeSub);
      primeListSubscriptions(subs);

      let inFlight = 0;
      let maxInFlight = 0;
      const release: Array<() => void> = [];
      (YtDlpDownloader.getLatestVideoUrl as any).mockImplementation(() => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<string>((resolve) => {
          release.push(() => {
            inFlight--;
            resolve('same-link'); // no new video -> no download path
          });
        });
      });

      // Drain probes as they appear (macrotask, so pending microtask work —
      // i.e. starting the next batch of probes — settles first).
      const drain = setInterval(() => {
        while (release.length > 0) release.shift()!();
      }, 0);
      try {
        await subscriptionService.checkSubscriptions();
      } finally {
        clearInterval(drain);
      }

      expect(YtDlpDownloader.getLatestVideoUrl).toHaveBeenCalledTimes(5);
      // The bound is the hard invariant: never more than CHECK_CONCURRENCY.
      expect(maxInFlight).toBeLessThanOrEqual(3);
      // And the sweep actually used the parallelism instead of serializing.
      expect(maxInFlight).toBeGreaterThan(1);
    });

    it('keeps checking other subscriptions when one probe fails', async () => {
      const subs = ['fails', 'works'].map(makeSub);
      primeListSubscriptions(subs);

      (YtDlpDownloader.getLatestVideoUrl as any).mockImplementation(
        (url: string) =>
          url.includes('fails')
            ? Promise.reject(new Error('probe exploded'))
            : Promise.resolve('same-link')
      );

      await subscriptionService.checkSubscriptions();

      expect(YtDlpDownloader.getLatestVideoUrl).toHaveBeenCalledTimes(2);
      expect(YtDlpDownloader.getLatestVideoUrl).toHaveBeenCalledWith(
        'https://youtube.com/@works',
        undefined
      );
      expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
    });

    it('does not probe subscriptions that are not due yet', async () => {
      const dueSub = makeSub('due');
      const notDueSub = { ...makeSub('fresh'), lastCheck: Date.now() };
      primeListSubscriptions([dueSub, notDueSub]);

      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');

      await subscriptionService.checkSubscriptions();

      expect(YtDlpDownloader.getLatestVideoUrl).toHaveBeenCalledTimes(1);
      expect(YtDlpDownloader.getLatestVideoUrl).toHaveBeenCalledWith(
        'https://youtube.com/@due',
        undefined
      );
    });
  });

  describe('checkChannelPlaylists', () => {
    it('should still create playlist collections when author organization is linked', async () => {
      // Setup
      const sub = {
        id: 'sub-watcher',
        author: 'User', // Clean channel name, frontend will add translated suffix
        platform: 'YouTube',
        authorUrl: 'https://youtube.com/@User/playlists',
        interval: 60,
        subscriptionType: 'channel_playlists'
      };

      // Mock settings
      (storageService.getSettings as any).mockReturnValue({
        authorOrganizationMode: 'author_collection_linked',
        saveAuthorFilesToCollection: true
      });

      // Mock yt-dlp return for playlists
      const mockPlaylists = {
        entries: [
          {
            id: 'pl-1',
            title: 'My Playlist',
            url: 'https://youtube.com/playlist?list=pl-1'
          }
        ]
      };
      
      const { executeYtDlpJson } = await import('../../utils/ytDlpUtils');
      (executeYtDlpJson as any).mockResolvedValue(mockPlaylists);

      // Mock listSubscriptions to return empty (not already subscribed)
      mockBuilder.then = (cb: any) => Promise.resolve([]).then(cb);

      // Spy on subscribePlaylist
      const subscribeSpy = vi.spyOn(subscriptionService, 'subscribePlaylist');
      subscribeSpy.mockResolvedValue({} as any);

      // Execute
      await subscriptionService.checkChannelPlaylists(sub as any);

      // Verify the watcher passed a captured baseline in an options object
      // (design §8.2): playlistUrl, interval, title, playlistId, channel name,
      // platform, collection id, the server-observed head, and an observation
      // timestamp.
      expect(subscribeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistUrl: 'https://youtube.com/playlist?list=pl-1',
          interval: 60,
          playlistTitle: 'My Playlist',
          playlistId: 'pl-1',
          author: 'User',
          platform: 'YouTube',
          collectionId: expect.any(String),
          initialHeadVideoUrl: expect.any(String),
          baselineObservedAt: expect.any(Number),
          filenameTemplate: null,
        })
      );

      expect(storageService.saveCollection).toHaveBeenCalled();
      subscribeSpy.mockRestore();
    });
  });

  describe('playlist and watcher subscriptions', () => {
    it('should create playlist subscription with display name', async () => {
      mockBuilder.then = (cb: any) => Promise.resolve([]).then(cb);

      const result = await subscriptionService.subscribePlaylist({
        playlistUrl: 'https://youtube.com/playlist?list=pl1',
        interval: 60,
        playlistTitle: 'Playlist 1',
        playlistId: 'pl1',
        author: 'Channel A',
        platform: 'YouTube',
        collectionId: 'col-1',
        initialHeadVideoUrl: 'https://www.youtube.com/watch?v=headA',
        baselineObservedAt: 1700000000000,
      });

      expect(result).toMatchObject({
        author: 'Playlist 1 - Channel A',
        subscriptionType: 'playlist',
        collectionId: 'col-1',
        lastVideoLink: 'https://www.youtube.com/watch?v=headA',
        lastCheck: 1700000000000,
      });
      expect(db.insert).toHaveBeenCalled();
    });

    it('should return existing channel watcher subscription if already exists', async () => {
      const existing = {
        id: 'existing-watcher',
        author: 'Channel',
        authorUrl: 'https://youtube.com/@channel/playlists',
        filenameTemplate: '{{ source_custom_name }}/{{ title }}.{{ ext }}',
      };
      mockBuilder.then = (cb: any) => Promise.resolve([existing]).then(cb);

      const result = await subscriptionService.subscribeChannelPlaylistsWatcher(
        'https://youtube.com/@channel/playlists',
        120,
        'Channel',
        'YouTube'
      );

      expect(result).toEqual(existing);
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('should clear an existing channel watcher filename template when null is provided', async () => {
      const existing = {
        id: 'existing-watcher',
        author: 'Channel',
        authorUrl: 'https://youtube.com/@channel/playlists',
        filenameTemplate: '{{ source_custom_name }}/{{ title }}.{{ ext }}',
      };
      mockBuilder.then = (cb: any) => Promise.resolve([existing]).then(cb);

      const result = await subscriptionService.subscribeChannelPlaylistsWatcher(
        'https://youtube.com/@channel/playlists',
        120,
        'Channel',
        'YouTube',
        null
      );

      expect(result).toEqual({
        ...existing,
        filenameTemplate: null,
      });
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
      expect(mockBuilder.set).toHaveBeenCalledWith({ filenameTemplate: null });
    });

    it('should update an existing channel watcher filename template when provided', async () => {
      const existing = {
        id: 'existing-watcher',
        author: 'Channel',
        authorUrl: 'https://youtube.com/@channel/playlists',
        filenameTemplate: null,
      };
      const filenameTemplate = '{{ source_custom_name }}/{{ title }}.{{ ext }}';
      mockBuilder.then = (cb: any) => Promise.resolve([existing]).then(cb);

      const result = await subscriptionService.subscribeChannelPlaylistsWatcher(
        'https://youtube.com/@channel/playlists',
        120,
        'Channel',
        'YouTube',
        filenameTemplate
      );

      expect(result).toEqual({
        ...existing,
        filenameTemplate,
      });
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
      expect(mockBuilder.set).toHaveBeenCalledWith({ filenameTemplate });
    });

    it('should create channel watcher subscription when missing', async () => {
      mockBuilder.then = (cb: any) => Promise.resolve([]).then(cb);

      const result = await subscriptionService.subscribeChannelPlaylistsWatcher(
        'https://youtube.com/@new/playlists',
        30,
        'New Channel',
        'YouTube'
      );

      expect(result).toMatchObject({
        author: 'New Channel',
        subscriptionType: 'channel_playlists',
      });
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('subscription state management', () => {
    it('should throw when unsubscribe verification fails', async () => {
      // Existence check finds the subscription, but the delete reports no rows
      // changed (e.g. concurrently deleted) — the service should throw.
      mockBuilder.then = (cb: any) =>
        Promise.resolve([{ id: 'sub1', author: 'A', platform: 'YouTube' }]).then(cb);
      mockBuilder.run = vi.fn().mockReturnValue({ changes: 0 });

      await expect(subscriptionService.unsubscribe('sub1')).rejects.toThrow(
        'Failed to delete subscription sub1'
      );
    });

    it('should pause and resume subscription', async () => {
      mockBuilder.then = (cb: any) => Promise.resolve([{ id: 'sub1', author: 'A' }]).then(cb);

      await subscriptionService.pauseSubscription('sub1');
      await subscriptionService.resumeSubscription('sub1');

      expect(db.update).toHaveBeenCalled();
    });

    it('should update subscription interval via settings', async () => {
      mockBuilder.then = (cb: any) => Promise.resolve([{ id: 'sub1', author: 'A' }]).then(cb);

      await subscriptionService.updateSubscriptionSettings('sub1', { interval: 90 });

      expect(db.update).toHaveBeenCalled();
      expect(mockBuilder.set).toHaveBeenCalledWith({ interval: 90 });
      expect(mockBuilder.returning).toHaveBeenCalledWith({
        id: 'id',
        author: 'author',
      });
    });

    it('should update subscription retention via settings', async () => {
      mockBuilder.then = (cb: any) => Promise.resolve([{ id: 'sub1', author: 'A' }]).then(cb);

      await subscriptionService.updateSubscriptionSettings('sub1', { retentionDays: 30 });

      expect(db.update).toHaveBeenCalled();
      expect(mockBuilder.set).toHaveBeenCalledWith({ retentionDays: 30 });
    });

    it('should update subscription settings in one database call', async () => {
      mockBuilder.then = (cb: any) => Promise.resolve([{ id: 'sub1', author: 'A' }]).then(cb);

      await subscriptionService.updateSubscriptionSettings('sub1', {
        interval: 45,
        retentionDays: 14,
      });

      expect(db.update).toHaveBeenCalledTimes(1);
      expect(mockBuilder.set).toHaveBeenCalledWith({
        interval: 45,
        retentionDays: 14,
      });
    });

    it('should link a playlist subscription to a collection', async () => {
      mockBuilder.then = (cb: any) =>
        Promise.resolve([{ id: 'sub1', author: 'A' }]).then(cb);

      await subscriptionService.updatePlaylistSubscriptionCollection(
        'sub1',
        'collection-1'
      );

      expect(db.update).toHaveBeenCalledTimes(1);
      expect(mockBuilder.set).toHaveBeenCalledWith({
        collectionId: 'collection-1',
      });
      expect(mockBuilder.returning).toHaveBeenCalledWith({
        id: 'id',
        author: 'author',
      });
    });

    it('should reject empty subscription settings updates', async () => {
      await expect(
        subscriptionService.updateSubscriptionSettings('sub1', {})
      ).rejects.toThrow('At least one subscription setting is required');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('should throw if pause/resume/update target does not exist', async () => {
      mockBuilder.then = (cb: any) => Promise.resolve([]).then(cb);

      await expect(subscriptionService.pauseSubscription('missing')).rejects.toThrow(
        'Subscription missing not found'
      );
      await expect(subscriptionService.resumeSubscription('missing')).rejects.toThrow(
        'Subscription missing not found'
      );
      await expect(
        subscriptionService.updateSubscriptionSettings('missing', { interval: 60 })
      ).rejects.toThrow('Subscription not found: missing');
      await expect(
        subscriptionService.updateSubscriptionSettings('missing', { interval: 60 })
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        subscriptionService.updateSubscriptionSettings('missing', { retentionDays: 30 })
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('should list subscriptions from database', async () => {
      const subs = [{ id: 's1', author: 'A' }];
      mockBuilder.then = (cb: any) => Promise.resolve(subs).then(cb);

      const result = await subscriptionService.listSubscriptions();
      expect(result).toEqual(subs);
    });
  });

  describe('scheduler and helper methods', () => {
    it('should skip checkSubscriptions when already running', async () => {
      (subscriptionService as any).isCheckingSubscriptions = true;
      await subscriptionService.checkSubscriptions();
      (subscriptionService as any).isCheckingSubscriptions = false;

      expect(db.select).not.toHaveBeenCalled();
    });

    it('should stop old scheduler task before starting a new one', () => {
      const oldStop = vi.fn();
      const oldRetentionStop = vi.fn();
      (subscriptionService as any).checkTask = { stop: oldStop };
      (subscriptionService as any).retentionCleanupTask = { stop: oldRetentionStop };

      subscriptionService.startScheduler();

      expect(oldStop).toHaveBeenCalled();
      expect(oldRetentionStop).toHaveBeenCalled();
      expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
      expect(cron.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
    });

    // Playlist head resolution is now provided by playlistFeed.getPlaylistHeadSnapshot
    // (design §6.5 / Step 5). The scheduler consumes its typed, fail-closed result;
    // the resolution + empty-vs-failure rules are covered directly in
    // playlistFeed.test.ts. The tests below exercise the scheduler's handling of
    // that snapshot during a real checkSingleSubscription sweep.

    it('should resolve latest playlist URL from first entry id', async () => {
      // The new playlist feed constructs the canonical watch URL from a bare id;
      // the scheduler no longer owns this logic but the canonicalization contract
      // still holds (covered in detail by playlistFeed.test.ts).
      (executeYtDlpJson as any).mockResolvedValue({
        entries: [{ id: 'abc123' }],
      });

      const { getPlaylistHeadSnapshot } = await import(
        '../../services/subscription/playlistFeed'
      );
      const youtubeUrl = await getPlaylistHeadSnapshot(
        'https://youtube.com/playlist?list=xyz',
        'YouTube'
      );
      const bilibiliUrl = await getPlaylistHeadSnapshot(
        'https://www.bilibili.com/medialist/play/1',
        'Bilibili'
      );

      expect(youtubeUrl.headVideoUrl).toBe(
        'https://www.youtube.com/watch?v=abc123'
      );
      expect(bilibiliUrl.headVideoUrl).toBe(
        'https://www.bilibili.com/video/abc123'
      );
    });

    it('should propagate playlist lookup errors (fail-closed) instead of swallowing them', async () => {
      // Design §3.4 / §9.1: the old probe swallowed errors and returned null,
      // which let a failed probe look like an empty playlist. The new typed
      // snapshot throws so the check is marked failed.
      (executeYtDlpJson as any).mockRejectedValue(
        new Error('playlist lookup failed')
      );

      const { getPlaylistHeadSnapshot } = await import(
        '../../services/subscription/playlistFeed'
      );

      await expect(
        getPlaylistHeadSnapshot(
          'https://youtube.com/playlist?list=xyz',
          'YouTube'
        )
      ).rejects.toThrow('playlist lookup failed');
    });

    it('should return direct playlist entry URL when available', async () => {
      (executeYtDlpJson as any).mockResolvedValue({
        entries: [{ url: 'https://www.youtube.com/watch?v=url-first' }],
      });

      const { getPlaylistHeadSnapshot } = await import(
        '../../services/subscription/playlistFeed'
      );
      const result = await getPlaylistHeadSnapshot(
        'https://youtube.com/playlist?list=xyz',
        'YouTube'
      );

      expect(result.headVideoUrl).toBe(
        'https://www.youtube.com/watch?v=url-first'
      );
    });

    it('should return headVideoUrl null for a verified empty playlist', async () => {
      (executeYtDlpJson as any).mockResolvedValue({ entries: [] });

      const { getPlaylistHeadSnapshot } = await import(
        '../../services/subscription/playlistFeed'
      );
      const result = await getPlaylistHeadSnapshot(
        'https://youtube.com/playlist?list=xyz',
        'YouTube'
      );

      expect(result.headVideoUrl).toBeNull();
    });

    it('should choose latest video resolver based on platform', async () => {
      (BilibiliDownloader.getLatestVideoUrl as any).mockResolvedValue('https://bilibili.com/video/BV1x');
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('https://youtube.com/watch?v=1');

      const bilibili = await (subscriptionService as any).getLatestVideoUrl(
        'https://space.bilibili.com/123',
        'Bilibili'
      );
      const youtube = await (subscriptionService as any).getLatestVideoUrl(
        'https://youtube.com/@channel',
        'YouTube'
      );

      expect(bilibili).toBe('https://bilibili.com/video/BV1x');
      expect(youtube).toBe('https://youtube.com/watch?v=1');
    });

    it('should catch scheduler tick errors from checkSubscriptions', async () => {
      let tick: (() => void) | undefined;
      (cron.schedule as any).mockImplementationOnce((_expr: string, cb: () => void) => {
        tick = cb;
        return { stop: vi.fn() };
      });
      const checkSpy = vi
        .spyOn(subscriptionService, 'checkSubscriptions')
        .mockRejectedValueOnce(new Error('tick failed'));

      subscriptionService.startScheduler();
      tick?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(checkSpy).toHaveBeenCalled();
      checkSpy.mockRestore();
    });
  });

  describe('additional subscribe branches', () => {
    it('should throw validation error for bilibili space URL without valid mid', async () => {
      await expect(
        subscriptionService.subscribe('https://space.bilibili.com/not-a-mid', 30)
      ).rejects.toThrow(ValidationError);
    });

    it('should fallback to bilibili mid-based author when author lookup fails', async () => {
      (BilibiliDownloader.getAuthorInfo as any).mockRejectedValue(
        new Error('author lookup failed')
      );

      const result = await subscriptionService.subscribe(
        'https://space.bilibili.com/123456',
        30
      );

      expect(result.author).toBe('Bilibili User 123456');
      expect(result.platform).toBe('Bilibili');
    });

    it('should append /videos for trailing slash YouTube URLs', async () => {
      (executeYtDlpJson as any).mockResolvedValue({ uploader: 'Root Channel' });

      const result = await subscriptionService.subscribe('https://www.youtube.com/', 60);

      expect(result.author).toBe('Root Channel');
      expect(executeYtDlpJson).toHaveBeenCalledWith(
        'https://www.youtube.com/videos',
        expect.objectContaining({ flatPlaylist: true, playlistEnd: 1 })
      );
    });

    it('should resolve YouTube author from first video metadata when channel info is missing', async () => {
      let callCount = 0;
      (executeYtDlpJson as any).mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            channel_id: 'cid',
            entries: [{ url: 'https://www.youtube.com/watch?v=abc' }],
          };
        }
        return { channel: 'From Video Metadata' };
      });

      const result = await subscriptionService.subscribe(
        'https://www.youtube.com/@fallback-source',
        60
      );

      expect(result.author).toBe('From Video Metadata');
      expect((executeYtDlpJson as any).mock.calls.length).toBe(2);
    });

    it('should fallback to YouTube handle parsing when metadata has no channel names', async () => {
      (executeYtDlpJson as any).mockResolvedValue({});

      const result = await subscriptionService.subscribe(
        'https://www.youtube.com/@handle_name',
        60
      );

      expect(result.author).toBe('@handle_name');
    });

    it('should fallback to URL path segment when YouTube metadata lookup throws', async () => {
      (executeYtDlpJson as any).mockRejectedValue(new Error('yt lookup failed'));

      const result = await subscriptionService.subscribe(
        'https://www.youtube.com/channel/UC_ABC_123',
        60
      );

      expect(result.author).toBe('UC_ABC_123');
    });

    it('should throw duplicate error for duplicate playlist subscriptions', async () => {
      mockBuilder.then = (cb: any) =>
        Promise.resolve([{ id: 'existing-playlist' }]).then(cb);

      await expect(
        subscriptionService.subscribePlaylist({
          playlistUrl: 'https://www.youtube.com/playlist?list=dup',
          interval: 30,
          playlistTitle: 'Duplicate',
          playlistId: 'dup',
          author: 'Author',
          platform: 'YouTube',
          collectionId: null,
          initialHeadVideoUrl: 'https://www.youtube.com/watch?v=baseline',
          baselineObservedAt: Date.now(),
        })
      ).rejects.toThrow(DuplicateError);
    });
  });

  describe('additional watcher and check branches', () => {
    it('should return early for watcher when no playlists are found', async () => {
      vi.mocked(getProviderScript).mockReturnValue('/tmp/provider.js');
      (executeYtDlpJson as any).mockResolvedValue({ entries: [] });

      const sub = {
        id: 'watcher-empty',
        author: 'Watcher',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@watcher/playlists',
        interval: 60,
        subscriptionType: 'channel_playlists',
      };

      await subscriptionService.checkChannelPlaylists(sub as any);

      expect(executeYtDlpJson).toHaveBeenCalledWith(
        sub.authorUrl,
        expect.objectContaining({
          flatPlaylist: true,
          dumpSingleJson: true,
          extractorArgs: 'youtubepot-bgutilscript:script_path=/tmp/provider.js',
        })
      );
    });

    it('should create collection and subscribe watcher-discovered playlist using parsed list id', async () => {
      (executeYtDlpJson as any).mockResolvedValue({
        entries: [
          {
            title: 'Playlist / One',
            url: 'https://www.youtube.com/playlist?list=PL123',
          },
        ],
      });
      (storageService.getSettings as any).mockReturnValue({
        saveAuthorFilesToCollection: false,
      });
      (storageService.getCollectionByName as any).mockReturnValue(undefined);
      (storageService.generateUniqueCollectionName as any).mockReturnValue('Unique Playlist');

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([]).then(cb); // listSubscriptions
        return Promise.resolve([{ id: 'watcher-sub' }]).then(cb); // update lastCheck
      };

      const subscribeSpy = vi
        .spyOn(subscriptionService, 'subscribePlaylist')
        .mockResolvedValue({ id: 'playlist-sub' } as any);

      await subscriptionService.checkChannelPlaylists({
        id: 'watcher-id',
        author: 'Watcher Name',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@watcher/playlists',
        interval: 120,
        subscriptionType: 'channel_playlists',
      } as any);

      expect(storageService.saveCollection).toHaveBeenCalled();
      // The watcher now captures a head baseline before subscribing and passes
      // an options object (design §8.2). The entry has no id but a valid
      // absolute url, so the baseline equals that url.
      expect(subscribeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistUrl: 'https://www.youtube.com/playlist?list=PL123',
          interval: 120,
          playlistTitle: 'Playlist - One',
          author: 'Watcher Name',
          platform: 'YouTube',
          collectionId: expect.any(String),
          initialHeadVideoUrl: 'https://www.youtube.com/playlist?list=PL123',
          baselineObservedAt: expect.any(Number),
          filenameTemplate: null,
        })
      );
      subscribeSpy.mockRestore();
    });

    it('should skip paused subscriptions and channel watcher subscriptions during checks', async () => {
      const paused = {
        id: 'paused-sub',
        author: 'Paused',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@paused',
        interval: 1,
        lastCheck: 0,
        paused: 1,
      };
      const watcher = {
        id: 'watcher-sub',
        author: 'Watcher',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@watcher/playlists',
        interval: 1,
        lastCheck: 0,
        subscriptionType: 'channel_playlists',
      };

      mockBuilder.then = (cb: any) => Promise.resolve([paused, watcher]).then(cb);
      const watcherSpy = vi
        .spyOn(subscriptionService, 'checkChannelPlaylists')
        .mockResolvedValue(0 as any);

      await subscriptionService.checkSubscriptions();

      expect(watcherSpy).toHaveBeenCalledWith(watcher as any);
      expect(YtDlpDownloader.getLatestVideoUrl).not.toHaveBeenCalled();
      watcherSpy.mockRestore();
    });

    it('records channel watcher checks once and preserves discovered playlist count', async () => {
      const watcher = {
        id: 'watcher-sub',
        author: 'Watcher',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@watcher/playlists',
        interval: 1,
        lastCheck: 0,
        paused: 0,
        subscriptionType: 'channel_playlists',
      };

      mockBuilder.then = (cb: any) => Promise.resolve([watcher]).then(cb);
      const watcherSpy = vi
        .spyOn(subscriptionService, 'checkChannelPlaylists')
        .mockResolvedValue(2 as any);
      const recordSpy = vi
        .spyOn(subscriptionService as any, 'recordSubscriptionCheckCompleted')
        .mockResolvedValue(undefined);

      await subscriptionService.checkSubscriptions();

      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith(
        watcher,
        'success',
        expect.objectContaining({ newVideoCount: 2 })
      );

      watcherSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('records Twitch checks once and preserves discovered video count', async () => {
      const twitchSub = {
        id: 'twitch-sub',
        author: 'Streamer',
        platform: 'Twitch',
        authorUrl: 'https://www.twitch.tv/streamer',
        interval: 1,
        lastCheck: 0,
        paused: 0,
      };

      mockBuilder.then = (cb: any) => Promise.resolve([twitchSub]).then(cb);
      const twitchSpy = vi
        .spyOn(subscriptionService as any, 'checkTwitchSubscription')
        .mockResolvedValue(3);
      const recordSpy = vi
        .spyOn(subscriptionService as any, 'recordSubscriptionCheckCompleted')
        .mockResolvedValue(undefined);

      await subscriptionService.checkSubscriptions();

      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith(
        twitchSub,
        'success',
        expect.objectContaining({ newVideoCount: 3 })
      );

      twitchSpy.mockRestore();
      recordSpy.mockRestore();
    });

    it('should skip download when subscription is deleted before lock update', async () => {
      const sub = {
        id: 'deleted-before-lock',
        author: 'Deleted',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@deleted',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'old-link',
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([]).then(cb); // lock update
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('new-link');

      await subscriptionService.checkSubscriptions();

      expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
    });

    it('should download bilibili subscription videos and update counters', async () => {
      const sub = {
        id: 'bili-sub',
        author: 'BiliAuthor',
        platform: 'Bilibili',
        authorUrl: 'https://space.bilibili.com/100',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'old-link',
        downloadCount: 2,
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lock update
        if (callCount === 3) return Promise.resolve([{ id: sub.id }]).then(cb); // success update
        return Promise.resolve([]).then(cb);
      };
      (BilibiliDownloader.getLatestVideoUrl as any).mockResolvedValue(
        'https://www.bilibili.com/video/BV1x'
      );
      (downloadService.downloadSingleBilibiliPart as any).mockResolvedValue({
        id: 'video-bili',
        title: 'Bili Video',
      });

      await subscriptionService.checkSubscriptions();

      expect(downloadService.downloadSingleBilibiliPart).toHaveBeenCalledWith(
        'https://www.bilibili.com/video/BV1x',
        1,
        1,
        '',
        'test-uuid',
        expect.any(Function),
        undefined,
        expect.objectContaining({
          sourceCustomName: 'BiliAuthor',
          sourceCollectionName: 'BiliAuthor',
          sourceCollectionType: 'channel',
        }),
        { subscriptionYtdlpConfig: undefined }
      );
      expect(storageService.addDownloadHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', sourceUrl: 'https://www.bilibili.com/video/BV1x' })
      );
      expect(TelegramService.notifyTaskComplete).toHaveBeenCalledWith({
        taskTitle: 'Bili Video',
        status: 'success',
        sourceUrl: 'https://www.bilibili.com/video/BV1x',
      });
    });

    it('should skip YouTube Telegram success when marker update affects no rows', async () => {
      const sub = {
        id: 'video-deleted-sub',
        author: 'VideoDeletedAuthor',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@video-deleted',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'old-link',
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lock update
        if (callCount === 3) return Promise.resolve([]).then(cb); // marker update
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue(
        'https://www.youtube.com/watch?v=video-deleted'
      );
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
        videoData: { id: 'video-deleted', title: 'Video Deleted' },
      });

      await subscriptionService.checkSubscriptions();

      expect(storageService.addDownloadHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Video Deleted',
          status: 'success',
          sourceUrl: 'https://www.youtube.com/watch?v=video-deleted',
        })
      );
      expect(TelegramService.notifyTaskComplete).not.toHaveBeenCalled();
    });

    it('should tolerate collection add failures and continue playlist subscription processing', async () => {
      const sub = {
        id: 'playlist-sub',
        author: 'Playlist Author',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/playlist?list=abc',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'old-link',
        downloadCount: 0,
        subscriptionType: 'playlist',
        collectionId: 'collection-1',
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lock update
        if (callCount === 3) return Promise.resolve([]).then(cb); // success update -> deleted branch
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue(
        'https://www.youtube.com/watch?v=new-playlist-video'
      );
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
        videoData: {
          id: 'video-1',
          title: 'Playlist Video',
          author: 'Playlist Author',
        },
      });
      (storageService.addVideoToCollection as any).mockImplementation(() => {
        throw new Error('collection write failed');
      });

      await subscriptionService.checkSubscriptions();

      expect(storageService.addVideoToCollection).toHaveBeenCalledWith(
        'collection-1',
        'video-1'
      );
      expect(storageService.addDownloadHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success' })
      );
    });

    it('should record failed download history when video download fails', async () => {
      const sub = {
        id: 'failed-sub',
        author: 'FailAuthor',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@fail',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'old-link',
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lock update
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue(
        'https://www.youtube.com/watch?v=failed'
      );
      (downloadService.downloadYouTubeVideo as any).mockRejectedValue(
        new Error('download exploded')
      );

      await subscriptionService.checkSubscriptions();

      expect(storageService.addDownloadHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          sourceUrl: 'https://www.youtube.com/watch?v=failed',
          error: 'download exploded',
        })
      );
      expect(TelegramService.notifyTaskComplete).toHaveBeenCalledWith({
        taskTitle: 'Video from FailAuthor',
        status: 'fail',
        sourceUrl: 'https://www.youtube.com/watch?v=failed',
        error: 'download exploded',
      });
    });

    it('should wait for video marker update before Telegram success notification', async () => {
      const sub = {
        id: 'marker-failed-sub',
        author: 'MarkerFailAuthor',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@marker-fail',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'old-link',
      };

      let callCount = 0;
      mockBuilder.then = (cb: any, reject: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lock update
        if (callCount === 3) {
          return Promise.reject(new Error('marker update failed')).then(cb, reject);
        }
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue(
        'https://www.youtube.com/watch?v=marker-failed'
      );
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
        videoData: { id: 'video-marker-failed', title: 'Marker Failed Video' },
      });

      await subscriptionService.checkSubscriptions();

      expect(TelegramService.notifyTaskComplete).not.toHaveBeenCalledWith(
        expect.objectContaining({
          taskTitle: 'Marker Failed Video',
          status: 'success',
        })
      );
      expect(TelegramService.notifyTaskComplete).toHaveBeenCalledWith({
        taskTitle: 'Marker Failed Video',
        status: 'fail',
        sourceUrl: 'https://www.youtube.com/watch?v=marker-failed',
        error:
          'Subscription processing failed after download: marker update failed',
      });
      expect(storageService.addDownloadHistoryItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          sourceUrl: 'https://www.youtube.com/watch?v=marker-failed',
        })
      );
    });

    it('should record failed shorts history when short download throws non-Error', async () => {
      const sub = {
        id: 'short-sub',
        author: 'ShortAuthor',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@short-author',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'same-link',
        lastShortVideoLink: 'old-short',
        downloadShorts: 1,
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lastCheck update
        if (callCount === 3) return Promise.resolve([{ id: sub.id }]).then(cb); // short check select
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');
      (YtDlpDownloader.getLatestShortsUrl as any).mockResolvedValue('new-short-link');
      (downloadService.downloadYouTubeVideo as any).mockRejectedValue('short exploded');

      await subscriptionService.checkSubscriptions();

      expect(storageService.addDownloadHistoryItem).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Short from ShortAuthor',
          status: 'failed',
          error: 'Download failed',
          sourceUrl: 'new-short-link',
        })
      );
      expect(TelegramService.notifyTaskComplete).toHaveBeenCalledWith({
        taskTitle: 'Short from ShortAuthor',
        status: 'fail',
        sourceUrl: 'new-short-link',
        error: 'Download failed',
      });
    });

    it('should wait for shorts marker update before Telegram success notification', async () => {
      const sub = {
        id: 'short-marker-failed-sub',
        author: 'ShortMarkerAuthor',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@short-marker',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'same-link',
        lastShortVideoLink: 'old-short',
        downloadShorts: 1,
      };

      let callCount = 0;
      mockBuilder.then = (cb: any, reject: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lastCheck update
        if (callCount === 3) return Promise.resolve([{ id: sub.id }]).then(cb); // short check select
        if (callCount === 4) {
          return Promise.reject(new Error('short marker update failed')).then(cb, reject);
        }
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');
      (YtDlpDownloader.getLatestShortsUrl as any).mockResolvedValue(
        'new-short-marker-link'
      );
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
        videoData: { id: 'short-marker-video', title: 'Short Marker Video' },
      });

      await subscriptionService.checkSubscriptions();

      expect(TelegramService.notifyTaskComplete).not.toHaveBeenCalledWith(
        expect.objectContaining({
          taskTitle: 'Short Marker Video',
          status: 'success',
        })
      );
      expect(TelegramService.notifyTaskComplete).toHaveBeenCalledWith({
        taskTitle: 'Short Marker Video',
        status: 'fail',
        sourceUrl: 'new-short-marker-link',
        error:
          'Subscription processing failed after short download: short marker update failed',
      });
      expect(storageService.addDownloadHistoryItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          sourceUrl: 'new-short-marker-link',
        })
      );
    });

    it('should skip shorts Telegram success when marker update affects no rows', async () => {
      const sub = {
        id: 'short-deleted-sub',
        author: 'ShortDeletedAuthor',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@short-deleted',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'same-link',
        lastShortVideoLink: 'old-short',
        downloadShorts: 1,
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lastCheck update
        if (callCount === 3) return Promise.resolve([{ id: sub.id }]).then(cb); // short check select
        if (callCount === 4) return Promise.resolve([]).then(cb); // short marker update
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');
      (YtDlpDownloader.getLatestShortsUrl as any).mockResolvedValue(
        'new-short-deleted-link'
      );
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
        videoData: { id: 'short-deleted-video', title: 'Short Deleted Video' },
      });

      await subscriptionService.checkSubscriptions();

      expect(TelegramService.notifyTaskComplete).not.toHaveBeenCalled();
    });

    it('should ignore shorts lookup exceptions and continue processing', async () => {
      const sub = {
        id: 'short-error-sub',
        author: 'ShortsErrorAuthor',
        platform: 'YouTube',
        authorUrl: 'https://www.youtube.com/@shorts-error',
        interval: 1,
        lastCheck: 0,
        lastVideoLink: 'same-link',
        downloadShorts: 1,
      };

      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([sub]).then(cb); // listSubscriptions
        if (callCount === 2) return Promise.resolve([{ id: sub.id }]).then(cb); // lastCheck update
        if (callCount === 3) return Promise.resolve([{ id: sub.id }]).then(cb); // short check select
        return Promise.resolve([]).then(cb);
      };
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');
      (YtDlpDownloader.getLatestShortsUrl as any).mockRejectedValue(
        new Error('shorts fetch failed')
      );

      await subscriptionService.checkSubscriptions();

      expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
    });
  });
});
