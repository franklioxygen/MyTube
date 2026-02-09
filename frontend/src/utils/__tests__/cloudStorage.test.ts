import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to import the module under test dynamically to allowing re-evaluating the top-level const
let cloudStorage: any;

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('cloudStorage', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.resetModules();
        vi.stubEnv('VITE_BACKEND_URL', 'http://localhost:5551');
        
        // Re-import after setting env
        cloudStorage = await import('../cloudStorage');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('isCloudStoragePath', () => {
        it('should identify cloud paths', () => {
            expect(cloudStorage.isCloudStoragePath('cloud:video.mp4')).toBe(true);
            expect(cloudStorage.isCloudStoragePath('http://example.com')).toBe(false);
            expect(cloudStorage.isCloudStoragePath(null)).toBe(false);
            expect(cloudStorage.isCloudStoragePath(undefined)).toBe(false);
        });
    });

    describe('extractCloudFilename', () => {
        it('should extract filename', () => {
            expect(cloudStorage.extractCloudFilename('cloud:video.mp4')).toBe('video.mp4');
            expect(cloudStorage.extractCloudFilename('plain.mp4')).toBe('plain.mp4');
        });
    });

    describe('getCloudStorageSignedUrl', () => {
        it('should fetch signed url', async () => {
            const mockUrl = 'https://s3.example.com/signed-url';
            mockedAxios.get.mockResolvedValueOnce({
                data: { success: true, url: mockUrl }
            });

            const result = await cloudStorage.getCloudStorageSignedUrl('video.mp4');
            expect(result).toBe(mockUrl);
            expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('/cloud/signed-url'), expect.any(Object));
        });

        it('should handle API failure', async () => {
            mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await cloudStorage.getCloudStorageSignedUrl('video.mp4');
            expect(result).toBeNull();
            
            consoleSpy.mockRestore();
        });
        
        // Skip deduplication test for now as re-import creates new module instance which resets cache
        // Or we can rebuild deduction test to be simpler
    });

    describe('getFileUrl', () => {
        it('should return already full URLs as is', async () => {
            expect(await cloudStorage.getFileUrl('https://example.com')).toBe('https://example.com');
        });

        it('should prepend backend URL for local paths', async () => {
            const url = await cloudStorage.getFileUrl('/uploads/video.mp4');
            expect(url).toBe('http://localhost:5551/uploads/video.mp4');
        });

        it('should resolve cloud paths', async () => {
            const mockUrl = 'https://s3.example.com/signed';
            mockedAxios.get.mockResolvedValueOnce({
                data: { success: true, url: mockUrl }
            });

            const url = await cloudStorage.getFileUrl('cloud:video.mp4');
            expect(url).toBe(mockUrl);
        });
    });

    describe('getFileUrlSync', () => {
        it('should return already full URLs as is', () => {
             expect(cloudStorage.getFileUrlSync('https://example.com')).toBe('https://example.com');
        });

        it('should prepend backend URL for local paths', () => {
            expect(cloudStorage.getFileUrlSync('/uploads/video.mp4')).toBe('http://localhost:5551/uploads/video.mp4');
        });
        
        it('should return marker for cloud paths', () => {
            expect(cloudStorage.getFileUrlSync('cloud:video.mp4')).toBe('cloud:video.mp4');
        });
    });
});
