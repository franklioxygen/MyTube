import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useVideoCardNavigation } from '../useVideoCardNavigation';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate
}));

describe('useVideoCardNavigation', () => {
    const mockVideo = { id: 'v1', author: 'Test Author' };

    it('should navigate to video player normally', () => {
        const { result } = renderHook(() => useVideoCardNavigation({
            video: mockVideo as any,
            collectionInfo: { isFirstInAnyCollection: false, firstCollectionId: null, videoCollections: [], firstInCollectionNames: [] }
        }));

        result.current.handleVideoNavigation();
        expect(mockNavigate).toHaveBeenCalledWith('/video/v1');
    });

    it('should navigate to collection if first in collection', () => {
         const { result } = renderHook(() => useVideoCardNavigation({
            video: mockVideo as any,
            collectionInfo: { isFirstInAnyCollection: true, firstCollectionId: 'c1', videoCollections: [], firstInCollectionNames: [] }
        }));

        result.current.handleVideoNavigation();
        expect(mockNavigate).toHaveBeenCalledWith('/collection/c1');
    });

    it('should handle author click navigation', () => {
        const { result } = renderHook(() => useVideoCardNavigation({
            video: mockVideo as any,
            collectionInfo: { isFirstInAnyCollection: false, firstCollectionId: null, videoCollections: [], firstInCollectionNames: [] }
        }));

        const mockEvent = { stopPropagation: vi.fn() };
        result.current.handleAuthorClick(mockEvent as any);

        expect(mockEvent.stopPropagation).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/author/Test%20Author');
    });
});
