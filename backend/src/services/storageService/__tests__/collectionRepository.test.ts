import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db';
import { DatabaseError } from '../../../errors/DownloadErrors';
import { deleteCollection, getCollections, saveCollection } from '../collectionRepository';

vi.mock('../../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn((cb) => cb()),
  }
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  }
}));

describe('collectionRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getCollections', () => {
        it('should return collections with parsed video arrays', () => {
            const mockRows = [
                {
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title' },
                    cv: { videoId: 'vid1' }
                },
                {
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title' },
                    cv: { videoId: 'vid2' }
                }
            ];

            const mockAll = vi.fn().mockReturnValue(mockRows);
            const mockLeftJoin = vi.fn().mockReturnValue({ all: mockAll });
            const mockFrom = vi.fn().mockReturnValue({ leftJoin: mockLeftJoin });
            vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

            const result = getCollections();

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('col1');
            expect(result[0].videos).toEqual(['vid1', 'vid2']);
        });

        it('should return empty array on DB error', () => {
            vi.mocked(db.select).mockImplementation(() => { throw new Error('DB Error'); });
            const result = getCollections();
            expect(result).toEqual([]);
        });
    });

    describe('saveCollection', () => {
        it('should save collection and sync videos in transaction', () => {
             const collection = {
                 id: 'col1',
                 name: 'My Col',
                 videos: ['vid1', 'vid2']
             };

             // Mock video existence check
             const mockGet = vi.fn().mockReturnValue({ id: 'vid1' }); // Found
             const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
             const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
             vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

             const mockRun = vi.fn();
             const mockOnConflict = vi.fn().mockReturnValue({ run: mockRun });
             const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict, run: mockRun });
             vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);
             
             const mockDeleteWhere = vi.fn().mockReturnValue({ run: mockRun });
             vi.mocked(db.delete).mockReturnValue({ where: mockDeleteWhere } as any);

             saveCollection(collection as any);

             expect(db.transaction).toHaveBeenCalled();
             expect(db.insert).toHaveBeenCalled(); // For collection and videos
             expect(db.delete).toHaveBeenCalled(); // To clear old videos
        });

        it('should throw DatabaseError on failure', () => {
             vi.mocked(db.transaction).mockImplementation(() => { throw new Error('Trans Error'); });
             expect(() => saveCollection({ id: '1' } as any)).toThrow(DatabaseError);
        });
    });

   describe('deleteCollection', () => {
       it('should return true if deletion successful', () => {
            const mockRun = vi.fn().mockReturnValue({ changes: 1 });
            const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
            vi.mocked(db.delete).mockReturnValue({ where: mockWhere } as any);

            const result = deleteCollection('col1');
            expect(result).toBe(true);
       });
       
       it('should return false if no changes', () => {
            const mockRun = vi.fn().mockReturnValue({ changes: 0 });
            const mockWhere = vi.fn().mockReturnValue({ run: mockRun });
            vi.mocked(db.delete).mockReturnValue({ where: mockWhere } as any);

            const result = deleteCollection('col1');
            expect(result).toBe(false);
       });
   });
});
