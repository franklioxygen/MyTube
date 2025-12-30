import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db';
import * as collections from '../collections';
import * as fileHelpers from '../fileHelpers';
import { deleteVideo, getVideos, saveVideo, updateVideo } from '../videos';

vi.mock('../../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
}));

vi.mock('fs-extra');
vi.mock('../fileHelpers');
vi.mock('../collections');
vi.mock('../videoDownloadTracking', () => ({
    markVideoDownloadDeleted: vi.fn(),
}));
vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  }
}));

describe('storageService videos', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getVideos', () => {
        it('should return all videos with parsed JSON fields', () => {
            const mockRows = [
                {
                    id: '1',
                    title: 'Video 1',
                    createdAt: '2023-01-01',
                    tags: '["tag1"]',
                    subtitles: '[{"lang":"en"}]'
                }
            ];

            const mockAll = vi.fn().mockReturnValue(mockRows);
            const mockOrderBy = vi.fn().mockReturnValue({ all: mockAll });
            const mockFrom = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const result = getVideos();

            expect(result).toHaveLength(1);
            expect(result[0].tags).toEqual(['tag1']);
            expect(result[0].subtitles).toHaveLength(1);
        });

        it('should handle empty DB', () => {
            const mockAll = vi.fn().mockReturnValue([]);
            const mockOrderBy = vi.fn().mockReturnValue({ all: mockAll });
            const mockFrom = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const result = getVideos();
            expect(result).toHaveLength(0);
        });

        it('should return empty array on error', () => {
             vi.mocked(db.select).mockImplementation(() => { throw new Error('DB Error'); });
             const result = getVideos();
             expect(result).toEqual([]);
        });
    });

    describe('saveVideo', () => {
        it('should save video with stringified JSON fields', () => {
            const video = { 
                id: '1', 
                title: 'Test', 
                tags: ['tag1'], 
                subtitles: [{ lang: 'en' }] 
            };

            const mockRun = vi.fn();
            const mockOnConflict = vi.fn().mockReturnValue({ run: mockRun });
            const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
            vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);

            saveVideo(video as any);

            expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
                tags: '["tag1"]',
                subtitles: '[{"lang":"en"}]'
            }));
        });
    });

    describe('updateVideo', () => {
        it('should update video and return updated object', () => {
             const updates = { title: 'New Title', tags: ['newtag'] };
             const mockResult = { id: '1', title: 'New Title', tags: '["newtag"]' };

             const mockGet = vi.fn().mockReturnValue(mockResult);
             const mockReturning = vi.fn().mockReturnValue({ get: mockGet });
             const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
             const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
             vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

             const result = updateVideo('1', updates);

             expect(result).toEqual(expect.objectContaining({
                 title: 'New Title',
                 tags: ['newtag']
             }));
        });
    });

    describe('deleteVideo', () => {
        it('should delete video and files', () => {
            // Mock video retrieval
            const video = { 
                id: '1', 
                videoFilename: 'vid.mp4',
                thumbnailFilename: 'thumb.jpg',
                subtitles: JSON.stringify([{ filename: 'sub.vtt' }])
            };
            
            // Mock getVideoById logic (which uses db.select)
            const mockGet = vi.fn().mockReturnValue(video);
            const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
            const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            // Mock file helpers
            vi.mocked(fileHelpers.findVideoFile).mockReturnValue('/path/vid.mp4');
            vi.mocked(fileHelpers.findImageFile).mockReturnValue('/path/thumb.jpg');
            vi.mocked(collections.getCollections).mockReturnValue([]);

            // Mock fs
            vi.mocked(fs.existsSync).mockReturnValue(true);

            // Mock delete
            const mockRun = vi.fn();
            const mockDeleteWhere = vi.fn().mockReturnValue({ run: mockRun });
            vi.mocked(db.delete).mockReturnValue({ where: mockDeleteWhere } as any);

            const result = deleteVideo('1');

            expect(result).toBe(true);
            expect(fs.unlinkSync).toHaveBeenCalledWith('/path/vid.mp4');
            expect(fs.unlinkSync).toHaveBeenCalledWith('/path/thumb.jpg');
            // Check subtitles deletion logic is called
             expect(fs.unlinkSync).toHaveBeenCalledTimes(3); 
        });
    });
});
