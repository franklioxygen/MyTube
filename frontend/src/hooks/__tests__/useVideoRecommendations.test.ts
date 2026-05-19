import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from '../../types';
import { useVideoRecommendations } from '../useVideoRecommendations';

const mocks = vi.hoisted(() => ({
    videos: [] as Video[],
    collections: [] as any[],
    getRecommendations: vi.fn()
}));

vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({
        videos: mocks.videos
    })
}));

vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: mocks.collections
    })
}));

vi.mock('../../utils/recommendations', () => ({
    getRecommendations: mocks.getRecommendations
}));

describe('useVideoRecommendations', () => {
    beforeEach(() => {
        mocks.videos = [];
        mocks.collections = [];
        mocks.getRecommendations.mockReset();
        mocks.getRecommendations.mockReturnValue([]);
    });

    it('passes current-video fields used by recommendation scoring', () => {
        const video = {
            id: 'v1',
            title: 'React Router Advanced',
            author: 'Ada',
            tags: ['react'],
            seriesTitle: 'React',
            videoFilename: 'react-router-advanced.mp4',
            source: 'youtube',
            date: '20240115',
            addedAt: '2024-01-16T00:00:00Z',
            duration: '900',
            sourceUrl: 'https://example.com/v1'
        } as Video;
        const otherVideo = {
            id: 'v2',
            title: 'React Router Patterns',
            author: 'Ada',
            source: 'youtube',
            date: '20240116',
            addedAt: '2024-01-16T00:00:00Z',
            duration: '880',
            sourceUrl: 'https://example.com/v2'
        } as Video;
        mocks.videos = [video, otherVideo];

        renderHook(() => useVideoRecommendations({ video }));

        expect(mocks.getRecommendations).toHaveBeenCalledWith(
            expect.objectContaining({
                currentVideo: expect.objectContaining({
                    id: 'v1',
                    source: 'youtube',
                    date: '20240115',
                    addedAt: '2024-01-16T00:00:00Z',
                    duration: '900'
                }),
                allVideos: [video, otherVideo],
                collections: []
            })
        );
    });
});
