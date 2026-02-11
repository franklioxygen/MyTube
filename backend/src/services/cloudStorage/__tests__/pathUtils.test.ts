import fs from 'fs-extra';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeUploadPath, resolveAbsolutePath, sanitizeFilename } from '../pathUtils';

vi.mock('fs-extra');
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('cloudStorage pathUtils', () => {
  const mockCwd = '/app';
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    process.cwd = vi.fn().mockReturnValue(mockCwd);
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe('resolveAbsolutePath', () => {
    it('should find video file in uploads directory', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === path.join(mockCwd, 'uploads', 'videos', 'test.mp4');
      });

      const result = resolveAbsolutePath('videos/test.mp4');
      expect(result).toBe(path.join(mockCwd, 'uploads', 'videos', 'test.mp4'));
    });

    it('should find image file in uploads directory', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === path.join(mockCwd, 'uploads', 'images', 'test.jpg');
      });

      const result = resolveAbsolutePath('images/test.jpg');
      expect(result).toBe(path.join(mockCwd, 'uploads', 'images', 'test.jpg'));
    });

    it('should find subtitle file in uploads directory', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === path.join(mockCwd, 'uploads', 'subtitles', 'test.vtt');
      });

      const result = resolveAbsolutePath('subtitles/test.vtt');
      expect(result).toBe(path.join(mockCwd, 'uploads', 'subtitles', 'test.vtt'));
    });
  
    it('should handle leading slash', () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          return p === path.join(mockCwd, 'uploads', 'videos', 'test.mp4');
        });
  
        const result = resolveAbsolutePath('/videos/test.mp4');
        expect(result).toBe(path.join(mockCwd, 'uploads', 'videos', 'test.mp4'));
    });

    it('should fallback to legacy data roots if not found in uploads', () => {
      // Setup: NOT in uploads, but IS in legacy data path
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p !== 'string') return false;
        // The loop checks root existence then file existence
        if (p === path.join(mockCwd, 'data')) return true; 
        if (p === path.join(mockCwd, 'data', 'old/path/file.txt')) return true;
        return false;
      });

      const result = resolveAbsolutePath('old/path/file.txt');
      expect(result).toBe(path.join(mockCwd, 'data', 'old/path/file.txt'));
    });

    it('should return null if not found anywhere', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = resolveAbsolutePath('nonexistent.file');
      expect(result).toBeNull();
    });

    it('should return null for empty or invalid relative path', () => {
      expect(resolveAbsolutePath('' as any)).toBeNull();
      expect(resolveAbsolutePath(undefined as any)).toBeNull();
    });

    it('should reject path traversal attempts', () => {
      expect(resolveAbsolutePath('../secret.txt')).toBeNull();
      expect(resolveAbsolutePath('videos/../secret.mp4')).toBeNull();
    });

    it('should return null for missing image path in uploads', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (typeof p !== 'string') return false;
        if (p === path.join(mockCwd, 'data')) return false;
        return false;
      });

      const result = resolveAbsolutePath('images/missing.jpg');
      expect(result).toBeNull();
    });

    it('should return null for missing subtitle path in uploads', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = resolveAbsolutePath('subtitles/missing.vtt');
      expect(result).toBeNull();
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove special characters and lowercase', () => {
      expect(sanitizeFilename('Test File!.mp4')).toBe('test_file__mp4');
    });

    it('should keep alphanumeric', () => {
        expect(sanitizeFilename('abc123')).toBe('abc123');
    });
  });

  describe('normalizeUploadPath', () => {
    it('should replace backslashes', () => {
      expect(normalizeUploadPath('folder\\file')).toBe('/folder/file');
    });

    it('should ensure leading slash', () => {
      expect(normalizeUploadPath('folder/file')).toBe('/folder/file');
      expect(normalizeUploadPath('/folder/file')).toBe('/folder/file');
    });
  });
});
