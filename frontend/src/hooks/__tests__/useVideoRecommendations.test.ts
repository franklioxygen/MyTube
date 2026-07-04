import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from '../../types';
import { useVideoRecommendations } from '../useVideoRecommendations';

const mocks = vi.hoisted(() => ({
    videos: [] as Video[],
    collections: [] as any[],
    settings: { statisticsEnabled: false },
    signals: null as any,
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

vi.mock('../useSettings', () => ({
    useSettings: () => ({
        data: mocks.settings
    })
}));

vi.mock('../useRecommendationSignals', () => ({
    useRecommendationSignals: () => ({
        data: mocks.signals
    })
}));

describe('useVideoRecommendations', () => {
    beforeEach(() => {
        mocks.videos = [];
        mocks.collections = [];
        mocks.settings = { statisticsEnabled: false };
        mocks.signals = null;
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
            partNumber: 2,
            totalParts: 8,
            rating: 5,
            videoFilename: 'react-router-advanced.mp4',
            source: 'youtube',
            date: '20240115',
            addedAt: '2024-01-16T00:00:00Z',
            duration: '900',
            progress: 120,
            viewCount: 3,
            lastPlayedAt: 1705449600000,
            channelUrl: 'https://example.com/ada',
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
                    duration: '900',
                    partNumber: 2,
                    totalParts: 8,
                    rating: 5,
                    progress: 120,
                    viewCount: 3,
                    lastPlayedAt: 1705449600000,
                    channelUrl: 'https://example.com/ada'
                }),
                allVideos: [video, otherVideo],
                collections: []
            })
        );
    });
});
