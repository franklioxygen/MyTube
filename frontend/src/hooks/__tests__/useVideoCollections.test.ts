import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoCollections } from '../useVideoCollections';

// Mocks
let mockCollections = [
    { id: 'c1', name: 'Collection 1', videos: ['v1', 'v2'] },
    { id: 'c2', name: 'Collection 2', videos: ['v3'] }
];

const mockAddToCollection = vi.fn();
const mockCreateCollection = vi.fn();
const mockRemoveFromCollection = vi.fn();

vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: mockCollections,
        addToCollection: mockAddToCollection,
        createCollection: mockCreateCollection,
        removeFromCollection: mockRemoveFromCollection
    })
}));

describe('useVideoCollections', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCollections = [
            { id: 'c1', name: 'Collection 1', videos: ['v1', 'v2'] },
            { id: 'c2', name: 'Collection 2', videos: ['v3'] }
        ];
    });

    it('should filter collections containing the video', () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        expect(result.current.videoCollections).toHaveLength(1);
        expect(result.current.videoCollections[0].id).toBe('c1');
    });

    it('should return empty if video not in any collection', () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v99' }));
        expect(result.current.videoCollections).toHaveLength(0);
    });

    it('should return empty collections when videoId is missing', () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: undefined }));

        expect(result.current.videoCollections).toEqual([]);
        expect(result.current.modalVideoCollections).toEqual([]);
    });

    it('should handle add to collection modal with the current video id', () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection();
        });

        expect(result.current.showCollectionModal).toBe(true);
        expect(result.current.activeCollectionVideoId).toBe('v1');
    });

    it('should handle add to collection modal with an explicit target video id', () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection('v3');
        });

        expect(result.current.activeCollectionVideoId).toBe('v3');
        expect(result.current.modalVideoCollections).toEqual([
            { id: 'c2', name: 'Collection 2', videos: ['v3'] }
        ]);
    });

    it('should close the collection modal and clear the active video id', () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection();
            result.current.handleCloseModal();
        });

        expect(result.current.showCollectionModal).toBe(false);
        expect(result.current.activeCollectionVideoId).toBeNull();
    });

    it('should create new collection', async () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection();
        });

        await act(async () => {
            await result.current.handleCreateCollection('New List');
        });

        expect(mockCreateCollection).toHaveBeenCalledWith('New List', 'v1');
    });

    it('should not create a collection when no active video is selected', async () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: undefined }));

        await act(async () => {
            await result.current.handleCreateCollection('New List');
        });

        expect(mockCreateCollection).not.toHaveBeenCalled();
    });

    it('should log create collection errors', async () => {
        const createError = new Error('create failed');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCreateCollection.mockRejectedValueOnce(createError);
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection();
        });

        await act(async () => {
            await result.current.handleCreateCollection('New List');
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error creating collection:', createError);
        consoleErrorSpy.mockRestore();
    });

    it('should add the active video to an existing collection', async () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection('v3');
        });

        await act(async () => {
            await result.current.handleAddToExistingCollection('c1');
        });

        expect(mockAddToCollection).toHaveBeenCalledWith('c1', 'v3');
    });

    it('should not add to an existing collection when no active video is selected', async () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: undefined }));

        await act(async () => {
            await result.current.handleAddToExistingCollection('c1');
        });

        expect(mockAddToCollection).not.toHaveBeenCalled();
    });

    it('should log add to existing collection errors', async () => {
        const addError = new Error('add failed');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockAddToCollection.mockRejectedValueOnce(addError);
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection();
        });

        await act(async () => {
            await result.current.handleAddToExistingCollection('c1');
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error adding to collection:', addError);
        consoleErrorSpy.mockRestore();
    });

    it('should remove from collection', async () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection();
        });

        await act(async () => {
            await result.current.handleRemoveFromCollection();
        });

        expect(mockRemoveFromCollection).toHaveBeenCalledWith('v1');
    });

    it('should not remove from a collection when no active video is selected', async () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: undefined }));

        await act(async () => {
            await result.current.handleRemoveFromCollection();
        });

        expect(mockRemoveFromCollection).not.toHaveBeenCalled();
    });

    it('should log remove from collection errors', async () => {
        const removeError = new Error('remove failed');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockRemoveFromCollection.mockRejectedValueOnce(removeError);
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));

        act(() => {
            result.current.handleAddToCollection();
        });

        await act(async () => {
            await result.current.handleRemoveFromCollection();
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error removing from collection:', removeError);
        consoleErrorSpy.mockRestore();
    });
});
