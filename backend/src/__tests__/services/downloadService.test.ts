import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as downloadService from '../../services/downloadService';
import { BilibiliDownloader } from '../../services/downloaders/BilibiliDownloader';
import { MissAVDownloader } from '../../services/downloaders/MissAVDownloader';
import { YtDlpDownloader } from '../../services/downloaders/YtDlpDownloader';

vi.mock('../../services/downloaders/BilibiliDownloader');
vi.mock('../../services/downloaders/YtDlpDownloader');
vi.mock('../../services/downloaders/MissAVDownloader');

describe('DownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Bilibili', () => {
    it('should call BilibiliDownloader.downloadVideo', async () => {
      await downloadService.downloadBilibiliVideo('url', 'path', 'thumb');
      expect(BilibiliDownloader.downloadVideo).toHaveBeenCalledWith('url', 'path', 'thumb');
    });

    it('should call BilibiliDownloader.checkVideoParts', async () => {
      await downloadService.checkBilibiliVideoParts('id');
      expect(BilibiliDownloader.checkVideoParts).toHaveBeenCalledWith('id');
    });

    it('should call BilibiliDownloader.checkCollectionOrSeries', async () => {
      await downloadService.checkBilibiliCollectionOrSeries('id');
      expect(BilibiliDownloader.checkCollectionOrSeries).toHaveBeenCalledWith('id');
    });

    it('should call BilibiliDownloader.getCollectionVideos', async () => {
      await downloadService.getBilibiliCollectionVideos(1, 2);
      expect(BilibiliDownloader.getCollectionVideos).toHaveBeenCalledWith(1, 2);
    });

    it('should call BilibiliDownloader.getSeriesVideos', async () => {
      await downloadService.getBilibiliSeriesVideos(1, 2);
      expect(BilibiliDownloader.getSeriesVideos).toHaveBeenCalledWith(1, 2);
    });

    it('should call BilibiliDownloader.downloadSinglePart', async () => {
      await downloadService.downloadSingleBilibiliPart('url', 1, 2, 'title');
      expect(BilibiliDownloader.downloadSinglePart).toHaveBeenCalledWith('url', 1, 2, 'title');
    });

    it('should call BilibiliDownloader.downloadCollection', async () => {
      const info = {} as any;
      await downloadService.downloadBilibiliCollection(info, 'name', 'id');
      expect(BilibiliDownloader.downloadCollection).toHaveBeenCalledWith(info, 'name', 'id');
    });

    it('should call BilibiliDownloader.downloadRemainingParts', async () => {
      await downloadService.downloadRemainingBilibiliParts('url', 1, 2, 'title', 'cid', 'did');
      expect(BilibiliDownloader.downloadRemainingParts).toHaveBeenCalledWith('url', 1, 2, 'title', 'cid', 'did');
    });
  });

  describe('YouTube/Generic', () => {
    it('should call YtDlpDownloader.search', async () => {
      await downloadService.searchYouTube('query');
      expect(YtDlpDownloader.search).toHaveBeenCalledWith('query');
    });

    it('should call YtDlpDownloader.downloadVideo', async () => {
      await downloadService.downloadYouTubeVideo('url', 'id');
      expect(YtDlpDownloader.downloadVideo).toHaveBeenCalledWith('url', 'id', undefined);
    });
  });

  describe('MissAV', () => {
    it('should call MissAVDownloader.downloadVideo', async () => {
      await downloadService.downloadMissAVVideo('url', 'id');
      expect(MissAVDownloader.downloadVideo).toHaveBeenCalledWith('url', 'id', undefined);
    });
  });
});
