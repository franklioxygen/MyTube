import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as security from '../../../utils/security';
import * as storageService from '../../storageService';
import { scanCloudFiles } from '../cloudScanner';
import * as cloudThumbnailCache from '../cloudThumbnailCache';
import * as fileLister from '../fileLister';
import * as fileUploader from '../fileUploader';
import { CloudDriveConfig } from '../types';
import * as urlSigner from '../urlSigner';

vi.mock('fs-extra');
vi.mock('../fileLister');
vi.mock('../urlSigner');
vi.mock('../../storageService');
vi.mock('../../../utils/security'); // Auto-mock without factory to avoid hoisting issues
vi.mock('../fileUploader');
vi.mock('../cloudThumbnailCache');

describe('cloudStorage cloudScanner', () => {
    const mockConfig: CloudDriveConfig = {
        enabled: true,
        apiUrl: 'https://api.example.com/api/fs/put',
        token: 'test-token',
        uploadPath: '/uploads',
        publicUrl: 'https://cdn.example.com',
        scanPaths: ['/movies'],
    };

    const mockCallback = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Default Mocks
        vi.mocked(fs.ensureDirSync).mockReturnValue(undefined);
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as any);
        vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

        // File Lister
        vi.mocked(fileLister.getFilesRecursively).mockImplementation(async (config, scanPath) => {
             if (scanPath === '/uploads') {
                 return [
                    {
                        file: { name: 'new_video.mp4', is_dir: false, modified: new Date().toISOString() },
                        path: '/uploads/new_video.mp4'
                    },
                    {
                        file: { name: 'existing_video.mp4', is_dir: false },
                        path: '/uploads/existing_video.mp4'
                    }
                ];
             }
             return [];
        });

        // DB
        vi.mocked(storageService.getVideos).mockReturnValue([
            {
                id: '1',
                title: 'Existing Video',
                videoFilename: 'existing_video.mp4',
                videoPath: 'cloud:existing_video.mp4'
            } as any
        ]);
        vi.mocked(storageService.saveVideo).mockImplementation((video) => video);

        // URL Signer
        vi.mocked(urlSigner.getSignedUrl).mockResolvedValue('https://signed.url/video.mp4');

        // Security / Exec
        // Important: Mock implementations for passthrough functions
        vi.mocked(security.validateUrl).mockImplementation((url) => url);
        vi.mocked(security.validateImagePath).mockImplementation((path) => path);

        vi.mocked(security.execFileSafe).mockImplementation(async (cmd, args) => {
            if (cmd === 'ffprobe') {
                return { stdout: '120.5', stderr: '' }; // 120.5 seconds duration
            }
            if (cmd === 'ffmpeg') {
                // Simulate thumbnail creation
                return { stdout: '', stderr: '' };
            }
            return { stdout: '', stderr: '' };
        });

        // Upload
        vi.mocked(fileUploader.uploadFile).mockResolvedValue({ uploaded: true, skipped: false });
        
        // Cache
        vi.mocked(cloudThumbnailCache.saveThumbnailToCache).mockResolvedValue(undefined);
    });

    it('should scan files and add new videos', async () => {
        const result = await scanCloudFiles(mockConfig, mockCallback);

        // Verify scanning
        expect(fileLister.getFilesRecursively).toHaveBeenCalledWith(mockConfig, '/uploads');
        expect(fileLister.getFilesRecursively).toHaveBeenCalledWith(mockConfig, '/movies'); // Scan paths
        
        // Verify Video Checking
        // Existing video should be filtered out
        expect(storageService.getVideos).toHaveBeenCalled();
        
        // Verify Processing of New Video
        expect(urlSigner.getSignedUrl).toHaveBeenCalledWith('new_video.mp4', 'video', mockConfig);
        
        // Duration Check
        expect(security.execFileSafe).toHaveBeenCalledWith('ffprobe', expect.anything(), expect.anything());
        
        // Thumbnail Generation
        expect(security.execFileSafe).toHaveBeenCalledWith('ffmpeg', expect.anything(), expect.anything());
        
        // Thumbnail Upload
        expect(fileUploader.uploadFile).toHaveBeenCalled();
        
        // Save Video
        expect(storageService.saveVideo).toHaveBeenCalledWith(expect.objectContaining({
            videoFilename: 'new_video.mp4',
            videoPath: 'cloud:new_video.mp4', // Relative to uploads root
            duration: '121' // 120.5 rounded
        }));
        
        expect(result.added).toBe(1);
        expect(result.errors).toHaveLength(0);
        expect(mockCallback).toHaveBeenCalled();
    });

    it('should ignore non-video files', async () => {
         vi.mocked(fileLister.getFilesRecursively).mockResolvedValue([
            {
                file: { name: 'image.jpg', is_dir: false },
                path: '/uploads/image.jpg'
            }
        ]);

        const result = await scanCloudFiles(mockConfig);
        
        expect(result.added).toBe(0);
        expect(storageService.saveVideo).not.toHaveBeenCalled();
    });

    it('should handle failure in video processing gracefully', async () => {
        // Make getSignedUrl fail
        vi.mocked(urlSigner.getSignedUrl).mockResolvedValue(null);

        const result = await scanCloudFiles(mockConfig);
        
        expect(result.added).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('Failed to get signed URL');
    });

     it('should generate thumbnail with correct time point', async () => {
         // Mock long duration
         vi.mocked(security.execFileSafe).mockImplementation(async (cmd) => {
             if (cmd === 'ffprobe') return { stdout: '3661', stderr: '' }; // 1h 1m 1s
             return { stdout: '', stderr: '' };
         });

         await scanCloudFiles(mockConfig);
         
         // 1830.5 -> 1830
         // 1830 = 30m 30s -> 00:30:30
         
         expect(security.execFileSafe).toHaveBeenCalledWith('ffmpeg', 
            expect.arrayContaining(['00:30:30']),
            expect.anything()
         );
     });
});
