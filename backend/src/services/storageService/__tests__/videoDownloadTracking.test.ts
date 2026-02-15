import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db';
import {
  checkVideoDownloadBySourceId,
  checkVideoDownloadByUrl,
  handleVideoDownloadCheck,
  markVideoDownloadDeleted,
  recordVideoDownload,
  updateVideoDownloadRecord,
  verifyVideoExists,
} from '../videoDownloadTracking';
import { logger } from '../../../utils/logger';

vi.mock('../../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  }
}));

describe('videoDownloadTracking', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('checkVideoDownloadBySourceId', () => {
        it('should return found=true if record exists', () => {
             const mockRecord = { status: 'exists', videoId: '1' };
             const mockAll = vi.fn().mockReturnValue([mockRecord]);
             const mockWhere = vi.fn().mockReturnValue({ all: mockAll });
             const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
             vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

             const result = checkVideoDownloadBySourceId('src1');
             expect(result.found).toBe(true);
             expect(result.status).toBe('exists');
        });

        it('should return found=false if not exists', () => {
             const mockAll = vi.fn().mockReturnValue([]);
             const mockWhere = vi.fn().mockReturnValue({ all: mockAll });
             const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
             vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

             const result = checkVideoDownloadBySourceId('src1');
             expect(result.found).toBe(false);
        });

        it('should prefer exists record when multiple records are returned', () => {
             const mockAll = vi.fn().mockReturnValue([
                { status: 'deleted', downloadedAt: 2, videoId: null },
                { status: 'exists', downloadedAt: 1, videoId: 'keep-me' },
             ]);
             const mockWhere = vi.fn().mockReturnValue({ all: mockAll });
             const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
             vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

             const result = checkVideoDownloadBySourceId('src1');
             expect(result.found).toBe(true);
             expect(result.status).toBe('exists');
             expect(result.videoId).toBe('keep-me');
        });

        it('should return not found on query error', () => {
             vi.mocked(db.select).mockImplementation(() => {
                throw new Error('db error');
             });

             const result = checkVideoDownloadBySourceId('src1', 'yt');
             expect(result).toEqual({ found: false });
             expect(logger.error).toHaveBeenCalledWith(
                'Error checking video download by source ID',
                expect.any(Error)
             );
        });
    });

    describe('checkVideoDownloadByUrl', () => {
        it('should return found=true if record exists', () => {
             const mockGet = vi.fn().mockReturnValue({
                status: 'exists',
                videoId: 'vid1',
                title: 'Title',
                author: 'Author',
                downloadedAt: 123,
             });
             const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
             const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
             vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

             const result = checkVideoDownloadByUrl('https://example.com/v1');
             expect(result).toEqual(
                expect.objectContaining({
                  found: true,
                  status: 'exists',
                  videoId: 'vid1',
                })
             );
        });

        it('should return not found on error', () => {
             vi.mocked(db.select).mockImplementation(() => {
               throw new Error('query failed');
             });

             const result = checkVideoDownloadByUrl('https://example.com/v1');
             expect(result).toEqual({ found: false });
             expect(logger.error).toHaveBeenCalledWith(
               'Error checking video download by URL',
               expect.any(Error)
             );
        });
    });

    describe('recordVideoDownload', () => {
        it('should insert record when sourceVideoId does not exist', () => {
             const mockSelectGet = vi.fn().mockReturnValue(undefined);
             const mockSelectWhere = vi.fn().mockReturnValue({ get: mockSelectGet });
             const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
             vi.mocked(db.select).mockReturnValue({ from: mockSelectFrom } as any);

             const mockInsertRun = vi.fn();
             const mockOnConflict = vi.fn().mockReturnValue({ run: mockInsertRun });
             const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
             vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);

             recordVideoDownload('src1', 'url', 'yt', 'vid1');
             expect(db.insert).toHaveBeenCalled();
             expect(db.update).not.toHaveBeenCalled();
             expect(mockValues).toHaveBeenCalled();
        });

        it('should update existing record when sourceVideoId exists', () => {
            const mockSelectGet = vi.fn().mockReturnValue({ id: 'existing-id' });
            const mockSelectWhere = vi.fn().mockReturnValue({ get: mockSelectGet });
            const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockSelectFrom } as any);

            const mockUpdateRun = vi.fn();
            const mockUpdateWhere = vi.fn().mockReturnValue({ run: mockUpdateRun });
            const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockUpdateSet } as any);

            recordVideoDownload('src1', 'url', 'yt', 'vid1');
            expect(db.update).toHaveBeenCalled();
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('should swallow errors while recording download', () => {
            vi.mocked(db.select).mockImplementation(() => {
              throw new Error('write failed');
            });

            expect(() =>
              recordVideoDownload('src1', 'url', 'yt', 'vid1')
            ).not.toThrow();
            expect(logger.error).toHaveBeenCalledWith(
              'Error recording video download',
              expect.any(Error)
            );
        });
    });

    describe('verifyVideoExists', () => {
        it('should verify existing video', () => {
            const check = { found: true, status: 'exists', videoId: 'vid1' };
            const getVideoById = vi.fn().mockReturnValue({ id: 'vid1' });

            const result = verifyVideoExists(check as any, getVideoById as any);
            expect(result.exists).toBe(true);
            expect(result.video).toBeDefined();
        });

        it('should mark deleted if video missing', () => {
            const check = { found: true, status: 'exists', videoId: 'vid1' };
            const getVideoById = vi.fn().mockReturnValue(undefined);

            // Mock update for markVideoDownloadDeleted
            const mockRun = vi.fn();
            const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
            const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

            const result = verifyVideoExists(check as any, getVideoById as any);
            expect(result.exists).toBe(false);
            expect(result.updatedCheck?.status).toBe('deleted');
            expect(db.update).toHaveBeenCalled();
        });

        it('should return exists=false when status is deleted', () => {
            const result = verifyVideoExists(
              { found: true, status: 'deleted' } as any,
              vi.fn()
            );
            expect(result).toEqual({ exists: false });
        });
    });

    describe('markVideoDownloadDeleted and updateVideoDownloadRecord', () => {
      it('marks downloads as deleted', () => {
        const mockRun = vi.fn();
        const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
        const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        markVideoDownloadDeleted('vid1');

        expect(db.update).toHaveBeenCalled();
        expect(mockSet).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'deleted',
            videoId: null,
          })
        );
      });

      it('updates a record with platform-specific condition', () => {
        const mockRun = vi.fn();
        const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
        const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

        updateVideoDownloadRecord('src-1', 'new-id', 'New Title', 'Author', 'yt');
        updateVideoDownloadRecord('src-2', 'new-id-2');

        expect(db.update).toHaveBeenCalledTimes(2);
      });
    });

    describe('handleVideoDownloadCheck', () => {
      it('proceeds when no prior record is found', () => {
        const result = handleVideoDownloadCheck(
          { found: false } as any,
          'https://example.com',
          vi.fn(),
          vi.fn()
        );

        expect(result).toEqual({ shouldSkip: false, shouldForce: false });
      });

      it('skips and returns existing video info when video exists', () => {
        const addHistory = vi.fn();

        const result = handleVideoDownloadCheck(
          {
            found: true,
            status: 'exists',
            videoId: 'v1',
            title: 'Saved',
            author: 'Author',
          } as any,
          'https://example.com',
          vi.fn().mockReturnValue({
            id: 'v1',
            title: 'Saved',
            author: 'Author',
            videoPath: '/videos/v1.mp4',
            thumbnailPath: '/images/v1.jpg',
          }),
          addHistory
        );

        expect(addHistory).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'skipped', videoId: 'v1' })
        );
        expect(result.shouldSkip).toBe(true);
        expect(result.response?.videoId).toBe('v1');
      });

      it('allows re-download of existing video when forceDownload is true', () => {
        const addHistory = vi.fn();

        const result = handleVideoDownloadCheck(
          {
            found: true,
            status: 'exists',
            videoId: 'v1',
            title: 'Saved',
            author: 'Author',
          } as any,
          'https://example.com',
          vi.fn().mockReturnValue({
            id: 'v1',
            title: 'Saved',
            author: 'Author',
            videoPath: '/videos/v1.mp4',
            thumbnailPath: '/images/v1.jpg',
          }),
          addHistory,
          true // forceDownload
        );

        expect(addHistory).not.toHaveBeenCalled();
        expect(result).toEqual({ shouldSkip: false, shouldForce: true });
      });

      it('skips deleted videos when force is not enabled', () => {
        const addHistory = vi.fn();

        const result = handleVideoDownloadCheck(
          {
            found: true,
            status: 'deleted',
            title: 'Old',
            author: 'Author',
            downloadedAt: 100,
            deletedAt: 200,
          } as any,
          'https://example.com',
          vi.fn(),
          addHistory,
          false,
          false
        );

        expect(addHistory).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'deleted', title: 'Old' })
        );
        expect(result).toEqual(
          expect.objectContaining({
            shouldSkip: true,
            shouldForce: false,
            response: expect.objectContaining({ previouslyDeleted: true }),
          })
        );
      });

      it('allows re-download when force or dontSkipDeletedVideo is enabled', () => {
        const baseCheck = {
          found: true,
          status: 'deleted',
          title: 'Old',
        } as any;

        const forced = handleVideoDownloadCheck(
          baseCheck,
          'https://example.com',
          vi.fn(),
          vi.fn(),
          true,
          false
        );
        const dontSkip = handleVideoDownloadCheck(
          baseCheck,
          'https://example.com',
          vi.fn(),
          vi.fn(),
          false,
          true
        );

        expect(forced).toEqual({ shouldSkip: false, shouldForce: true });
        expect(dontSkip).toEqual({ shouldSkip: false, shouldForce: true });
      });

      it('handles stale exists records by marking deleted then applying deleted logic', () => {
        const mockRun = vi.fn();
        const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
        const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
        vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);
        const addHistory = vi.fn();

        const result = handleVideoDownloadCheck(
          {
            found: true,
            status: 'exists',
            videoId: 'missing-video',
            title: 'Missing',
          } as any,
          'https://example.com',
          vi.fn().mockReturnValue(undefined),
          addHistory
        );

        expect(db.update).toHaveBeenCalled();
        expect(addHistory).not.toHaveBeenCalled();
        expect(result).toEqual({ shouldSkip: false, shouldForce: false });
      });
    });
});
