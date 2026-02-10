
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import * as metadataService from '../../services/metadataService';

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
    });

    describe('getVideoDuration', () => {
        it('should return duration if file exists', async () => {
            (fs.existsSync as any).mockReturnValue(true);
            const duration = await metadataService.getVideoDuration('/path/to/video.mp4');
            expect(duration).toBe(101); // Rounded 100.5
        });

        it('should return null if file missing', async () => {
            (fs.existsSync as any).mockReturnValue(false);
            await expect(metadataService.getVideoDuration('/missing.mp4'))
                .rejects.toThrow();
        });
    });

    describe('backfillDurations', () => {
        it('should update videos with missing durations', async () => {
            const mockVideos = [
                { id: '1', title: 'Vid 1', videoPath: '/videos/vid1.mp4', duration: null }
            ];
            (db.select().from(undefined as any).all as any).mockResolvedValue(mockVideos);
            (fs.existsSync as any).mockReturnValue(true);

            await metadataService.backfillDurations();

            expect(db.update).toHaveBeenCalled();
        });

        it('should skip temporary artifact files during backfill', async () => {
            const mockVideos = [
                { id: '1', title: 'Temp Vid', videoPath: '/videos/some.video.temp.webm', duration: null },
                { id: '2', title: 'Normal Vid', videoPath: '/videos/normal.mp4', duration: null }
            ];
            (db.select().from(undefined as any).all as any).mockResolvedValue(mockVideos);
            (fs.existsSync as any).mockReturnValue(true);

            await metadataService.backfillDurations();

            expect(db.update).toHaveBeenCalledTimes(1);
        });
    });
});
