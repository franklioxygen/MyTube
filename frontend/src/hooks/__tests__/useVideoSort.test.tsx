import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useVideoSort, VideoWithDetails } from '../useVideoSort';

const mockVideos: VideoWithDetails[] = [
    { id: '1', title: 'Video B', addedAt: '2023-01-02T12:00:00Z', viewCount: 100 },
    { id: '2', title: 'Video A', addedAt: '2023-01-01T12:00:00Z', viewCount: 200 },
    { id: '3', title: 'Video C', addedAt: '2023-01-03T12:00:00Z', viewCount: 50 },
];

describe('useVideoSort', () => {
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
        const { result } = renderHook(() => useVideoSort<VideoWithDetails>({ videos: [] }), {
            wrapper: MemoryRouter,
        });

        expect(result.current.sortedVideos).toEqual([]);
    });
});
