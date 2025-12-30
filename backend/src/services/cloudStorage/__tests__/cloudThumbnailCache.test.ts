import axios from 'axios';
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_THUMBNAIL_CACHE_DIR } from '../../../config/paths';
import { clearThumbnailCache, downloadAndCacheThumbnail, getCachedThumbnail, getCacheStats, saveThumbnailToCache } from '../cloudThumbnailCache';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('axios');
vi.mock('../../../utils/security', () => ({
  validateCloudThumbnailCachePath: vi.fn((p) => p),
  validateUrl: vi.fn((u) => u),
}));

describe('cloudThumbnailCache', () => {
  const mockCloudPath = 'cloud:movies/test.mp4';
  // MD5 of 'cloud:movies/test.mp4' is 2f0... (mocking not needed for crypto as it's stable)
  // but we can just matching the behavior or let it run since crypto is std lib.
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default fs behavior
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.ensureDirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.copy).mockResolvedValue(undefined);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    // Mock fs.statSync to return a file object
    vi.mocked(fs.statSync).mockReturnValue({
        isFile: () => false,
        size: 0
    } as any);
  });

  describe('getCachedThumbnail', () => {
    it('should return null for invalid cloud path', () => {
      expect(getCachedThumbnail('invalid')).toBeNull();
    });

    it('should return null if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(getCachedThumbnail(mockCloudPath)).toBeNull();
    });

    it('should return path if file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const result = getCachedThumbnail(mockCloudPath);
      expect(result).toContain(CLOUD_THUMBNAIL_CACHE_DIR);
    });
  });

  describe('saveThumbnailToCache', () => {
    it('should do nothing for invalid cloud path', async () => {
      await saveThumbnailToCache('invalid', Buffer.from('data'));
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should write buffer to file', async () => {
      const buffer = Buffer.from('test-data');
      await saveThumbnailToCache(mockCloudPath, buffer);
      
      expect(fs.ensureDirSync).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('.jpg'), buffer);
    });

    it('should copy file if input is string path', async () => {
      const inputPath = '/tmp/thumb.jpg';
      await saveThumbnailToCache(mockCloudPath, inputPath);
      
      expect(fs.copy).toHaveBeenCalledWith(inputPath, expect.stringContaining('.jpg'));
    });

    it('should skip copy if target exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const inputPath = '/tmp/thumb.jpg';
      
      await saveThumbnailToCache(mockCloudPath, inputPath);
      expect(fs.copy).not.toHaveBeenCalled();
    });
  });

  describe('downloadAndCacheThumbnail', () => {
    const mockSignedUrl = 'https://example.com/thumb.jpg';
    
    it('should return null for invalid cloud path', async () => {
      expect(await downloadAndCacheThumbnail('invalid', mockSignedUrl)).toBeNull();
    });

    it('should return existing cache path if already cached', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const result = await downloadAndCacheThumbnail(mockCloudPath, mockSignedUrl);
      
      expect(result).not.toBeNull();
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should download and save thumbnail', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(axios.get).mockResolvedValue({
        data: Buffer.from('image-data'),
        status: 200
      });

      const result = await downloadAndCacheThumbnail(mockCloudPath, mockSignedUrl);
      
      expect(axios.get).toHaveBeenCalledWith(mockSignedUrl, expect.objectContaining({ responseType: 'arraybuffer' }));
      expect(fs.writeFile).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('should return null on download failure', async () => {
        vi.mocked(axios.get).mockRejectedValue(new Error('Network Error'));
        
        const result = await downloadAndCacheThumbnail(mockCloudPath, mockSignedUrl);
        expect(result).toBeNull();
    });
    
    it('should return null on empty response', async () => {
        vi.mocked(axios.get).mockResolvedValue({ data: '' }); // or empty buffer
        
        const result = await downloadAndCacheThumbnail(mockCloudPath, mockSignedUrl);
        expect(result).toBeNull();
    });
  });

  describe('clearThumbnailCache', () => {
    it('should clear specific file if cloud path provided', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      clearThumbnailCache(mockCloudPath);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should clear all files if no path provided', () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['file1.jpg', 'file2.jpg'] as any);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
      
      clearThumbnailCache();
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCacheStats', () => {
    it('should return stats', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['file1.jpg'] as any);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, size: 1024 } as any);
      
      const stats = getCacheStats();
      expect(stats).toEqual({ count: 1, size: 1024 });
    });
    
    it('should return empty stats if dir missing', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const stats = getCacheStats();
        expect(stats).toEqual({ count: 0, size: 0 });
    });
  });
});
