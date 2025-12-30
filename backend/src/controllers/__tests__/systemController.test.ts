import axios from 'axios';
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../utils/logger';
import { getLatestVersion } from '../systemController';

// Mock dependencies
vi.mock('axios');
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock version to have a stable current version for testing
vi.mock('../../version', () => ({
  VERSION: {
    number: '1.0.0',
  },
}));

describe('systemController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    req = {};
    res = {
      json: jsonMock,
    } as unknown as Response;
  });

  describe('getLatestVersion', () => {
    it('should identify a newer version from releases', async () => {
      // Arrange
      const mockRelease = {
        data: {
          tag_name: 'v1.1.0',
          html_url: 'https://github.com/release/v1.1.0',
          body: 'Release notes',
          published_at: '2023-01-01',
        },
      };
      vi.mocked(axios.get).mockResolvedValue(mockRelease);

      // Act
      await getLatestVersion(req as Request, res as Response);

      // Assert
      expect(jsonMock).toHaveBeenCalledWith({
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        releaseUrl: 'https://github.com/release/v1.1.0',
        hasUpdate: true,
      });
    });

    it('should identify no update needed when versions match', async () => {
      // Arrange
      const mockRelease = {
        data: {
          tag_name: 'v1.0.0',
          html_url: 'https://github.com/release/v1.0.0',
        },
      };
      vi.mocked(axios.get).mockResolvedValue(mockRelease);

      // Act
      await getLatestVersion(req as Request, res as Response);

      // Assert
      expect(jsonMock).toHaveBeenCalledWith({
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
        releaseUrl: 'https://github.com/release/v1.0.0',
        hasUpdate: false,
      });
    });

    it('should handle fallback to tags when releases return 404', async () => {
      // Arrange
      // First call fails with 404
      const axiosError = new Error('Not Found') as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 404 };
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      
      // Setup sequential mock responses
      vi.mocked(axios.get)
        .mockRejectedValueOnce(axiosError) // First call (releases) fails
        .mockResolvedValueOnce({ // Second call (tags) succeeds
          data: [{
            name: 'v1.2.0',
            zipball_url: '...',
            tarball_url: '...',
          }]
        });

      // Act
      await getLatestVersion(req as Request, res as Response);

      // Assert
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(jsonMock).toHaveBeenCalledWith({
        currentVersion: '1.0.0',
        latestVersion: '1.2.0',
        releaseUrl: 'https://github.com/franklioxygen/mytube/releases/tag/v1.2.0',
        hasUpdate: true,
      });
    });

    it('should return current version on error', async () => {
      // Arrange
      const error = new Error('Network Error');
      vi.mocked(axios.get).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(false);

      // Act
      await getLatestVersion(req as Request, res as Response);

      // Assert
      expect(logger.error).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith({
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
        releaseUrl: '',
        hasUpdate: false,
        error: 'Failed to check for updates',
      });
    });
    
    it('should handle version comparison correctly for complex versions', async () => {
         // Arrange
         const mockRelease = {
           data: {
             tag_name: 'v1.0.1',
             html_url: 'url',
           },
         };
         vi.mocked(axios.get).mockResolvedValue(mockRelease);
   
         // Act
         await getLatestVersion(req as Request, res as Response);
   
         // Assert
         expect(jsonMock).toHaveBeenCalledWith({
           currentVersion: '1.0.0',
           latestVersion: '1.0.1',
           releaseUrl: 'url',
           hasUpdate: true,
         });
    });
  });
});
