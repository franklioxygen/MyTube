import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as storageService from '../../storageService';
import * as fileLister from '../fileLister';
import * as fileUploader from '../fileUploader';
import * as pathUtils from '../pathUtils';
import { CloudDriveConfig } from '../types';
import * as urlSigner from '../urlSigner';
import { uploadVideo } from '../videoUploader';

vi.mock('fs-extra');
vi.mock('../fileUploader');
vi.mock('../pathUtils');
// Make sure to match the import path used in videoUploader.ts for storageService: 
// import { updateVideo } from "../storageService"; 
// So mocking "../../storageService" matches if paths resolve correctly.
vi.mock('../../storageService'); 
vi.mock('../urlSigner');
vi.mock('../fileLister');

describe('cloudStorage videoUploader', () => {
    const mockConfig: CloudDriveConfig = {
        enabled: true,
        apiUrl: 'https://api.example.com/api/fs/put',
        token: 'test-token',
        uploadPath: '/uploads',
        publicUrl: 'https://cdn.example.com',
    };

    const mockVideoData = {
        id: 'video-123',
        title: 'Test Video',
        videoPath: 'videos/test.mp4',
        thumbnailPath: 'images/test.jpg',
        description: 'Test Description',
        author: 'Test Author',
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Default Mocks
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.ensureDirSync).mockReturnValue(undefined);
        vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
        vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

        vi.mocked(pathUtils.resolveAbsolutePath).mockImplementation((p) => `/abs/${p}`);
        vi.mocked(pathUtils.sanitizeFilename).mockReturnValue('Test_Video');
        vi.mocked(pathUtils.normalizeUploadPath).mockReturnValue('/uploads');

        vi.mocked(fileUploader.uploadFile).mockResolvedValue({ uploaded: true, skipped: false });

        vi.mocked(storageService.updateVideo).mockReturnValue(null);
    });

    it('should upload video, thumbnail and metadata', async () => {
        await uploadVideo(mockVideoData, mockConfig);
        
        // Check uploads
        expect(fileUploader.uploadFile).toHaveBeenCalledTimes(3); 
        // 1. Video
        expect(fileUploader.uploadFile).toHaveBeenCalledWith('/abs/videos/test.mp4', mockConfig);
        // 2. Thumbnail
        expect(fileUploader.uploadFile).toHaveBeenCalledWith('/abs/images/test.jpg', mockConfig);
        // 3. Metadata
        expect(fileUploader.uploadFile).toHaveBeenCalledWith(
            expect.stringContaining('Test_Video.json'),
            mockConfig
        );
        
        // Check DB update
        expect(storageService.updateVideo).toHaveBeenCalledWith('video-123', expect.objectContaining({
            videoPath: 'cloud:test.mp4',
            thumbnailPath: 'cloud:test.jpg'
        }));
        
        // Check Cleanup
        expect(fs.unlinkSync).toHaveBeenCalledTimes(3); // Metadata + Video + Thumbnail
    });

    it('should handle skipped uploads (already exists)', async () => {
        vi.mocked(fileUploader.uploadFile).mockResolvedValue({ uploaded: false, skipped: true });
        
        await uploadVideo(mockVideoData, mockConfig);
        
        // DB should still update
         expect(storageService.updateVideo).toHaveBeenCalledWith('video-123', expect.objectContaining({
            videoPath: 'cloud:test.mp4'
        }));
        
        // Metadata temp file deleted
        // But local video/thumb NOT deleted (only deleted if uploaded: true)
        // Wait, logic says:
        // if (uploadedFiles.length > 0) ... loop uploadedFiles delete
        // uploadedFiles only gets added if uploaded: true.
        // filesToUpdate gets added if uploaded or skipped.
        
        // Metadata is always temp file unlinkSync'd separately.
        
        expect(fs.unlinkSync).toHaveBeenCalledTimes(1); // Metadata only
    });

    it('should skip file if local file missing', async () => {
         vi.mocked(fs.existsSync).mockImplementation((p) => {
             return p !== '/abs/videos/test.mp4';
         });

         await uploadVideo(mockVideoData, mockConfig);
         
         expect(fileUploader.uploadFile).not.toHaveBeenCalledWith('/abs/videos/test.mp4', mockConfig);
         // Thumbnail exists
         expect(fileUploader.uploadFile).toHaveBeenCalledWith('/abs/images/test.jpg', mockConfig);
    });

    it('should handle failures gracefully', async () => {
        vi.mocked(fileUploader.uploadFile).mockRejectedValue(new Error('Upload Failed'));
        
        await uploadVideo(mockVideoData, mockConfig);
        
        // Should not crash
        // Should log error
        // Should NOT delete files
        expect(fs.unlinkSync).not.toHaveBeenCalledWith('/abs/videos/test.mp4');
    });

    it('should clear caches after update', async () => {
        await uploadVideo(mockVideoData, mockConfig);
        
        expect(urlSigner.clearSignedUrlCache).toHaveBeenCalledTimes(2); // video + thumbnail
        expect(fileLister.clearFileListCache).toHaveBeenCalled();
    });
});
