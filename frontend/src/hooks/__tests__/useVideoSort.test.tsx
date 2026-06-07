import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from '../../types';
import { useVideoSort } from '../useVideoSort';

// Use YYYYMMDD format for date field to match backend format
const mockVideos: Video[] = [
    { id: '1', title: 'Video B', addedAt: '2023-01-02T12:00:00Z', viewCount: 100, date: '20230105', author: 'Author1', source: 'youtube', sourceUrl: 'url1' },
    { id: '2', title: 'Video A', addedAt: '2023-01-01T12:00:00Z', viewCount: 200, date: '20230110', author: 'Author2', source: 'youtube', sourceUrl: 'url2' },
    { id: '3', title: 'Video C', addedAt: '2023-01-03T12:00:00Z', viewCount: 50, date: '20230101', author: 'Author3', source: 'youtube', sourceUrl: 'url3' },
];

describe('useVideoSort', () => {
    let randomValue = 123456;

    beforeAll(() => {
        // Mock window.crypto
        Object.defineProperty(window, 'crypto', {
            value: {
                getRandomValues: (buffer: Uint32Array) => {
                    buffer[0] = randomValue;
                    return buffer;
                },
            },
        });

        const storage = new Map<string, string>();
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => storage.set(key, value),
                removeItem: (key: string) => storage.delete(key),
                clear: () => storage.clear(),
            },
            configurable: true,
        });
    });

    beforeEach(() => {
        window.localStorage.clear();
        randomValue = 123456;
    });

    it('should sort by date descending by default', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: MemoryRouter,
        });

        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['3', '1', '2']);
    });

    it('should sort by date ascending', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=dateAsc']}>{children}</MemoryRouter>
            ),
        });

        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['2', '1', '3']);
    });

    it('should sort by video creation date descending', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=videoDateDesc']}>{children}</MemoryRouter>
            ),
        });

        // 2 (20230110), 1 (20230105), 3 (20230101) - YYYYMMDD format
        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['2', '1', '3']);
    });

    it('should sort by video creation date ascending', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=videoDateAsc']}>{children}</MemoryRouter>
            ),
        });

        // 3 (20230101), 1 (20230105), 2 (20230110) - YYYYMMDD format
        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['3', '1', '2']);
    });

    it('should sort by views descending', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=viewsDesc']}>{children}</MemoryRouter>
            ),
        });

        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['2', '1', '3']);
    });

    it('should sort by views ascending', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=viewsAsc']}>{children}</MemoryRouter>
            ),
        });

        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['3', '1', '2']);
    });

    it('should sort by name ascending', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=nameAsc']}>{children}</MemoryRouter>
            ),
        });

        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['2', '1', '3']);
    });

    it('should sort multipart-style numeric titles using natural order', () => {
        const multipartVideos: Video[] = [
            { id: '10', title: '10 Episode Ten', addedAt: '2023-01-03T12:00:00Z', viewCount: 10, date: '20230103', author: 'Author', source: 'bilibili', sourceUrl: 'url10' },
            { id: '2', title: '2 Episode Two', addedAt: '2023-01-02T12:00:00Z', viewCount: 20, date: '20230102', author: 'Author', source: 'bilibili', sourceUrl: 'url2' },
            { id: '1', title: '1 Episode One', addedAt: '2023-01-01T12:00:00Z', viewCount: 30, date: '20230101', author: 'Author', source: 'bilibili', sourceUrl: 'url1' },
        ];

        const { result } = renderHook(() => useVideoSort({ videos: multipartVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=nameAsc']}>{children}</MemoryRouter>
            ),
        });

        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['1', '2', '10']);
    });

    it('should handle random sort', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=random&seed=123']}>{children}</MemoryRouter>
            ),
        });

        // The order should be consistent for the same seed
        const order1 = result.current.sortedVideos.map(v => v.id);

        const { result: result2 } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=random&seed=123']}>{children}</MemoryRouter>
            ),
        });

        expect(result2.current.sortedVideos.map(v => v.id)).toEqual(order1);
    });

    it('should update sort option when handleSortClose is called', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: MemoryRouter,
        });

        act(() => {
            result.current.handleSortClose('viewsDesc');
        });

        expect(result.current.sortOption).toBe('viewsDesc');
    });

    it('should initialize from stored sort when storageKey is provided and URL sort is absent', () => {
        window.localStorage.setItem('homeSortOption', 'viewsDesc');

        const { result } = renderHook(() => useVideoSort({
            videos: mockVideos,
            storageKey: 'homeSortOption'
        }), {
            wrapper: MemoryRouter,
        });

        expect(result.current.sortOption).toBe('viewsDesc');
        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['2', '1', '3']);
    });

    it('should prefer URL sort over stored sort', () => {
        window.localStorage.setItem('homeSortOption', 'viewsDesc');

        const { result } = renderHook(() => useVideoSort({
            videos: mockVideos,
            storageKey: 'homeSortOption'
        }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=nameAsc']}>{children}</MemoryRouter>
            ),
        });

        expect(result.current.sortOption).toBe('nameAsc');
        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['2', '1', '3']);
    });

    it('should save selected sort when storageKey is provided', () => {
        const { result } = renderHook(() => useVideoSort({
            videos: mockVideos,
            storageKey: 'homeSortOption'
        }), {
            wrapper: MemoryRouter,
        });

        act(() => {
            result.current.handleSortClose('videoDateAsc');
        });

        expect(window.localStorage.getItem('homeSortOption')).toBe('videoDateAsc');
    });

    it('should use a fresh seed when stored sort is random and URL seed is absent', () => {
        window.localStorage.setItem('homeSortOption', 'random');
        randomValue = 111111;

        const { result } = renderHook(() => useVideoSort({
            videos: mockVideos,
            storageKey: 'homeSortOption'
        }), {
            wrapper: MemoryRouter,
        });
        const firstOrder = result.current.sortedVideos.map(v => v.id);

        window.localStorage.setItem('homeSortOption', 'random');
        randomValue = 333333;

        const { result: result2 } = renderHook(() => useVideoSort({
            videos: mockVideos,
            storageKey: 'homeSortOption'
        }), {
            wrapper: MemoryRouter,
        });

        expect(result2.current.sortOption).toBe('random');
        expect(result2.current.sortedVideos.map(v => v.id)).not.toEqual(firstOrder);
    });

    it('should keep URL-seeded random stable when storageKey is provided', () => {
        window.localStorage.setItem('homeSortOption', 'random');
        randomValue = 111111;

        const { result } = renderHook(() => useVideoSort({
            videos: mockVideos,
            storageKey: 'homeSortOption'
        }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=random&seed=123']}>{children}</MemoryRouter>
            ),
        });
        const firstOrder = result.current.sortedVideos.map(v => v.id);

        randomValue = 222222;
        const { result: result2 } = renderHook(() => useVideoSort({
            videos: mockVideos,
            storageKey: 'homeSortOption'
        }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=random&seed=123']}>{children}</MemoryRouter>
            ),
        });

        expect(result2.current.sortedVideos.map(v => v.id)).toEqual(firstOrder);
    });

    it('should call onSortChange if provided', () => {
        const onSortChange = vi.fn();
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos, onSortChange }), {
            wrapper: MemoryRouter,
        });

        act(() => {
            result.current.handleSortClose('viewsDesc');
        });

        expect(onSortChange).toHaveBeenCalledWith('viewsDesc');
    });

    it('should set sort anchor on handleSortClick', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: MemoryRouter,
        });

        act(() => {
            result.current.handleSortClick({
                currentTarget: document.createElement('button'),
            } as any);
        });

        expect(result.current.sortAnchorEl).not.toBeNull();
    });

    it('should handle random option in handleSortClose', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos }), {
            wrapper: MemoryRouter,
        });

        act(() => {
            result.current.handleSortClose('random');
        });

        expect(result.current.sortOption).toBe('random');
    });

    it('should handle empty videos', () => {
        const { result } = renderHook(() => useVideoSort({ videos: [] }), {
            wrapper: MemoryRouter,
        });

        expect(result.current.sortedVideos).toEqual([]);
    });

    it('should handle videos with missing date field', () => {
        const videosWithMissingDate: Video[] = [
            { id: '1', title: 'Video A', addedAt: '2023-01-01T12:00:00Z', date: '20230101', author: 'Author1', source: 'youtube', sourceUrl: 'url1' },
            { id: '2', title: 'Video B', addedAt: '2023-01-02T12:00:00Z', date: '', author: 'Author2', source: 'youtube', sourceUrl: 'url2' }, // missing date
            { id: '3', title: 'Video C', addedAt: '2023-01-03T12:00:00Z', date: '20230103', author: 'Author3', source: 'youtube', sourceUrl: 'url3' },
        ];

        const { result } = renderHook(() => useVideoSort({ videos: videosWithMissingDate }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=videoDateDesc']}>{children}</MemoryRouter>
            ),
        });

        // Videos with dates should come first, then videos without dates
        // 3 (20230103), 1 (20230101), 2 (no date)
        expect(result.current.sortedVideos[0].id).toBe('3');
        expect(result.current.sortedVideos[1].id).toBe('1');
        expect(result.current.sortedVideos[2].id).toBe('2');
    });

    it('should validate and fallback to default sort for invalid sort option', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos, defaultSort: 'invalidSort' }), {
            wrapper: MemoryRouter,
        });

        // Should fallback to 'dateDesc' when defaultSort is invalid
        expect(result.current.sortOption).toBe('dateDesc');
    });

    it('should preserve input order when preserveOrder is enabled', () => {
        const { result } = renderHook(() => useVideoSort({ videos: mockVideos, preserveOrder: true }), {
            wrapper: ({ children }) => (
                <MemoryRouter initialEntries={['/?sort=viewsDesc']}>{children}</MemoryRouter>
            ),
        });

        expect(result.current.sortedVideos.map(v => v.id)).toEqual(['1', '2', '3']);
    });
});
