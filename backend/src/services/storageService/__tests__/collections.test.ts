import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as collectionFileManager from '../collectionFileManager';
import * as collectionRepo from '../collectionRepository';
import * as collectionsService from '../collections';
import * as videosService from '../videos';

vi.mock('../collectionRepository');
vi.mock('../collectionFileManager');
vi.mock('../videos');
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  }
}));

describe('collectionsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('generateUniqueCollectionName', () => {
        it('should return base name if unique', () => {
            vi.mocked(collectionRepo.getCollectionByName).mockReturnValue(undefined);
            const result = collectionsService.generateUniqueCollectionName('My Col');
            expect(result).toBe('My Col');
        });

        it('should append number if name exists', () => {
            // First call returns existing, second call (with " (2)") returns existing, third call (with " (3)") returns undefined
            vi.mocked(collectionRepo.getCollectionByName)
              .mockReturnValueOnce({ id: '1', name: 'My Col', videos: [] } as any)
              .mockReturnValueOnce({ id: '2', name: 'My Col (2)', videos: [] } as any)
              .mockReturnValue(undefined);

            const result = collectionsService.generateUniqueCollectionName('My Col');
            expect(result).toBe('My Col (3)');
        });
    });

    describe('addVideoToCollection', () => {
        it('should add video and move files', () => {
             const mockCollection = { id: 'col1', name: 'Col Name', videos: [] };
             const mockVideo = { id: 'vid1' };
             
             // Mock atomic update to call callback immediately
             vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 const updated = fn({ ...mockCollection } as any);
                 return updated;
             });

             vi.mocked(videosService.getVideoById).mockReturnValue(mockVideo as any);
             vi.mocked(collectionRepo.getCollections).mockReturnValue([mockCollection as any]);
             vi.mocked(collectionFileManager.moveAllFilesToCollection).mockReturnValue({ videoPath: '/new/path' });

             const result = collectionsService.addVideoToCollection('col1', 'vid1');

             expect(collectionRepo.atomicUpdateCollection).toHaveBeenCalledWith('col1', expect.any(Function));
             expect(result?.videos).toContain('vid1');
             expect(collectionFileManager.moveAllFilesToCollection).toHaveBeenCalled();
             expect(videosService.updateVideo).toHaveBeenCalledWith('vid1', { videoPath: '/new/path' });
        });
    });

    describe('removeVideoFromCollection', () => {
        it('should remove video and move files back or to other collection', () => {
             const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };
             const mockVideo = { id: 'vid1' };
             
             vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 const updated = fn({ ...mockCollection } as any);
                 return updated;
             });

             vi.mocked(videosService.getVideoById).mockReturnValue(mockVideo as any);
             vi.mocked(collectionRepo.getCollections).mockReturnValue([]); // No other collections containing it

             vi.mocked(collectionFileManager.moveAllFilesFromCollection).mockReturnValue({ videoPath: '/root/path' });

             const result = collectionsService.removeVideoFromCollection('col1', 'vid1');

             expect(result?.videos).not.toContain('vid1');
             expect(collectionFileManager.moveAllFilesFromCollection).toHaveBeenCalledWith(
                 expect.any(Object),  // video
                 expect.stringContaining('/videos'), // target dir (root)
                 expect.any(String),
                 expect.any(String),
                 '/videos',
                 '/images',
                 undefined,
                 expect.any(Array)
             );
        });
    });

    describe('deleteCollectionWithFiles', () => {
        it('should move files back to root and delete collection', () => {
            const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };
            vi.mocked(collectionRepo.getCollectionById).mockReturnValue(mockCollection as any);
            vi.mocked(videosService.getVideoById).mockReturnValue({ id: 'vid1' } as any);
            vi.mocked(collectionFileManager.moveAllFilesFromCollection).mockReturnValue({});

            collectionsService.deleteCollectionWithFiles('col1');

            expect(collectionFileManager.moveAllFilesFromCollection).toHaveBeenCalled();
            expect(collectionFileManager.cleanupCollectionDirectories).toHaveBeenCalledWith('Col Name');
            expect(collectionRepo.deleteCollection).toHaveBeenCalledWith('col1');
        });
    });
});
