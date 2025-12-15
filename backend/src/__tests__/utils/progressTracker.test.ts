import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as storageService from '../../services/storageService';
import { ProgressTracker } from '../../utils/progressTracker';

vi.mock('../../services/storageService');

describe('ProgressTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseYtDlpOutput', () => {
    it('should parse percentage-based progress', () => {
      const tracker = new ProgressTracker();
      const output = '[download]  23.5% of 10.00MiB at  2.00MiB/s ETA 00:05';

      const result = tracker.parseYtDlpOutput(output);

      expect(result).not.toBeNull();
      expect(result?.percentage).toBe(23.5);
      expect(result?.totalSize).toBe('10.00MiB');
      expect(result?.speed).toBe('2.00MiB/s');
    });

    it('should parse progress with tilde prefix', () => {
      const tracker = new ProgressTracker();
      const output = '[download]  50.0% of ~10.00MiB at  2.00MiB/s';

      const result = tracker.parseYtDlpOutput(output);

      expect(result).not.toBeNull();
      expect(result?.percentage).toBe(50.0);
      expect(result?.totalSize).toBe('~10.00MiB');
    });

    it('should parse size-based progress', () => {
      const tracker = new ProgressTracker();
      const output = '[download] 55.8MiB of 123.45MiB at 5.67MiB/s ETA 00:12';

      const result = tracker.parseYtDlpOutput(output);

      expect(result).not.toBeNull();
      expect(result?.downloadedSize).toBe('55.8MiB');
      expect(result?.totalSize).toBe('123.45MiB');
      expect(result?.speed).toBe('5.67MiB/s');
      expect(result?.percentage).toBeCloseTo(45.2, 1);
    });

    it('should parse segment-based progress', () => {
      const tracker = new ProgressTracker();
      const output = '[download] Downloading segment 5 of 10';

      const result = tracker.parseYtDlpOutput(output);

      expect(result).not.toBeNull();
      expect(result?.percentage).toBe(50);
      expect(result?.downloadedSize).toBe('5/10 segments');
      expect(result?.totalSize).toBe('10 segments');
      expect(result?.speed).toBe('0 B/s');
    });

    it('should return null for non-matching output', () => {
      const tracker = new ProgressTracker();
      const output = 'Some random text';

      const result = tracker.parseYtDlpOutput(output);

      expect(result).toBeNull();
    });

    it('should handle progress without ETA', () => {
      const tracker = new ProgressTracker();
      const output = '[download]  75.0% of 100.00MiB at  10.00MiB/s';

      const result = tracker.parseYtDlpOutput(output);

      expect(result).not.toBeNull();
      expect(result?.percentage).toBe(75.0);
    });

    it('should calculate percentage from sizes correctly', () => {
      const tracker = new ProgressTracker();
      const output = '[download] 25.0MiB of 100.0MiB at 5.0MiB/s';

      const result = tracker.parseYtDlpOutput(output);

      expect(result).not.toBeNull();
      expect(result?.percentage).toBe(25);
    });

    it('should handle zero total size gracefully', () => {
      const tracker = new ProgressTracker();
      const output = '[download] 0.0MiB of 0.0MiB at 0.0MiB/s';

      const result = tracker.parseYtDlpOutput(output);

      expect(result).not.toBeNull();
      expect(result?.percentage).toBe(0);
    });
  });

  describe('update', () => {
    it('should update download progress when downloadId is set', () => {
      const tracker = new ProgressTracker('download-123');
      const progress = {
        percentage: 50,
        downloadedSize: '50MiB',
        totalSize: '100MiB',
        speed: '5MiB/s',
      };

      tracker.update(progress);

      expect(storageService.updateActiveDownload).toHaveBeenCalledWith(
        'download-123',
        {
          progress: 50,
          totalSize: '100MiB',
          downloadedSize: '50MiB',
          speed: '5MiB/s',
        }
      );
    });

    it('should not update when downloadId is not set', () => {
      const tracker = new ProgressTracker();
      const progress = {
        percentage: 50,
        downloadedSize: '50MiB',
        totalSize: '100MiB',
        speed: '5MiB/s',
      };

      tracker.update(progress);

      expect(storageService.updateActiveDownload).not.toHaveBeenCalled();
    });
  });

  describe('parseAndUpdate', () => {
    it('should parse and update when valid progress is found', () => {
      const tracker = new ProgressTracker('download-123');
      const output = '[download]  50.0% of 100.00MiB at  5.00MiB/s';

      tracker.parseAndUpdate(output);

      expect(storageService.updateActiveDownload).toHaveBeenCalled();
    });

    it('should not update when no valid progress is found', () => {
      const tracker = new ProgressTracker('download-123');
      const output = 'Some random text';

      tracker.parseAndUpdate(output);

      expect(storageService.updateActiveDownload).not.toHaveBeenCalled();
    });

    it('should not update when downloadId is not set', () => {
      const tracker = new ProgressTracker();
      const output = '[download]  50.0% of 100.00MiB at  5.00MiB/s';

      tracker.parseAndUpdate(output);

      expect(storageService.updateActiveDownload).not.toHaveBeenCalled();
    });
  });
});

