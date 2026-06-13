import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../db';
import { DatabaseError } from '../../../errors/DownloadErrors';
import {
  deleteCollection,
  getCollectionByVideoId,
  getCollectionById,
  getCollectionBySourceKey,
  getCollections,
  getCollectionsByVideoId,
  saveCollection,
} from '../collectionRepository';

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
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title', origin: 'author_auto' },
                    cv: { videoId: 'vid2', order: 2 }
                },
                {
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title', origin: 'author_auto' },
                    cv: { videoId: 'vid1', order: 1 }
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
            expect(result[0].origin).toBe('author_auto');
        });

        it('should return empty array on DB error', () => {
            vi.mocked(db.select).mockImplementation(() => { throw new Error('DB Error'); });
            const result = getCollections();
            expect(result).toEqual([]);
        });
    });

    describe('getCollectionById', () => {
        it('should return videos in stored collection order', () => {
            const mockRows = [
                {
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title', origin: 'manual' },
                    cv: { videoId: 'vid10', order: 10 }
                },
                {
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title', origin: 'manual' },
                    cv: { videoId: 'vid2', order: 2 }
                },
                {
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title', origin: 'manual' },
                    cv: { videoId: 'vid1', order: 1 }
                }
            ];

            const where = vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue(mockRows) });
            const leftJoin = vi.fn().mockReturnValue({ where });
            const from = vi.fn().mockReturnValue({ leftJoin });
            vi.mocked(db.select).mockReturnValue({ from } as any);

            const result = getCollectionById('col1');

            expect(result?.videos).toEqual(['vid1', 'vid2', 'vid10']);
            expect(result?.origin).toBe('manual');
        });
    });

    describe('getCollectionBySourceKey', () => {
        function mockCollectionsSelect(rows: any[]) {
            const all = vi.fn().mockReturnValue(rows);
            const leftJoin = vi.fn().mockReturnValue({ all });
            const from = vi.fn().mockReturnValue({ leftJoin });
            vi.mocked(db.select).mockReturnValue({ from } as any);
        }

        it('matches a collection on platform/type/mid/id', () => {
            mockCollectionsSelect([
                {
                    c: {
                        id: 'col1',
                        name: 'Series',
                        title: 'Series',
                        origin: 'manual',
                        sourcePlatform: 'bilibili',
                        sourceType: 'collection',
                        sourceMid: '9',
                        sourceId: '42',
                    },
                    cv: { videoId: 'vid1', order: 1 },
                },
            ]);

            const result = getCollectionBySourceKey('bilibili', 'collection', '9', '42');
            expect(result?.id).toBe('col1');
        });

        it('returns undefined when no source key matches', () => {
            mockCollectionsSelect([
                {
                    c: {
                        id: 'col1',
                        name: 'Series',
                        title: 'Series',
                        origin: 'manual',
                        sourcePlatform: 'bilibili',
                        sourceType: 'collection',
                        sourceMid: '9',
                        sourceId: '42',
                    },
                    cv: null,
                },
            ]);

            expect(getCollectionBySourceKey('bilibili', 'collection', '9', '99')).toBeUndefined();
            expect(getCollectionBySourceKey('bilibili', 'series', '9', '42')).toBeUndefined();
        });

        it('returns undefined when any key part is empty (no false positives on legacy rows)', () => {
            mockCollectionsSelect([
                {
                    c: { id: 'col1', name: 'Series', title: 'Series', origin: 'manual' },
                    cv: null,
                },
            ]);

            expect(getCollectionBySourceKey('bilibili', 'collection', '', '42')).toBeUndefined();
            expect(getCollectionBySourceKey('', 'collection', '9', '42')).toBeUndefined();
        });
    });

    describe('getCollectionsByVideoId', () => {
        it('should return every collection containing the video', () => {
            const mockRows = [
                {
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title', origin: 'manual' },
                    cv: { videoId: 'vid1' }
                },
                {
                    c: { id: 'col2', name: 'Collection 2', title: 'Collection 2 Title', origin: 'author_auto' },
                    cv: { videoId: 'vid1' }
                }
            ];

            const whereAll = vi.fn()
              .mockReturnValueOnce(mockRows)
              .mockReturnValueOnce([mockRows[0]])
              .mockReturnValueOnce([mockRows[1]]);
            const innerJoin = vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ all: whereAll }),
            });
            const leftJoin = vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                all: vi.fn().mockReturnValue([mockRows[0]]),
              }),
              all: vi.fn().mockReturnValue([mockRows[0]]),
            });
            const from = vi
              .fn()
              .mockReturnValueOnce({ innerJoin })
              .mockReturnValueOnce({ leftJoin })
              .mockReturnValueOnce({ leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  all: vi.fn().mockReturnValue([mockRows[1]]),
                }),
                all: vi.fn().mockReturnValue([mockRows[1]]),
              }) });
            vi.mocked(db.select).mockReturnValue({ from } as any);

            const result = getCollectionsByVideoId('vid1');

            expect(result.map((collection) => collection.id)).toEqual(['col1', 'col2']);
        });

        it('should return the first collection for legacy single-collection lookups', () => {
            const mockRows = [
                {
                    c: { id: 'col1', name: 'Collection 1', title: 'Collection 1 Title', origin: 'manual' },
                    cv: { videoId: 'vid1' }
                }
            ];

            const innerJoin = vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                all: vi.fn().mockReturnValue(mockRows),
              }),
            });
            const leftJoin = vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                all: vi.fn().mockReturnValue(mockRows),
              }),
              all: vi.fn().mockReturnValue(mockRows),
            });
            const from = vi
              .fn()
              .mockReturnValueOnce({ innerJoin })
              .mockReturnValueOnce({ leftJoin });
            vi.mocked(db.select).mockReturnValue({ from } as any);

            const result = getCollectionByVideoId('vid1');

            expect(result?.id).toBe('col1');
        });
    });

    describe('saveCollection', () => {
        it('should save collection and sync videos in transaction', () => {
             const collection = {
                 id: 'col1',
                 name: 'My Col',
                 title: 'My Col',
                 origin: 'manual',
                 createdAt: '2024-01-01T00:00:00.000Z',
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
             expect(mockValues).toHaveBeenNthCalledWith(
               1,
               expect.objectContaining({
                 id: 'col1',
                 origin: 'manual',
               }),
             );
             expect(mockValues).toHaveBeenNthCalledWith(
               2,
               expect.objectContaining({
                 collectionId: 'col1',
                 videoId: 'vid1',
                 order: 1,
               }),
             );
             expect(mockValues).toHaveBeenNthCalledWith(
               3,
               expect.objectContaining({
                 collectionId: 'col1',
                 videoId: 'vid2',
                 order: 2,
               }),
             );
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
