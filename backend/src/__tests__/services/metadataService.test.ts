
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import * as metadataService from '../../services/metadataService';
import * as security from '../../utils/security';
import { logger } from "../../utils/logger";

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
    execFileSafe: vi.fn().mockResolvedValue({ stdout: '100.5' }), // Default duration
    pathExistsSafeSync: vi.fn(() => true),
    resolveSafeChildPath: vi.fn((base: string, child: string) => `${base}/${child}`)
}));

describe('metadataService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (fs.existsSync as any).mockReturnValue(true);
        (security.validateVideoPath as any).mockImplementation((p: string) => p);
        (security.execFileSafe as any).mockResolvedValue({ stdout: '100.5' });
        (security.pathExistsSafeSync as any).mockReturnValue(true);
        (security.resolveSafeChildPath as any).mockImplementation(
            (base: string, child: string) => `${base}/${child}`
        );
        (db.all as any).mockResolvedValue([]);
    });

    describe('getVideoDuration', () => {
        it('should return duration if file exists', async () => {
            const duration = await metadataService.getVideoDuration('/path/to/video.mp4');
            expect(duration).toBe(101); // Rounded 100.5
        });

        it('should return null if file missing', async () => {
            (security.pathExistsSafeSync as any).mockReturnValue(false);
            await expect(metadataService.getVideoDuration('/missing.mp4'))
                .rejects.toThrow();
        });

        it('should return null for non-numeric ffprobe output', async () => {
            (security.execFileSafe as any).mockResolvedValueOnce({ stdout: 'not-a-number' });

            const duration = await metadataService.getVideoDuration('/path/to/video.mp4');

            expect(duration).toBeNull();
        });

        it('should log and return null for unknown errors', async () => {
            const consoleErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => { });
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

    describe('getVideoDimensions', () => {
        it('should return dimensions when ffprobe returns width and height', async () => {
            (security.execFileSafe as any).mockResolvedValueOnce({ stdout: '1920x1080\n' });

            const dimensions = await metadataService.getVideoDimensions('/path/to/video.mp4');

            expect(dimensions).toEqual({ width: 1920, height: 1080 });
            expect(security.execFileSafe).toHaveBeenCalledWith('ffprobe', [
                '-v',
                'error',
                '-select_streams',
                'v:0',
                '-show_entries',
                'stream=width,height',
                '-of',
                'csv=p=0:s=x',
                '/path/to/video.mp4',
            ]);
        });

        it('should return null for incomplete dimension output', async () => {
            (security.execFileSafe as any).mockResolvedValueOnce({ stdout: '1920xN/A\n' });

            const dimensions = await metadataService.getVideoDimensions('/path/to/video.mp4');

            expect(dimensions).toBeNull();
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
            const consoleLogSpy = vi.spyOn(logger, 'info').mockImplementation(() => { });
            const mockVideos = [
                { id: '1', title: 'Already Filled', videoPath: '/videos/already.mp4', duration: '33' },
                { id: '2', title: 'Bad Prefix', videoPath: '/tmp/video.mp4', duration: null },
                { id: '3', title: 'Missing File', videoPath: '/videos/missing.mp4', duration: null }
            ];
            (db.all as any).mockResolvedValue(mockVideos);
            (security.pathExistsSafeSync as any).mockImplementation((p: string) => !p.endsWith('/missing.mp4'));

            await metadataService.backfillDurations();

            expect(db.update).not.toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith(
                'Duration backfill finished. No videos needed update.'
            );
            consoleLogSpy.mockRestore();
        });

        it('should catch and log backfill errors', async () => {
            const consoleErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => { });
            (db.all as any).mockRejectedValueOnce(new Error('db failed'));

            await metadataService.backfillDurations();

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error during duration backfill:',
                expect.any(Error)
            );
            consoleErrorSpy.mockRestore();
        });
    });

    describe('backfillVideoDimensions', () => {
        it('should update videos with missing dimensions', async () => {
            const mockVideos = [
                { id: '1', title: 'Vid 1', videoPath: '/videos/vid1.mp4', width: null, height: null }
            ];
            (db.all as any).mockResolvedValue(mockVideos);
            (security.execFileSafe as any).mockResolvedValueOnce({ stdout: '1920x1080\n' });

            await metadataService.backfillVideoDimensions();

            expect(db.update).toHaveBeenCalled();
            expect((db as any).set).toHaveBeenCalledWith({ width: 1920, height: 1080 });
        });

        it('should skip videos that already have dimensions', async () => {
            const mockVideos = [
                { id: '1', title: 'Already Filled', videoPath: '/videos/already.mp4', width: 1920, height: 1080 }
            ];
            (db.all as any).mockResolvedValue(mockVideos);

            await metadataService.backfillVideoDimensions();

            expect(db.update).not.toHaveBeenCalled();
        });
    });
});
