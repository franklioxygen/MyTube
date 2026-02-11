
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import * as metadataService from '../../services/metadataService';
import * as security from '../../utils/security';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('../../db', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        run: vi.fn()
    }
}));
vi.mock('../../utils/security', () => ({
    validateVideoPath: vi.fn((p) => p),
    execFileSafe: vi.fn().mockResolvedValue({ stdout: '100.5' }) // Default duration
}));

describe('metadataService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (fs.existsSync as any).mockReturnValue(true);
        (security.validateVideoPath as any).mockImplementation((p: string) => p);
        (security.execFileSafe as any).mockResolvedValue({ stdout: '100.5' });
        (db.all as any).mockResolvedValue([]);
    });

    describe('getVideoDuration', () => {
        it('should return duration if file exists', async () => {
            const duration = await metadataService.getVideoDuration('/path/to/video.mp4');
            expect(duration).toBe(101); // Rounded 100.5
        });

        it('should return null if file missing', async () => {
            (fs.existsSync as any).mockReturnValue(false);
            await expect(metadataService.getVideoDuration('/missing.mp4'))
                .rejects.toThrow();
        });

        it('should return null for non-numeric ffprobe output', async () => {
            (security.execFileSafe as any).mockResolvedValueOnce({ stdout: 'not-a-number' });

            const duration = await metadataService.getVideoDuration('/path/to/video.mp4');

            expect(duration).toBeNull();
        });

        it('should log and return null for unknown errors', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            (security.execFileSafe as any).mockRejectedValueOnce(new Error('unexpected'));

            const duration = await metadataService.getVideoDuration('/path/to/video.mp4');

            expect(duration).toBeNull();
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Error getting duration for /path/to/video.mp4:'),
                expect.any(Error)
            );
            consoleErrorSpy.mockRestore();
        });
    });

    describe('backfillDurations', () => {
        it('should update videos with missing durations', async () => {
            const mockVideos = [
                { id: '1', title: 'Vid 1', videoPath: '/videos/vid1.mp4', duration: null }
            ];
            (db.all as any).mockResolvedValue(mockVideos);

            await metadataService.backfillDurations();

            expect(db.update).toHaveBeenCalled();
        });

        it('should skip temporary artifact files during backfill', async () => {
            const mockVideos = [
                { id: '1', title: 'Temp Vid', videoPath: '/videos/some.video.temp.webm', duration: null },
                { id: '2', title: 'Normal Vid', videoPath: '/videos/normal.mp4', duration: null }
            ];
            (db.all as any).mockResolvedValue(mockVideos);

            await metadataService.backfillDurations();

            expect(db.update).toHaveBeenCalledTimes(1);
        });

        it('should skip already-filled, invalid-prefix, and missing files then log no updates', async () => {
            const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            const mockVideos = [
                { id: '1', title: 'Already Filled', videoPath: '/videos/already.mp4', duration: '33' },
                { id: '2', title: 'Bad Prefix', videoPath: '/tmp/video.mp4', duration: null },
                { id: '3', title: 'Missing File', videoPath: '/videos/missing.mp4', duration: null }
            ];
            (db.all as any).mockResolvedValue(mockVideos);
            (fs.existsSync as any).mockImplementation((p: string) => !p.endsWith('/missing.mp4'));

            await metadataService.backfillDurations();

            expect(db.update).not.toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith(
                'Duration backfill finished. No videos needed update.'
            );
            consoleLogSpy.mockRestore();
        });

        it('should catch and log backfill errors', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            (db.all as any).mockRejectedValueOnce(new Error('db failed'));

            await metadataService.backfillDurations();

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error during duration backfill:',
                expect.any(Error)
            );
            consoleErrorSpy.mockRestore();
        });
    });
});
