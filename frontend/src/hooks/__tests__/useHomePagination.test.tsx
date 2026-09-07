import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from '../../types';
import { useHomePagination } from '../useHomePagination';

const mockSetSearchParams = vi.fn();
const mockSearchParams = new URLSearchParams();
vi.mock('react-router', () => ({
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

    it('clamps out-of-range page to 1 and preserves other query params', () => {
        mockSearchParams.set('page', '99');
        mockSearchParams.set('sort', 'dateAsc');
        mockSearchParams.set('seed', 'abc');
        setupHook({ videos: mockVideos.slice(0, 5) });
        expect(mockSetSearchParams).toHaveBeenCalled();
        const newParams = mockSetSearchParams.mock.calls[0][0](
            new URLSearchParams('page=99&sort=dateAsc&seed=abc')
        );
        expect(newParams.get('page')).toBe('1');
        expect(newParams.get('sort')).toBe('dateAsc');
        expect(newParams.get('seed')).toBe('abc');
    });

    it.each(['abc', '0', '-3', '1.5'])('normalizes invalid page %s to 1', (page) => {
        mockSearchParams.set('page', page);
        setupHook();
        expect(mockSetSearchParams).toHaveBeenCalled();
        const newParams = mockSetSearchParams.mock.calls[0][0](
            new URLSearchParams(`page=${page}&sort=dateAsc`)
        );
        expect(newParams.get('page')).toBe('1');
        expect(newParams.get('sort')).toBe('dateAsc');
    });

    it('does not clamp page when infiniteScroll is enabled', () => {
        mockSearchParams.set('page', '99');
        setupHook({ infiniteScroll: true, videos: mockVideos.slice(0, 5) });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });

    it('does not clamp a valid page', () => {
        mockSearchParams.set('page', '2');
        setupHook();
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });

    it('does not clamp page while videos are still loading (empty list)', () => {
        mockSearchParams.set('page', '2');
        setupHook({ videos: [] });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });
});

type SwipeHandlers = ReturnType<typeof useHomePagination>['swipeHandlers'];

// The hook reads the touch points plus the element the gesture started on, so
// a swipe needs a real (if bare) node pair to walk up from.
function swipeTarget() {
    const root = document.createElement('div');
    const child = document.createElement('div');
    root.appendChild(child);
    return { currentTarget: root, target: child };
}

function swipe(
    handlers: SwipeHandlers,
    from: { x: number; y: number },
    to: { x: number; y: number }
) {
    act(() => {
        handlers.onTouchStart?.({
            ...swipeTarget(),
            touches: [{ clientX: from.x, clientY: from.y }]
        } as any);
        handlers.onTouchEnd?.({ changedTouches: [{ clientX: to.x, clientY: to.y }] } as any);
    });
}

describe('useHomePagination swipe navigation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSearchParams.delete('page');
        global.window.scrollTo = vi.fn();
    });

    it('goes to the next page on a left swipe', () => {
        mockSearchParams.set('page', '1');
        const { result } = setupHook();
        swipe(result.current.swipeHandlers, { x: 300, y: 100 }, { x: 200, y: 108 });
        expect(mockSetSearchParams).toHaveBeenCalled();
        const newParams = mockSetSearchParams.mock.calls[0][0](new URLSearchParams('page=1'));
        expect(newParams.get('page')).toBe('2');
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('goes to the previous page on a right swipe', () => {
        mockSearchParams.set('page', '2');
        const { result } = setupHook();
        swipe(result.current.swipeHandlers, { x: 200, y: 100 }, { x: 300, y: 108 });
        expect(mockSetSearchParams).toHaveBeenCalled();
        const newParams = mockSetSearchParams.mock.calls[0][0](new URLSearchParams('page=2'));
        expect(newParams.get('page')).toBe('1');
    });

    it('leaves a mostly vertical drag to the scroller', () => {
        mockSearchParams.set('page', '1');
        const { result } = setupHook();
        swipe(result.current.swipeHandlers, { x: 300, y: 100 }, { x: 200, y: 400 });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });

    it('ignores a drag shorter than the swipe threshold', () => {
        mockSearchParams.set('page', '1');
        const { result } = setupHook();
        swipe(result.current.swipeHandlers, { x: 300, y: 100 }, { x: 260, y: 100 });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });

    it('ignores a two-finger gesture so pinch-zoom still works', () => {
        mockSearchParams.set('page', '1');
        const { result } = setupHook();
        act(() => {
            result.current.swipeHandlers.onTouchStart?.({
                ...swipeTarget(),
                touches: [{ clientX: 300, clientY: 100 }, { clientX: 340, clientY: 100 }]
            } as any);
            result.current.swipeHandlers.onTouchEnd?.({
                changedTouches: [{ clientX: 200, clientY: 100 }]
            } as any);
        });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });

    it('does not swipe past the last page', () => {
        mockSearchParams.set('page', '3');
        const { result } = setupHook();
        swipe(result.current.swipeHandlers, { x: 300, y: 100 }, { x: 200, y: 100 });
        expect(mockSetSearchParams).not.toHaveBeenCalled();
    });

    it('swallows only the synthetic click that follows a swipe', () => {
        mockSearchParams.set('page', '1');
        const { result } = setupHook();
        swipe(result.current.swipeHandlers, { x: 300, y: 100 }, { x: 200, y: 100 });

        const swipeClick = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        act(() => { result.current.swipeHandlers.onClickCapture?.(swipeClick as any); });
        expect(swipeClick.preventDefault).toHaveBeenCalled();

        // The next tap is the viewer opening a video, and has to get through.
        const realTap = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        act(() => { result.current.swipeHandlers.onClickCapture?.(realTap as any); });
        expect(realTap.preventDefault).not.toHaveBeenCalled();
    });

    it('offers no swipe handlers when infiniteScroll is enabled', () => {
        const { result } = setupHook({ infiniteScroll: true });
        expect(result.current.swipeHandlers.onTouchStart).toBeUndefined();
    });

    it('offers no swipe handlers when there is only one page', () => {
        const { result } = setupHook({ videos: mockVideos.slice(0, 5) });
        expect(result.current.swipeHandlers.onTouchStart).toBeUndefined();
    });
});
