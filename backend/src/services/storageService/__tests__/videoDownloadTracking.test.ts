import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db';
import { checkVideoDownloadBySourceId, recordVideoDownload, verifyVideoExists } from '../videoDownloadTracking';

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
    });
});
