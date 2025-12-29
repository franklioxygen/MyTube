import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cloudStorageUtils from '../../utils/cloudStorage';
import { useCloudStorageUrl } from '../useCloudStorageUrl';

// Mock utility functions
vi.mock('../../utils/cloudStorage', async () => {
    const actual = await vi.importActual('../../utils/cloudStorage');
    return {
        ...actual,
        isCloudStoragePath: vi.fn(),
        getFileUrl: vi.fn(),
    };
});

describe('useCloudStorageUrl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        vi.stubEnv('VITE_BACKEND_URL', 'http://localhost:5551');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('should return undefined for null/empty path', () => {
        const { result } = renderHook(() => useCloudStorageUrl(null));
        expect(result.current).toBeUndefined();
    });

    it('should return full URLs immediately', () => {
        const { result } = renderHook(() => useCloudStorageUrl('https://example.com'));
        expect(result.current).toBe('https://example.com');
    });

    it('should calculate local URL synchronously', () => {
        vi.mocked(cloudStorageUtils.isCloudStoragePath).mockReturnValue(false);
        // Assuming default BACKEND_URL
        const { result } = renderHook(() => useCloudStorageUrl('/local/path.mp4'));
        expect(result.current).toMatch(/http:\/\/localhost:5551\/local\/path.mp4/);
    });

    it('should resolve cloud paths asynchronously', async () => {
        vi.mocked(cloudStorageUtils.isCloudStoragePath).mockReturnValue(true);
        vi.mocked(cloudStorageUtils.getFileUrl).mockResolvedValue('https://s3.signed/url');

        const { result } = renderHook(() => useCloudStorageUrl('cloud:video.mp4'));

        // Initially undefined while resolving
        expect(result.current).toBeUndefined();

        await waitFor(() => {
            expect(result.current).toBe('https://s3.signed/url');
        });
    });
});
