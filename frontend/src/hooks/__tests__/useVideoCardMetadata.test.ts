import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoCardMetadata } from '../useVideoCardMetadata';

const mockUseCloudStorageUrl = vi.hoisted(() => vi.fn());
const mockGetFileUrl = vi.hoisted(() => vi.fn());
const mockIsNewVideo = vi.hoisted(() => vi.fn());

vi.mock('../useCloudStorageUrl', () => ({
    useCloudStorageUrl: mockUseCloudStorageUrl
}));

vi.mock('../../utils/cloudStorage', () => ({
    getFileUrl: mockGetFileUrl
}));

vi.mock('../../utils/videoCardUtils', () => ({
    isNewVideo: mockIsNewVideo
}));

describe('useVideoCardMetadata', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseCloudStorageUrl.mockImplementation(() => undefined);
        mockGetFileUrl.mockResolvedValue(undefined);
        mockIsNewVideo.mockReturnValue(true);
    });

    it('should prefer hook-provided cloud URLs for thumbnail and video', async () => {
        mockUseCloudStorageUrl.mockImplementation((path: string, type: string) => {
            if (type === 'thumbnail' && path === 'cloud:thumb.jpg') return 'https://cdn/thumb.jpg';
            if (type === 'video' && path === 'cloud:video.mp4') return 'https://cdn/video.mp4';
            return undefined;
        });

        const mockVideo = {
            id: '1',
            videoPath: 'cloud:video.mp4',
            thumbnailPath: 'cloud:thumb.jpg'
        };

        const { result } = renderHook(() => useVideoCardMetadata({ video: mockVideo as any }));

        expect(result.current.videoUrl).toBe('https://cdn/video.mp4');
        expect(result.current.thumbnailSrc).toBe('https://cdn/thumb.jpg');

        const url = await result.current.getVideoUrl();
        expect(url).toBe('https://cdn/video.mp4');
        expect(result.current.isNew).toBe(true);
        expect(mockGetFileUrl).not.toHaveBeenCalled();
    });

    it('should fetch cloud URL directly when cloud path exists but hook URL is unavailable', async () => {
        mockGetFileUrl.mockResolvedValue('https://signed/video-2.mp4');

        const mockVideo = {
            id: '2',
            videoPath: 'cloud:video-2.mp4',
            thumbnailPath: 'cloud:thumb-2.jpg',
            thumbnailUrl: 'https://fallback/thumb-2.jpg'
        };

        const { result } = renderHook(() => useVideoCardMetadata({ video: mockVideo as any }));

        expect(result.current.thumbnailSrc).toBe('https://fallback/thumb-2.jpg');
        await expect(result.current.getVideoUrl()).resolves.toBe('https://signed/video-2.mp4');
        expect(mockGetFileUrl).toHaveBeenCalledWith('cloud:video-2.mp4', 'video');
    });

    it('should return empty string for cloud video when direct fetch still fails', async () => {
        mockGetFileUrl.mockResolvedValue(undefined);
        const mockVideo = {
            id: '3',
            videoPath: 'cloud:video-3.mp4'
        };

        const { result } = renderHook(() => useVideoCardMetadata({ video: mockVideo as any }));
        await expect(result.current.getVideoUrl()).resolves.toBe('');
    });

    it('should build local path-based URLs for non-cloud videos', async () => {
        const mockVideo = {
            id: '4',
            videoPath: 'videos/local.mp4',
            thumbnailPath: '/images/thumb.jpg'
        };

        const { result } = renderHook(() => useVideoCardMetadata({ video: mockVideo as any }));

        expect(result.current.thumbnailSrc).toContain('/images/thumb.jpg');
        await expect(result.current.getVideoUrl()).resolves.toBe(`${window.location.origin}/videos/local.mp4`);
    });

    it('should fallback to sourceUrl and then empty string when videoPath is missing', async () => {
        mockIsNewVideo.mockReturnValue(false);

        const withSource = {
            id: '5',
            sourceUrl: 'https://example.com/video'
        };
        const { result: withSourceResult } = renderHook(() => useVideoCardMetadata({ video: withSource as any }));
        await expect(withSourceResult.current.getVideoUrl()).resolves.toBe('https://example.com/video');
        expect(withSourceResult.current.isNew).toBe(false);

        const noSource = { id: '6' };
        const { result: noSourceResult } = renderHook(() => useVideoCardMetadata({ video: noSource as any }));
        await expect(noSourceResult.current.getVideoUrl()).resolves.toBe('');
    });
});
