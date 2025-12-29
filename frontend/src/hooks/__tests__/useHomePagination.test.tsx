import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from '../../types';
import { useHomePagination } from '../useHomePagination';

// Mock react-router-dom
const mockSetSearchParams = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('react-router-dom', () => ({
    useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

describe('useHomePagination', () => {
    const mockVideos = Array.from({ length: 25 }, (_, i) => ({ id: `v${i}` } as Video));

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset search params
        mockSearchParams.delete('page');

        // Mock window.scrollTo
        global.window.scrollTo = vi.fn();
    });

    it('should calculate displayedVideos correctly for first page', () => {
        const { result } = renderHook(() => useHomePagination({
            sortedVideos: mockVideos,
            itemsPerPage: 10,
            infiniteScroll: false,
            selectedTags: []
        }));

        expect(result.current.page).toBe(1);
        expect(result.current.totalPages).toBe(3); // 25 / 10 = 2.5 -> 3
        expect(result.current.displayedVideos).toHaveLength(10);
        expect(result.current.displayedVideos[0].id).toBe('v0');
        expect(result.current.displayedVideos[9].id).toBe('v9');
    });

    it('should return all videos when infiniteScroll is true', () => {
        const { result } = renderHook(() => useHomePagination({
            sortedVideos: mockVideos,
            itemsPerPage: 10,
            infiniteScroll: true,
            selectedTags: []
        }));

        expect(result.current.displayedVideos).toHaveLength(25);
    });

    it('should change page when handlePageChange is called', () => {
        const { result } = renderHook(() => useHomePagination({
            sortedVideos: mockVideos,
            itemsPerPage: 10,
            infiniteScroll: false,
            selectedTags: []
        }));

        act(() => {
            result.current.handlePageChange({} as any, 2);
        });

        expect(mockSetSearchParams).toHaveBeenCalled();
        const callback = mockSetSearchParams.mock.calls[0][0];
        const params = new URLSearchParams();
        const newParams = callback(params);
        expect(newParams.get('page')).toBe('2');
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('should reset page to 1 when tags change', () => {
        const { rerender } = renderHook(
            ({ tags }) => useHomePagination({
                sortedVideos: mockVideos,
                itemsPerPage: 10,
                infiniteScroll: false,
                selectedTags: tags
            }),
            { initialProps: { tags: ['tag1'] } }
        );

        // Update tags
        rerender({ tags: ['tag2'] });

        expect(mockSetSearchParams).toHaveBeenCalled();
        const callback = mockSetSearchParams.mock.calls[0][0];
        const params = new URLSearchParams();
        const newParams = callback(params);
        expect(newParams.get('page')).toBe('1');
    });
});
