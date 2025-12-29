import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useVideoCardMetadata } from '../useVideoCardMetadata';

// Mock dependencies
vi.mock('../useCloudStorageUrl', () => ({
    useCloudStorageUrl: (path: string | null) => path ? `cloud-url/${path}` : null
}));

// Mock isNewVideo util
vi.mock('../../utils/videoCardUtils', () => ({
    isNewVideo: () => true
}));

describe('useVideoCardMetadata', () => {
    it('should return cloud url if available', async () => {
        const mockVideo = {
            id: '1',
            videoPath: 'cloud:video.mp4',
            thumbnailPath: 'cloud:thumb.jpg'
        };

        const { result } = renderHook(() => useVideoCardMetadata({ video: mockVideo as any }));
        
        expect(result.current.videoUrl).toBe('cloud-url/cloud:video.mp4');
        expect(result.current.thumbnailSrc).toBe('cloud-url/cloud:thumb.jpg');
        
        const url = await result.current.getVideoUrl();
        expect(url).toBe('cloud-url/cloud:video.mp4');
    });

    it('should return local url fallback', async () => {
        const mockVideo = {
            id: '1',
            videoPath: '/local/video.mp4',
            thumbnailPath: '/local/thumb.jpg',
            thumbnailUrl: 'http://thumb.url'
        };

        const { result } = renderHook(() => useVideoCardMetadata({ video: mockVideo as any }));
        
        // Mock import.meta.env behavior or window.location if needed for exact string match
        // Based on implementation: `${window.location.origin}${videoPath}`
        // In test env, window.location.origin is usually http://localhost:3000
        
        const url = await result.current.getVideoUrl();
        expect(url).toContain('/local/video.mp4');
        expect(result.current.thumbnailSrc).toContain('/local/thumb.jpg');
    });

    it('should prioritize thumbnailUrl if no local/cloud path', () => {
         const mockVideo = {
            id: '1',
            thumbnailUrl: 'http://external.com/thumb.jpg'
        };

        const { result } = renderHook(() => useVideoCardMetadata({ video: mockVideo as any }));
        expect(result.current.thumbnailSrc).toBe('http://external.com/thumb.jpg');
    });
});
