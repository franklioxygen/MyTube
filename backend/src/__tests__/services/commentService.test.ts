import { beforeEach, describe, expect, it, vi } from 'vitest';
import youtubedl from 'youtube-dl-exec';
import { getComments } from '../../services/commentService';
import * as storageService from '../../services/storageService';

vi.mock('../../services/storageService');
vi.mock('youtube-dl-exec');

describe('CommentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getComments', () => {
    it('should return comments when video exists and youtube-dl succeeds', async () => {
      const mockVideo = {
        id: 'video1',
        sourceUrl: 'https://youtube.com/watch?v=123',
      };
      (storageService.getVideoById as any).mockReturnValue(mockVideo);

      const mockOutput = {
        comments: [
          {
            id: 'c1',
            author: 'User1',
            text: 'Great video!',
            timestamp: 1600000000,
          },
          {
            id: 'c2',
            author: '@User2',
            text: 'Nice!',
            timestamp: 1600000000,
          },
        ],
      };
      (youtubedl as any).mockResolvedValue(mockOutput);

      const comments = await getComments('video1');

      expect(comments).toHaveLength(2);
      expect(comments[0]).toEqual({
        id: 'c1',
        author: 'User1',
        content: 'Great video!',
        date: expect.any(String),
      });
      expect(comments[1].author).toBe('User2'); // Check @ removal
    });

    it('should return empty array if video not found', async () => {
      (storageService.getVideoById as any).mockReturnValue(null);

      const comments = await getComments('non-existent');

      expect(comments).toEqual([]);
      expect(youtubedl).not.toHaveBeenCalled();
    });

    it('should return empty array if youtube-dl fails', async () => {
      const mockVideo = {
        id: 'video1',
        sourceUrl: 'https://youtube.com/watch?v=123',
      };
      (storageService.getVideoById as any).mockReturnValue(mockVideo);
      (youtubedl as any).mockRejectedValue(new Error('Download failed'));

      const comments = await getComments('video1');

      expect(comments).toEqual([]);
    });

    it('should return empty array if no comments in output', async () => {
      const mockVideo = {
        id: 'video1',
        sourceUrl: 'https://youtube.com/watch?v=123',
      };
      (storageService.getVideoById as any).mockReturnValue(mockVideo);
      (youtubedl as any).mockResolvedValue({});

      const comments = await getComments('video1');

      expect(comments).toEqual([]);
    });
  });
});
