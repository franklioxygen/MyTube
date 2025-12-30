import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fileLister from '../fileLister';
import * as pathUtils from '../pathUtils';
import { CloudDriveConfig } from '../types';
import { clearSignedUrlCache, getSignedUrl } from '../urlSigner';

describe('cloudStorage urlSigner', () => {
    const mockConfig: CloudDriveConfig = {
        enabled: true,
        apiUrl: 'https://api.example.com/api/fs/put',
        token: 'test-token',
        uploadPath: '/uploads',
        publicUrl: 'https://cdn.example.com',
    };

    const normalizeUploadPathMock = vi.spyOn(pathUtils, 'normalizeUploadPath');
    const getFileListMock = vi.spyOn(fileLister, 'getFileList');

    beforeEach(() => {
        vi.clearAllMocks();
        clearSignedUrlCache();

        // Default mock implementations
        normalizeUploadPathMock.mockImplementation((path) => path);
        getFileListMock.mockResolvedValue([]);
    });

    describe('getSignedUrl', () => {
        it('should return null if file not found', async () => {
            const url = await getSignedUrl('video.mp4', 'video', mockConfig);
            expect(url).toBeNull();
        });

        it('should return signed URL for video found in upload path', async () => {
            getFileListMock.mockResolvedValue([
                { name: 'video.mp4', is_dir: false, sign: 'test-signature' }
            ]);

            const url = await getSignedUrl('video.mp4', 'video', mockConfig);

            expect(getFileListMock).toHaveBeenCalledWith(mockConfig, '/uploads');
            expect(url).toBe('https://cdn.example.com/d/uploads/video.mp4?sign=test-signature');
        });

        it('should return cached URL if available and valid', async () => {
            getFileListMock.mockResolvedValue([
                { name: 'video.mp4', is_dir: false, sign: 'first-signature' }
            ]);

            // First call to populate cache
            await getSignedUrl('video.mp4', 'video', mockConfig);
            
            // Change mock return value
            getFileListMock.mockResolvedValue([
                { name: 'video.mp4', is_dir: false, sign: 'second-signature' }
            ]);

            // Second call should return cached value
            const url = await getSignedUrl('video.mp4', 'video', mockConfig);
            expect(url).toBe('https://cdn.example.com/d/uploads/video.mp4?sign=first-signature');
            expect(getFileListMock).toHaveBeenCalledTimes(1);
        });

        it('should clear cache and fetch new URL', async () => {
            getFileListMock.mockResolvedValue([
                { name: 'video.mp4', is_dir: false, sign: 'first-signature' }
            ]);

            await getSignedUrl('video.mp4', 'video', mockConfig);
            
            clearSignedUrlCache('video.mp4', 'video');
            
            getFileListMock.mockResolvedValue([
                { name: 'video.mp4', is_dir: false, sign: 'second-signature' }
            ]);

            const url = await getSignedUrl('video.mp4', 'video', mockConfig);
            expect(url).toBe('https://cdn.example.com/d/uploads/video.mp4?sign=second-signature');
            expect(getFileListMock).toHaveBeenCalledTimes(2);
        });

        it('should handle file with directory path', async () => {
            // Mock finding file in subdir
            getFileListMock.mockResolvedValue([
                { name: 'movie.mp4', is_dir: false, sign: 'subdir-sig' }
            ]);

            const url = await getSignedUrl('movies/movie.mp4', 'video', mockConfig);
            
            expect(getFileListMock).toHaveBeenCalledWith(mockConfig, '/uploads/movies');
            expect(url).toBe('https://cdn.example.com/d/uploads/movies/movie.mp4?sign=subdir-sig');
        });

        it('should search recursively if directory is "." (filename only)', async () => {
            // First mock root dir listing which has a subdir
            getFileListMock.mockImplementation(async (config, path) => {
                if (path === '/uploads') {
                    return [{ name: 'subdir', is_dir: true }];
                }
                if (path === '/uploads/subdir') {
                    return [{ name: 'nested.mp4', is_dir: false, sign: 'nested-sig' }];
                }
                return [];
            });

            const url = await getSignedUrl('nested.mp4', 'video', mockConfig);
            
            expect(url).toBe('https://cdn.example.com/d/uploads/subdir/nested.mp4?sign=nested-sig');
        });

        it('should get thumbnail URL with sign preference', async () => {
            getFileListMock.mockResolvedValue([
                { name: 'thumb.jpg', is_dir: false, sign: 'thumb-sig', thumb: 'http://original-thumb' }
            ]);

            const url = await getSignedUrl('thumb.jpg', 'thumbnail', mockConfig);
            expect(url).toBe('https://cdn.example.com/d/uploads/thumb.jpg?sign=thumb-sig');
        });

         it('should fallback to thumb property if sign is missing', async () => {
            getFileListMock.mockResolvedValue([
                { name: 'thumb.jpg', is_dir: false, thumb: 'http://api.example.com/thumb?width=100&height=100' }
            ]);

            const url = await getSignedUrl('thumb.jpg', 'thumbnail', mockConfig);
            // Thumb URL logic replaces domain and resizes
            expect(url).toBe('https://cdn.example.com/thumb?width=1280&height=720');
        });
    });
});
