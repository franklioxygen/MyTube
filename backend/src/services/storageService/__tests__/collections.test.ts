import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as collectionFileManager from '../collectionFileManager';
import * as collectionRepo from '../collectionRepository';
import * as collectionsService from '../collections';
import * as videosService from '../videos';

const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(() => ({}) as any),
}));

vi.mock('../collectionRepository');
vi.mock('../collectionFileManager');
vi.mock('../videos');
vi.mock('../settings', () => ({
  getSettings: () => settingsMocks.getSettings(),
  invalidateSettingsCache: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  }
}));

describe('collectionsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsMocks.getSettings.mockReturnValue({});
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
             const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };
             const mockVideo = { id: 'vid1' };

             // addVideoToCollection -> linkVideoToCollection uses the single-insert
             // append path (no specific order requested).
             vi.mocked(collectionRepo.appendVideoToCollection).mockReturnValue(mockCollection as any);

             vi.mocked(videosService.getVideoById).mockReturnValue(mockVideo as any);
             vi.mocked(collectionRepo.getCollections).mockReturnValue([mockCollection as any]);
             vi.mocked(collectionFileManager.moveAllFilesToCollection).mockReturnValue({ videoPath: '/new/path' });

             const result = collectionsService.addVideoToCollection('col1', 'vid1');

             expect(collectionRepo.appendVideoToCollection).toHaveBeenCalledWith('col1', 'vid1');
             expect(result?.videos).toContain('vid1');
             expect(collectionFileManager.moveAllFilesToCollection).toHaveBeenCalled();
             expect(videosService.updateVideo).toHaveBeenCalledWith('vid1', { videoPath: '/new/path' });
        });

        it('should preserve existing memberships when adding a video to another collection', () => {
             const targetCollection = { id: 'col-target', name: 'Target', videos: ['vid1'] };

             vi.mocked(collectionRepo.appendVideoToCollection).mockReturnValue(targetCollection as any);

             const result = collectionsService.addVideoToCollection('col-target', 'vid1', {
                 moveFiles: false,
             });

             // Append path issues a single guarded insert and does not touch
             // other collections' memberships.
             expect(collectionRepo.appendVideoToCollection).toHaveBeenCalledTimes(1);
             expect(result?.videos).toEqual(['vid1']);
         });
    });

    describe('linkVideoToCollection', () => {
        it('should add video without removing existing collection membership', () => {
             const targetCollection = { id: 'col2', name: 'Target', videos: ['vid1'] };

             // No specific order requested → single-insert append path.
             vi.mocked(collectionRepo.appendVideoToCollection).mockReturnValue(targetCollection as any);

             const result = collectionsService.linkVideoToCollection('col2', 'vid1', {
                 moveFiles: false,
             });

             expect(collectionRepo.appendVideoToCollection).toHaveBeenCalledTimes(1);
             expect(result?.videos).toContain('vid1');
         });

        it('should insert the video at the requested collection order', () => {
             const targetCollection = { id: 'col2', name: 'Target', videos: ['vid1', 'vid3'] };

             // A specific order is requested → full atomic-update rebuild path.
             vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 const base = id === 'col2' ? targetCollection : { id, videos: [] };
                 return fn({ ...base } as any);
             });

             const result = collectionsService.linkVideoToCollection('col2', 'vid2', {
                 moveFiles: false,
                 order: 2,
             });

             expect(collectionRepo.atomicUpdateCollection).toHaveBeenCalledTimes(1);
             expect(result?.videos).toEqual(['vid1', 'vid2', 'vid3']);
         });

        it('should use the single-insert append path when the requested order is past the current end', () => {
             // Bilibili-style ordered backfill appends videos in increasing
             // playlist order, so the requested order is always past the current
             // end. This must use the single guarded INSERT, not the O(n) rebuild.
             const existing = { id: 'col2', name: 'Target', videos: ['vid1', 'vid2'] };
             const appended = { id: 'col2', name: 'Target', videos: ['vid1', 'vid2', 'vid3'] };
             vi.mocked(collectionRepo.getCollectionById).mockReturnValue(existing as any);
             vi.mocked(collectionRepo.appendVideoToCollection).mockReturnValue(appended as any);

             const result = collectionsService.linkVideoToCollection('col2', 'vid3', {
                 moveFiles: false,
                 order: 3,
             });

             expect(collectionRepo.appendVideoToCollection).toHaveBeenCalledTimes(1);
             expect(collectionRepo.atomicUpdateCollection).not.toHaveBeenCalled();
             expect(result?.videos).toEqual(['vid1', 'vid2', 'vid3']);
         });

        it('should not move files for omitted moveFiles under author_folder_only', () => {
             const targetCollection = { id: 'col2', name: 'Playlist', videos: ['vid1'] };
             settingsMocks.getSettings.mockReturnValue({
                 authorOrganizationMode: 'author_folder_only',
             });
             vi.mocked(collectionRepo.appendVideoToCollection).mockReturnValue(targetCollection as any);

             const result = collectionsService.linkVideoToCollection('col2', 'vid1');

             expect(result?.videos).toContain('vid1');
             expect(collectionFileManager.moveAllFilesToCollection).not.toHaveBeenCalled();
             expect(videosService.updateVideo).not.toHaveBeenCalled();
         });

        it('should not move files for omitted moveFiles under template naming', () => {
             const targetCollection = { id: 'col2', name: 'Playlist', videos: ['vid1'] };
             settingsMocks.getSettings.mockReturnValue({
                 authorOrganizationMode: 'author_collection_and_folder',
                 downloadFilenameMode: 'template',
                 downloadFilenameTemplate: '{{ source_custom_name }}/{{ source_collection_name }}/{{ title }}.{{ ext }}',
             });
             vi.mocked(collectionRepo.appendVideoToCollection).mockReturnValue(targetCollection as any);

             const result = collectionsService.linkVideoToCollection('col2', 'vid1');

             expect(result?.videos).toContain('vid1');
             expect(collectionFileManager.moveAllFilesToCollection).not.toHaveBeenCalled();
             expect(videosService.updateVideo).not.toHaveBeenCalled();
         });

        it('should still honor explicit moveFiles under template naming', () => {
             const targetCollection = { id: 'col2', name: 'Playlist', videos: ['vid1'] };
             settingsMocks.getSettings.mockReturnValue({
                 downloadFilenameMode: 'template',
                 downloadFilenameTemplate: '{{ source_custom_name }}/{{ source_collection_name }}/{{ title }}.{{ ext }}',
             });
             vi.mocked(collectionRepo.appendVideoToCollection).mockReturnValue(targetCollection as any);
             vi.mocked(videosService.getVideoById).mockReturnValue({ id: 'vid1' } as any);
             vi.mocked(collectionRepo.getCollections).mockReturnValue([targetCollection as any]);
             vi.mocked(collectionFileManager.moveAllFilesToCollection).mockReturnValue({
                 videoPath: '/videos/Playlist/video.mp4',
             });

             collectionsService.linkVideoToCollection('col2', 'vid1', { moveFiles: true });

             expect(collectionFileManager.moveAllFilesToCollection).toHaveBeenCalled();
             expect(videosService.updateVideo).toHaveBeenCalledWith('vid1', {
                 videoPath: '/videos/Playlist/video.mp4',
             });
         });
    });

    describe('moveVideoToExclusiveCollection', () => {
        it('should remove the video from every previous collection before linking the new one', () => {
             const targetCollection = { id: 'col-target', name: 'Target', videos: ['vid1'] };
             const oldCollectionOne = { id: 'col-old-1', name: 'Old One', videos: ['vid1'] };
             const oldCollectionTwo = { id: 'col-old-2', name: 'Old Two', videos: ['vid1', 'vid2'] };

             vi.mocked(collectionRepo.getCollections).mockReturnValue([
                 targetCollection as any,
                 oldCollectionOne as any,
                 oldCollectionTwo as any,
             ]);

             // Removal from prior collections uses the atomic-update rebuild path;
             // the final link uses the single-insert append path.
             vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 const base =
                   id === 'col-old-1'
                     ? oldCollectionOne
                     : oldCollectionTwo;
                 return fn({ ...base, videos: [...base.videos] } as any);
             });
             vi.mocked(collectionRepo.appendVideoToCollection).mockReturnValue(targetCollection as any);

             const result = collectionsService.moveVideoToExclusiveCollection('col-target', 'vid1', {
                 moveFiles: false,
             });

             // atomicUpdateCollection is used only for the two prior-collection removals.
             expect(collectionRepo.atomicUpdateCollection).toHaveBeenCalledTimes(2);
             expect(collectionRepo.atomicUpdateCollection).toHaveBeenNthCalledWith(
                 1,
                 'col-old-1',
                 expect.any(Function)
             );
             expect(collectionRepo.atomicUpdateCollection).toHaveBeenNthCalledWith(
                 2,
                 'col-old-2',
                 expect.any(Function)
             );
             // The final link into the target uses the append path.
             expect(collectionRepo.appendVideoToCollection).toHaveBeenCalledWith('col-target', 'vid1');
             expect(result?.videos).toEqual(['vid1']);
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

        it('should move files to the author folder under author_folder_only when no other collection holds the video (issue #295 1-B follow-on)', () => {
             const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };
             const mockVideo = { id: 'vid1', author: 'Author A' };

             vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 const updated = fn({ ...mockCollection } as any);
                 return updated;
             });
             vi.mocked(videosService.getVideoById).mockReturnValue(mockVideo as any);
             vi.mocked(collectionRepo.getCollections).mockReturnValue([]); // no other collection
             vi.mocked(collectionFileManager.moveAllFilesFromCollection).mockReturnValue({
                 videoPath: '/videos/Author A/path',
             });
             settingsMocks.getSettings.mockReturnValue({
                 authorOrganizationMode: 'author_folder_only',
             });

             collectionsService.removeVideoFromCollection('col1', 'vid1');

             expect(collectionFileManager.moveAllFilesFromCollection).toHaveBeenCalledWith(
                 expect.any(Object),
                 expect.stringContaining('Author A'), // video dir = author folder, not root
                 expect.any(String),
                 expect.any(String),
                 '/videos/Author A',
                 '/images/Author A',
                 '/subtitles/Author A',
                 expect.any(Array)
             );
        });

        it('should route to the author folder under author_folder_only even when another collection still holds the video (issue #295 #4)', () => {
             const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };
             const otherCollection = { id: 'col2', name: 'Other Col', videos: ['vid1'] };
             const mockVideo = { id: 'vid1', author: 'Author A' };

             vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 const updated = fn({ ...mockCollection } as any);
                 return updated;
             });
             vi.mocked(videosService.getVideoById).mockReturnValue(mockVideo as any);
             // The video still belongs to another collection after the unlink.
             vi.mocked(collectionRepo.getCollections).mockReturnValue([
                 otherCollection as any,
             ]);
             vi.mocked(collectionFileManager.moveAllFilesFromCollection).mockReturnValue({
                 videoPath: '/videos/Author A/path',
             });
             settingsMocks.getSettings.mockReturnValue({
                 authorOrganizationMode: 'author_folder_only',
             });

             collectionsService.removeVideoFromCollection('col1', 'vid1');

             // author_folder_only wins over the other-collection branch: files must
             // land in the author folder, not /videos/Other Col.
             expect(collectionFileManager.moveAllFilesFromCollection).toHaveBeenCalledWith(
                 expect.any(Object),
                 expect.stringContaining('Author A'),
                 expect.any(String),
                 expect.any(String),
                 '/videos/Author A',
                 '/images/Author A',
                 '/subtitles/Author A',
                 expect.any(Array)
             );
             const [, targetVideoDir] = vi.mocked(
                 collectionFileManager.moveAllFilesFromCollection
             ).mock.calls[0];
             expect(targetVideoDir).not.toContain('Other Col');
        });

        it('should remove video without moving files when explicitly disabled', () => {
             const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };

             vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 const updated = fn({ ...mockCollection } as any);
                 return updated;
             });

             const result = collectionsService.removeVideoFromCollection('col1', 'vid1', {
                 moveFiles: false,
             });

             expect(result?.videos).not.toContain('vid1');
             expect(collectionFileManager.moveAllFilesFromCollection).not.toHaveBeenCalled();
             expect(videosService.updateVideo).not.toHaveBeenCalled();
         });

        it('should not move files for omitted moveFiles under template naming', () => {
             const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };
             settingsMocks.getSettings.mockReturnValue({
                 downloadFilenameMode: 'template',
                 downloadFilenameTemplate: '{{ source_custom_name }}/{{ source_collection_name }}/{{ title }}.{{ ext }}',
             });
             vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                 return fn({ ...mockCollection } as any);
             });

             const result = collectionsService.removeVideoFromCollection('col1', 'vid1');

             expect(result?.videos).not.toContain('vid1');
             expect(collectionFileManager.moveAllFilesFromCollection).not.toHaveBeenCalled();
             expect(videosService.updateVideo).not.toHaveBeenCalled();
         });
    });

    describe('deleteCollectionWithFiles', () => {
        it('should remove collection memberships with file moves before deleting the collection', () => {
            const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };
            vi.mocked(collectionRepo.getCollectionById).mockReturnValue(mockCollection as any);
            vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                if (id !== 'col1') {
                    return null;
                }
                return fn({ ...mockCollection, videos: [...mockCollection.videos] } as any);
            });
            vi.mocked(collectionRepo.getCollections).mockReturnValue([] as any);
            vi.mocked(videosService.getVideoById).mockReturnValue({ id: 'vid1' } as any);
            vi.mocked(collectionFileManager.moveAllFilesFromCollection).mockReturnValue({});

            collectionsService.deleteCollectionWithFiles('col1');

            expect(collectionRepo.atomicUpdateCollection).toHaveBeenCalledWith(
                'col1',
                expect.any(Function)
            );
            expect(collectionFileManager.moveAllFilesFromCollection).toHaveBeenCalled();
            expect(collectionFileManager.cleanupCollectionDirectories).toHaveBeenCalledWith('Col Name');
            expect(collectionRepo.deleteCollection).toHaveBeenCalledWith('col1');
        });

        it('should remove collection memberships without file moves under template naming', () => {
            const mockCollection = { id: 'col1', name: 'Col Name', videos: ['vid1'] };
            settingsMocks.getSettings.mockReturnValue({
                downloadFilenameMode: 'template',
                downloadFilenameTemplate: '{{ source_custom_name }}/{{ source_collection_name }}/{{ title }}.{{ ext }}',
            });
            vi.mocked(collectionRepo.getCollectionById).mockReturnValue(mockCollection as any);
            vi.mocked(collectionRepo.atomicUpdateCollection).mockImplementation((id, fn) => {
                if (id !== 'col1') {
                    return null;
                }
                return fn({ ...mockCollection, videos: [...mockCollection.videos] } as any);
            });

            collectionsService.deleteCollectionWithFiles('col1');

            expect(collectionRepo.atomicUpdateCollection).toHaveBeenCalledWith(
                'col1',
                expect.any(Function)
            );
            expect(collectionFileManager.moveAllFilesFromCollection).not.toHaveBeenCalled();
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
