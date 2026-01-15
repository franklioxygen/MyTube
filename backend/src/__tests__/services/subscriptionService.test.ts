import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { DuplicateError, ValidationError } from '../../errors/DownloadErrors';
import { BilibiliDownloader } from '../../services/downloaders/BilibiliDownloader';
import { YtDlpDownloader } from '../../services/downloaders/YtDlpDownloader';
import * as downloadService from '../../services/downloadService';
import * as storageService from '../../services/storageService';
import { subscriptionService } from '../../services/subscriptionService';

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
    authorUrl: 'authorUrl',
    // add other fields if needed for referencing columns
  }
}));

vi.mock('../../services/downloadService');
vi.mock('../../services/storageService');
vi.mock('../../services/downloaders/BilibiliDownloader');
vi.mock('../../services/downloaders/BilibiliDownloader');
vi.mock('../../services/downloaders/YtDlpDownloader');
vi.mock('../../utils/ytDlpUtils', () => ({
  executeYtDlpJson: vi.fn(),
  getUserYtDlpConfig: vi.fn().mockReturnValue({}),
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
      // But insert needs to return something? Typically insert returns result object.
      // But the code doesn't use the insert result, just awaits it.
      
      const result = await subscriptionService.subscribe(url, 60);

      expect(result).toMatchObject({
        id: 'test-uuid',
        author: '@testuser',
        platform: 'YouTube',
        interval: 60
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
      // Mock existing subscription
      mockBuilder.then = (cb: any) => Promise.resolve([{ id: 'existing' }]).then(cb);

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
      // First call (check existence): return [sub]
      // Second call (delete): return whatever
      // Third call (verify): return []
      
      let callCount = 0;
      mockBuilder.then = (cb: any) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([{ id: subId, author: 'User', platform: 'YouTube' }]).then(cb);
        if (callCount === 2) return Promise.resolve(undefined).then(cb); // Delete result
        if (callCount === 3) return Promise.resolve([]).then(cb); // Verify result
        return Promise.resolve([]).then(cb);
      };

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
        if (callCount === 2) return Promise.resolve([sub]).then(cb); // verify existence
        
        // Step 2: Update lastCheck *before* download
        if (callCount === 3) return Promise.resolve([sub]).then(cb); // verify existence before lastCheck update
        // callCount 4 is the update itself (returns undefined usually or result)
        
        // Step 4: Update subscription record after download
        if (callCount === 5) return Promise.resolve([sub]).then(cb); // verify existence before final update
        
        return Promise.resolve(undefined).then(cb); // subsequent updates
      };

      // Mock getting latest video
      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('new-link');

      // Mock download
      (downloadService.downloadYouTubeVideo as any).mockResolvedValue({
        videoData: { id: 'vid-1', title: 'New Video' }
      });
      
      await subscriptionService.checkSubscriptions();

      expect(downloadService.downloadYouTubeVideo).toHaveBeenCalledWith('new-link');
      expect(storageService.addDownloadHistoryItem).toHaveBeenCalledWith(expect.objectContaining({
        status: 'success'
      }));
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
        if (callCount === 2) return Promise.resolve([sub]).then(cb); // verify existence
        if (callCount === 3) return Promise.resolve([sub]).then(cb); // verify existence before update
        return Promise.resolve(undefined).then(cb); // updates
      };

      (YtDlpDownloader.getLatestVideoUrl as any).mockResolvedValue('same-link');

      await subscriptionService.checkSubscriptions();

      expect(downloadService.downloadYouTubeVideo).not.toHaveBeenCalled();
      // Should still update lastCheck
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('checkChannelPlaylists', () => {
    it('should skip collection creation if saveAuthorFilesToCollection is true', async () => {
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

      // Verify
      expect(subscribeSpy).toHaveBeenCalledWith(
        expect.any(String), // url
        expect.any(Number), // interval
        'My Playlist',      // title
        'pl-1',             // playlistId
        'User',             // channelName
        'YouTube',          // platform
        null                // collectionId should be undefined/null
      );

      // Verify saveCollection was NOT called
      expect(storageService.saveCollection).not.toHaveBeenCalled();
    });
  });
});
