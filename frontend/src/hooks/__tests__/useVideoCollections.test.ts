import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoCollections } from '../useVideoCollections';

// Mocks
const mockCollections = [
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

    it('should handle add to collection modal', () => {
        const { result } = renderHook(() => useVideoCollections({ videoId: 'v1' }));
        
        act(() => {
            result.current.handleAddToCollection();
        });

        expect(result.current.showCollectionModal).toBe(true);
        expect(result.current.activeCollectionVideoId).toBe('v1');
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
});
