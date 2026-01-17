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

    describe('renameCollection', () => {
        it('should rename directories and update video paths', () => {
            const mockCollection = { 
                id: 'col1', 
                name: 'Old Name', 
                videos: ['vid1'],
                title: 'Old Name'
            };
            const mockVideo = { 
                id: 'vid1',
                videoPath: '/videos/Old Name/vid.mp4',
                thumbnailPath: '/videos/Old Name/thumb.jpg',
                subtitles: [{ path: '/videos/Old Name/sub.srt' }]
            };

            vi.mocked(collectionRepo.getCollectionById).mockReturnValue(mockCollection as any);
            vi.mocked(collectionRepo.getCollectionByName).mockReturnValue(undefined); // Unique name check
            vi.mocked(collectionFileManager.renameCollectionDirectories).mockReturnValue(true);
            vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 const updated = fn({ ...mockCollection } as any);
                 return updated;
            });
            vi.mocked(videosService.getVideoById).mockReturnValue(mockVideo as any);
            vi.mocked(collectionFileManager.updateVideoPathsForCollectionRename).mockReturnValue({
                videoPath: '/videos/New Name/vid.mp4',
                thumbnailPath: '/videos/New Name/thumb.jpg',
                subtitles: [{ path: '/videos/New Name/sub.srt' }] as any
            });

            const result = collectionsService.renameCollection('col1', 'New Name');

            expect(collectionRepo.getCollectionById).toHaveBeenCalledWith('col1');
            expect(collectionRepo.getCollectionByName).toHaveBeenCalledWith('New Name');
            expect(collectionFileManager.renameCollectionDirectories).toHaveBeenCalledWith('Old Name', 'New Name');
            
            // Should update collection name
            expect(result?.name).toBe('New Name');
            expect(result?.title).toBe('New Name');

            // Should update video paths
            expect(collectionFileManager.updateVideoPathsForCollectionRename).toHaveBeenCalledWith(
                mockVideo, 'Old Name', 'New Name'
            );
            expect(videosService.updateVideo).toHaveBeenCalledWith('vid1', expect.objectContaining({
                videoPath: '/videos/New Name/vid.mp4'
            }));
        });

        it('should throw error if name already exists', () => {
             vi.mocked(collectionRepo.getCollectionById).mockReturnValue({ id: 'col1', name: 'Old' } as any);
             vi.mocked(collectionRepo.getCollectionByName).mockReturnValue({ id: 'col2' } as any);

             expect(() => collectionsService.renameCollection('col1', 'New')).toThrowError(/already exists/);
        });
    });
});
