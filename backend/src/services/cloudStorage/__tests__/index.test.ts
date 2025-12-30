import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cloudScanner from '../cloudScanner';
import * as config from '../config';
import * as fileLister from '../fileLister';
import { CloudStorageService } from '../index';
import { CloudDriveConfig } from '../types';
import * as urlSigner from '../urlSigner';
import * as videoUploader from '../videoUploader';

vi.mock('../config');
vi.mock('../videoUploader');
vi.mock('../urlSigner');
vi.mock('../fileLister');
vi.mock('../cloudScanner');

describe('cloudStorage index (Service Facade)', () => {
    const mockConfig: CloudDriveConfig = {
        enabled: true,
        apiUrl: 'https://api.example.com',
        token: 'token',
        uploadPath: '/uploads'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(config.getConfig).mockReturnValue(mockConfig);
        vi.mocked(config.isConfigured).mockReturnValue(true);
    });

    describe('uploadVideo', () => {
        it('should delegate to videoUploader if configured', async () => {
            const videoData = { title: 'test' };
            await CloudStorageService.uploadVideo(videoData);
            expect(videoUploader.uploadVideo).toHaveBeenCalledWith(videoData, mockConfig);
        });

        it('should do nothing if not configured', async () => {
            vi.mocked(config.isConfigured).mockReturnValue(false);
            await CloudStorageService.uploadVideo({});
            expect(videoUploader.uploadVideo).not.toHaveBeenCalled();
        });
    });

    describe('getSignedUrl', () => {
        it('should delegate to urlSigner if configured', async () => {
            vi.mocked(urlSigner.getSignedUrl).mockResolvedValue('signed-url');
            
            const result = await CloudStorageService.getSignedUrl('test.mp4', 'video');
            
            expect(result).toBe('signed-url');
            expect(urlSigner.getSignedUrl).toHaveBeenCalledWith('test.mp4', 'video', mockConfig);
        });

        it('should return null if not configured', async () => {
            vi.mocked(config.isConfigured).mockReturnValue(false);
            const result = await CloudStorageService.getSignedUrl('test.mp4');
            expect(result).toBeNull();
        });
    });

    describe('clearCache', () => {
        it('should clear specific cache', () => {
            CloudStorageService.clearCache('test.mp4', 'video');
            expect(urlSigner.clearSignedUrlCache).toHaveBeenCalledWith('test.mp4', 'video');
        });

        it('should clear all caches', () => {
            CloudStorageService.clearCache();
            expect(urlSigner.clearSignedUrlCache).toHaveBeenCalledWith(); // undefined args inside implementation calls w/o args
            expect(fileLister.clearFileListCache).toHaveBeenCalled();
        });
    });

    describe('scanCloudFiles', () => {
         it('should delegate to cloudScanner if configured', async () => {
             const onProgress = vi.fn();
             await CloudStorageService.scanCloudFiles(onProgress);
             expect(cloudScanner.scanCloudFiles).toHaveBeenCalledWith(mockConfig, onProgress);
         });

         it('should return empty result if not configured', async () => {
             vi.mocked(config.isConfigured).mockReturnValue(false);
             const result = await CloudStorageService.scanCloudFiles();
             expect(result).toEqual({ added: 0, errors: [] });
             expect(cloudScanner.scanCloudFiles).not.toHaveBeenCalled();
         });
    });
});
