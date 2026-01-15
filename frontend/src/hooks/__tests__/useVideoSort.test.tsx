import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Video } from '../../types';
import { useVideoSort } from '../useVideoSort';

// Use YYYYMMDD format for date field to match backend format
const mockVideos: Video[] = [
    { id: '1', title: 'Video B', addedAt: '2023-01-02T12:00:00Z', viewCount: 100, date: '20230105', author: 'Author1', source: 'youtube', sourceUrl: 'url1' },
    { id: '2', title: 'Video A', addedAt: '2023-01-01T12:00:00Z', viewCount: 200, date: '20230110', author: 'Author2', source: 'youtube', sourceUrl: 'url2' },
    { id: '3', title: 'Video C', addedAt: '2023-01-03T12:00:00Z', viewCount: 50, date: '20230101', author: 'Author3', source: 'youtube', sourceUrl: 'url3' },
];

describe('useVideoSort', () => {
    beforeAll(() => {
        // Mock window.crypto
        Object.defineProperty(window, 'crypto', {
            value: {
                getRandomValues: (buffer: Uint32Array) => {
                    return buffer.map(() => 123456); // Deterministic for tests
                },
            },
        });
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

    it('should handle empty videos', () => {
        const { result } = renderHook(() => useVideoSort({ videos: [] }), {
            wrapper: MemoryRouter,
        });

        expect(result.current.sortedVideos).toEqual([]);
    });

    it('should handle videos with missing date field', () => {
        const videosWithMissingDate: Video[] = [
            { id: '1', title: 'Video A', addedAt: '2023-01-01T12:00:00Z', date: '20230101', author: 'Author1', source: 'youtube', sourceUrl: 'url1' },
            { id: '2', title: 'Video B', addedAt: '2023-01-02T12:00:00Z', author: 'Author2', source: 'youtube', sourceUrl: 'url2' }, // missing date
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
});
