import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from '../../types';
import { useHomePagination } from '../useHomePagination';

const mockSetSearchParams = vi.fn();
const mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
    useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));
const mockVideos = Array.from({ length: 25 }, (_, i) => ({ id: `v${i}` } as Video));

function setupHook(overrides: { infiniteScroll?: boolean; videos?: Video[] } = {}) {
    return renderHook(() => useHomePagination({
        sortedVideos: overrides.videos ?? mockVideos,
        itemsPerPage: 10,
        infiniteScroll: overrides.infiniteScroll ?? false,
        selectedTags: []
    }));
}

describe('useHomePagination', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSearchParams.delete('page');
        global.window.scrollTo = vi.fn();
    });

    it('should calculate displayedVideos correctly for first page', () => {
        const { result } = setupHook();
        expect(result.current.page).toBe(1);
        expect(result.current.totalPages).toBe(3);
        expect(result.current.displayedVideos).toHaveLength(10);
        expect(result.current.displayedVideos[0].id).toBe('v0');
        expect(result.current.displayedVideos[9].id).toBe('v9');
    });

    it('should return all videos when infiniteScroll is true', () => {
        const { result } = setupHook({ infiniteScroll: true });
        expect(result.current.displayedVideos).toHaveLength(25);
    });

    it('should change page when handlePageChange is called', () => {
        const { result } = setupHook();
        act(() => { result.current.handlePageChange({} as any, 2); });
        expect(mockSetSearchParams).toHaveBeenCalled();
        const newParams = mockSetSearchParams.mock.calls[0][0](new URLSearchParams());
        expect(newParams.get('page')).toBe('2');
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('should reset page to 1 when tags change', () => {
        const { rerender } = renderHook(
            ({ tags }) => useHomePagination({
                sortedVideos: mockVideos, itemsPerPage: 10,
                infiniteScroll: false, selectedTags: tags
            }),
            { initialProps: { tags: ['tag1'] } }
        );
        rerender({ tags: ['tag2'] });
        expect(mockSetSearchParams).toHaveBeenCalled();
        const newParams = mockSetSearchParams.mock.calls[0][0](new URLSearchParams());
        expect(newParams.get('page')).toBe('1');
    });

    it('should go to previous page on ArrowLeft keyboard', () => {
        mockSearchParams.set('page', '2');
        setupHook();
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
        expect(mockSetSearchParams).toHaveBeenCalled();
        const newParams = mockSetSearchParams.mock.calls[0][0](new URLSearchParams('page=2'));
        expect(newParams.get('page')).toBe('1');
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('should go to next page on ArrowRight keyboard', () => {
        mockSearchParams.set('page', '1');
        setupHook();
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        expect(mockSetSearchParams).toHaveBeenCalled();
        const newParams = mockSetSearchParams.mock.calls[0][0](new URLSearchParams('page=1'));
        expect(newParams.get('page')).toBe('2');
    });

    it('should ignore keyboard pagination when infiniteScroll is enabled', () => {
        setupHook({ infiniteScroll: true });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });

    it('should ignore keyboard pagination when focused on input fields', () => {
        setupHook();
        const input = document.createElement('input');
        document.body.appendChild(input);
        act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
        document.body.removeChild(input);
    });

    it('should ignore keyboard pagination when there is only one page', () => {
        setupHook({ videos: mockVideos.slice(0, 5) });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });
});
