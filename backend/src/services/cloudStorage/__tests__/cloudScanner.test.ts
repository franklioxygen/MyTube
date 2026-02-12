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
import { logger } from '../../../utils/logger';

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

    it('should fallback to file.sign when signed url lookup returns null', async () => {
        vi.mocked(fileLister.getFilesRecursively).mockImplementation(async (_config, scanPath) => {
            if (scanPath === '/uploads') {
                return [
                    {
                        file: { name: 'signed_by_file.mp4', is_dir: false, sign: 'file-sign' },
                        path: '/uploads/signed_by_file.mp4'
                    }
                ] as any;
            }
            return [];
        });
        vi.mocked(urlSigner.getSignedUrl).mockResolvedValue(null);

        const result = await scanCloudFiles(mockConfig);

        expect(result.added).toBe(1);
        expect(security.validateUrl).toHaveBeenCalledWith(
            'https://cdn.example.com/d/uploads/signed_by_file.mp4?sign=file-sign'
        );
    });

    it('should continue when ffprobe duration lookup fails', async () => {
        vi.mocked(fileLister.getFilesRecursively).mockImplementation(async (_config, scanPath) => {
            if (scanPath === '/uploads') {
                return [
                    {
                        file: { name: 'no_duration.mp4', is_dir: false },
                        path: '/uploads/no_duration.mp4'
                    }
                ] as any;
            }
            return [];
        });
        vi.mocked(security.execFileSafe).mockImplementation(async (cmd) => {
            if (cmd === 'ffprobe') {
                throw new Error('ffprobe failed');
            }
            return { stdout: '', stderr: '' };
        });

        const result = await scanCloudFiles(mockConfig);

        expect(result.added).toBe(1);
        expect(storageService.saveVideo).toHaveBeenCalledWith(
            expect.objectContaining({
                videoFilename: 'no_duration.mp4',
                duration: undefined,
            })
        );
    });

    it('should retry ffmpeg failures and continue without thumbnail after max retries', async () => {
        vi.mocked(fileLister.getFilesRecursively).mockImplementation(async (_config, scanPath) => {
            if (scanPath === '/uploads') {
                return [
                    {
                        file: { name: 'retry_no_thumb.mp4', is_dir: false },
                        path: '/uploads/retry_no_thumb.mp4'
                    }
                ] as any;
            }
            return [];
        });

        const timeoutSpy = vi
            .spyOn(global, 'setTimeout')
            .mockImplementation(((fn: any) => {
                if (typeof fn === 'function') fn();
                return 0 as any;
            }) as any);

        vi.mocked(security.execFileSafe).mockImplementation(async (cmd) => {
            if (cmd === 'ffprobe') {
                return { stdout: '60', stderr: '' };
            }
            throw new Error('ffmpeg failed');
        });

        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const asText = String(p);
            if (asText.includes('temp_')) return true;
            return true;
        });
        vi.mocked(fs.unlinkSync).mockImplementation(() => undefined as any);

        const result = await scanCloudFiles(mockConfig);
        timeoutSpy.mockRestore();

        expect(result.added).toBe(1);
        expect(storageService.saveVideo).toHaveBeenCalledWith(
            expect.objectContaining({
                thumbnailFilename: undefined,
                thumbnailPath: undefined,
                thumbnailUrl: undefined,
            })
        );
    });

    it('should ignore temp cleanup errors during ffmpeg retry attempts', async () => {
        vi.mocked(fileLister.getFilesRecursively).mockImplementation(async (_config, scanPath) => {
            if (scanPath === '/uploads') {
                return [
                    {
                        file: { name: 'cleanup_error.mp4', is_dir: false },
                        path: '/uploads/cleanup_error.mp4'
                    }
                ] as any;
            }
            return [];
        });

        const timeoutSpy = vi
            .spyOn(global, 'setTimeout')
            .mockImplementation(((fn: any) => {
                if (typeof fn === 'function') fn();
                return 0 as any;
            }) as any);

        vi.mocked(security.execFileSafe).mockImplementation(async (cmd) => {
            if (cmd === 'ffprobe') return { stdout: '10', stderr: '' };
            throw new Error('ffmpeg failed');
        });

        vi.mocked(fs.existsSync).mockImplementation((p: any) => {
            const asText = String(p);
            if (asText.includes('temp_')) return true;
            return true;
        });
        vi.mocked(fs.unlinkSync).mockImplementation((p: any) => {
            const asText = String(p);
            if (asText.includes('temp_')) {
                throw new Error('cleanup failed');
            }
            return undefined as any;
        });

        const result = await scanCloudFiles(mockConfig);
        timeoutSpy.mockRestore();

        expect(result.added).toBe(1);
    });

    it('should handle scanPath files and skipped thumbnail uploads', async () => {
        const scanPathConfig: CloudDriveConfig = {
            ...mockConfig,
            scanPaths: ['/movies'],
        };

        vi.mocked(fileLister.getFilesRecursively).mockImplementation(async (_config, scanPath) => {
            if (scanPath === '/uploads') return [];
            if (scanPath === '/movies') {
                return [
                    {
                        file: { name: 'from_scanpath.mp4', is_dir: false },
                        path: '/movies/from_scanpath.mp4'
                    }
                ] as any;
            }
            return [];
        });
        vi.mocked(fileUploader.uploadFile).mockResolvedValue({ uploaded: false, skipped: true } as any);

        const result = await scanCloudFiles(scanPathConfig);

        expect(result.added).toBe(1);
        expect(storageService.saveVideo).toHaveBeenCalledWith(
            expect.objectContaining({
                videoPath: 'cloud:movies/from_scanpath.mp4',
                thumbnailFilename: expect.stringMatching(/\.jpg$/),
                thumbnailPath: expect.stringContaining('cloud:movies/'),
                thumbnailUrl: expect.stringContaining('cloud:movies/'),
            })
        );
    });

    it('should collect processing errors when saveVideo throws', async () => {
        vi.mocked(fileLister.getFilesRecursively).mockResolvedValue([
            {
                file: { name: 'save_fail.mp4', is_dir: false },
                path: '/uploads/save_fail.mp4'
            }
        ] as any);
        vi.mocked(storageService.saveVideo).mockImplementation(() => {
            throw new Error('db write failed');
        });

        const result = await scanCloudFiles(mockConfig);

        expect(result.added).toBe(0);
        expect(result.errors).toEqual(
            expect.arrayContaining([expect.stringContaining('save_fail.mp4: db write failed')])
        );
    });

    it('should handle rejected per-video promise branch in batch settlement', async () => {
        vi.mocked(fileLister.getFilesRecursively).mockImplementation(async (_config, scanPath) => {
            if (scanPath === '/uploads') {
                return [
                    {
                        file: { name: 'reject_branch.mp4', is_dir: false },
                        path: '/uploads/reject_branch.mp4'
                    }
                ] as any;
            }
            return [];
        });
        vi.mocked(storageService.saveVideo).mockImplementation(() => {
            throw new Error('db failed');
        });
        const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {
            throw new Error('logger exploded');
        });

        const result = await scanCloudFiles(mockConfig);
        loggerSpy.mockRestore();

        expect(result.added).toBe(0);
        expect(result.errors).toEqual(
            expect.arrayContaining([expect.stringContaining('reject_branch.mp4: logger exploded')])
        );
    });

    it('should return top-level failure result when recursive listing throws', async () => {
        vi.mocked(fileLister.getFilesRecursively).mockRejectedValue(
            new Error('scan root failed')
        );

        const result = await scanCloudFiles(mockConfig, mockCallback);

        expect(result).toEqual({
            added: 0,
            errors: ['scan root failed'],
        });
        expect(mockCallback).toHaveBeenCalledWith('Scan failed: scan root failed');
    });
});
