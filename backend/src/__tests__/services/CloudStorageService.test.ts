import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileError, NetworkError } from '../../errors/DownloadErrors';
import * as storageService from '../../services/storageService';
import { CloudStorageService } from '../../services/CloudStorageService';

vi.mock('axios');
vi.mock('fs-extra');
vi.mock('../../services/storageService');

describe('CloudStorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
  });

  describe('uploadVideo', () => {
    it('should return early if cloud drive is not enabled', async () => {
      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: false,
      });

      await CloudStorageService.uploadVideo({ title: 'Test Video' });

      expect(axios.put).not.toHaveBeenCalled();
    });

    it('should return early if apiUrl is missing', async () => {
      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: '',
        openListToken: 'token',
      });

      await CloudStorageService.uploadVideo({ title: 'Test Video' });

      expect(axios.put).not.toHaveBeenCalled();
    });

    it('should return early if token is missing', async () => {
      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: '',
      });

      await CloudStorageService.uploadVideo({ title: 'Test Video' });

      expect(axios.put).not.toHaveBeenCalled();
    });

    it('should upload video file when path exists', async () => {
      const mockVideoData = {
        title: 'Test Video',
        videoPath: '/videos/test.mp4',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      (fs.createReadStream as any).mockReturnValue({});
      (axios.put as any).mockResolvedValue({ status: 200 });

      // Mock resolveAbsolutePath by making fs.existsSync return true for data dir
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes('data') && !p.includes('videos') && !p.includes('images')) {
          return true;
        }
        if (p.includes('test.mp4') || p.includes('videos')) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(axios.put).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        '[CloudStorage] Starting upload for video: Test Video'
      );
    });

    it('should upload thumbnail when path exists', async () => {
      const mockVideoData = {
        title: 'Test Video',
        thumbnailPath: '/images/thumb.jpg',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 512 });
      (fs.createReadStream as any).mockReturnValue({});
      (axios.put as any).mockResolvedValue({ status: 200 });

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes('data') && !p.includes('videos') && !p.includes('images')) {
          return true;
        }
        if (p.includes('thumb.jpg') || p.includes('images')) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(axios.put).toHaveBeenCalled();
    });

    it('should upload metadata JSON file', async () => {
      const mockVideoData = {
        title: 'Test Video',
        description: 'Test description',
        author: 'Test Author',
        sourceUrl: 'https://example.com',
        tags: ['tag1', 'tag2'],
        createdAt: '2024-01-01',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.ensureDirSync as any).mockReturnValue(undefined);
      (fs.writeFileSync as any).mockReturnValue(undefined);
      (fs.statSync as any).mockReturnValue({ size: 256 });
      (fs.createReadStream as any).mockReturnValue({});
      (fs.unlinkSync as any).mockReturnValue(undefined);
      (axios.put as any).mockResolvedValue({ status: 200 });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(fs.ensureDirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(axios.put).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should handle missing video file gracefully', async () => {
      const mockVideoData = {
        title: 'Test Video',
        videoPath: '/videos/missing.mp4',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      // Mock existsSync to return false for video file, but true for data dir and temp_metadata
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes('data') && !p.includes('videos') && !p.includes('images')) {
          return true;
        }
        if (p.includes('temp_metadata')) {
          return true;
        }
        if (p.includes('missing.mp4') || p.includes('videos')) {
          return false;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalledWith(
        '[CloudStorage] Video file not found: /videos/missing.mp4'
      );
      // Metadata will still be uploaded even if video is missing
      // So we check that video upload was not attempted
      const putCalls = (axios.put as any).mock.calls;
      const videoUploadCalls = putCalls.filter((call: any[]) => 
        call[0] && call[0].includes('missing.mp4')
      );
      expect(videoUploadCalls.length).toBe(0);
    });

    it('should handle upload errors gracefully', async () => {
      const mockVideoData = {
        title: 'Test Video',
        videoPath: '/videos/test.mp4',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      (fs.createReadStream as any).mockReturnValue({});
      (axios.put as any).mockRejectedValue(new Error('Upload failed'));

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes('data') && !p.includes('videos') && !p.includes('images')) {
          return true;
        }
        if (p.includes('test.mp4')) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalledWith(
        '[CloudStorage] Upload failed for Test Video:',
        expect.any(Error)
      );
    });

    it('should sanitize filename for metadata', async () => {
      const mockVideoData = {
        title: 'Test Video (2024)',
        description: 'Test',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.ensureDirSync as any).mockReturnValue(undefined);
      (fs.writeFileSync as any).mockReturnValue(undefined);
      (fs.statSync as any).mockReturnValue({ size: 256 });
      (fs.createReadStream as any).mockReturnValue({});
      (fs.unlinkSync as any).mockReturnValue(undefined);
      (axios.put as any).mockResolvedValue({ status: 200 });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const metadataPath = (fs.writeFileSync as any).mock.calls[0][0];
      // The sanitize function replaces non-alphanumeric with underscore, so ( becomes _
      expect(metadataPath).toContain('test_video__2024_.json');
    });
  });

  describe('uploadFile error handling', () => {
    it('should throw NetworkError on HTTP error response', async () => {
      const mockVideoData = {
        title: 'Test Video',
        videoPath: '/videos/test.mp4',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      (fs.createReadStream as any).mockReturnValue({});

      const axiosError = {
        response: {
          status: 500,
        },
        message: 'Internal Server Error',
      };
      (axios.put as any).mockRejectedValue(axiosError);

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes('data') && !p.includes('videos') && !p.includes('images')) {
          return true;
        }
        if (p.includes('test.mp4')) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalled();
    });

    it('should handle network timeout errors', async () => {
      const mockVideoData = {
        title: 'Test Video',
        videoPath: '/videos/test.mp4',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      (fs.createReadStream as any).mockReturnValue({});

      const axiosError = {
        request: {},
        message: 'Timeout',
      };
      (axios.put as any).mockRejectedValue(axiosError);

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes('data') && !p.includes('videos') && !p.includes('images')) {
          return true;
        }
        if (p.includes('test.mp4')) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalled();
    });

    it('should handle file not found errors', async () => {
      const mockVideoData = {
        title: 'Test Video',
        videoPath: '/videos/test.mp4',
      };

      (storageService.getSettings as any).mockReturnValue({
        cloudDriveEnabled: true,
        openListApiUrl: 'https://api.example.com',
        openListToken: 'test-token',
        cloudDrivePath: '/uploads',
      });

      (fs.existsSync as any).mockReturnValue(true);
      (fs.statSync as any).mockReturnValue({ size: 1024 });
      (fs.createReadStream as any).mockReturnValue({});

      const axiosError = {
        code: 'ENOENT',
        message: 'File not found',
      };
      (axios.put as any).mockRejectedValue(axiosError);

      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes('data') && !p.includes('videos') && !p.includes('images')) {
          return true;
        }
        if (p.includes('test.mp4')) {
          return true;
        }
        return false;
      });

      await CloudStorageService.uploadVideo(mockVideoData);

      expect(console.error).toHaveBeenCalled();
    });
  });
});

