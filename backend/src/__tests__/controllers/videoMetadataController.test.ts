
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as videoMetadataController from '../../controllers/videoMetadataController';
import * as storageService from '../../services/storageService';

// Mock dependencies
vi.mock('../../services/storageService');
vi.mock('../../utils/security', () => ({
    validateVideoPath: vi.fn((path) => path),
    validateImagePath: vi.fn((path) => path),
    execFileSafe: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('fs-extra', () => ({
    default: {
        existsSync: vi.fn().mockReturnValue(true),
        ensureDirSync: vi.fn()
    }
}));
vi.mock('path', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as object),
        join: (...args: string[]) => args.join('/'),
        basename: (path: string) => path.split('/').pop() || path,
        parse: (path: string) => ({ name: path.split('/').pop()?.split('.')[0] || path })
    };
});


describe('videoMetadataController', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonMock: any;
    let statusMock: any;

    beforeEach(() => {
        vi.clearAllMocks();
        jsonMock = vi.fn();
        statusMock = vi.fn().mockReturnValue({ json: jsonMock });
        mockReq = {
            params: {},
            body: {}
        };
        mockRes = {
            json: jsonMock,
            status: statusMock,
        };
    });

    describe('rateVideo', () => {
        it('should update video rating', async () => {
            mockReq.params = { id: '123' };
            mockReq.body = { rating: 5 };
            const mockVideo = { id: '123', rating: 5 };
            (storageService.updateVideo as any).mockReturnValue(mockVideo);

            await videoMetadataController.rateVideo(mockReq as Request, mockRes as Response);

            expect(storageService.updateVideo).toHaveBeenCalledWith('123', { rating: 5 });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({
                success: true,
                video: mockVideo
            });
        });

        it('should throw error for invalid rating', async () => {
            mockReq.body = { rating: 6 };
            await expect(videoMetadataController.rateVideo(mockReq as Request, mockRes as Response))
                .rejects.toThrow('Rating must be a number between 1 and 5');
        });
    });

    describe('incrementViewCount', () => {
        it('should increment view count', async () => {
            mockReq.params = { id: '123' };
            const mockVideo = { id: '123', viewCount: 10 };
            (storageService.getVideoById as any).mockReturnValue(mockVideo);
            (storageService.updateVideo as any).mockReturnValue({ ...mockVideo, viewCount: 11 });

            await videoMetadataController.incrementViewCount(mockReq as Request, mockRes as Response);

            expect(storageService.updateVideo).toHaveBeenCalledWith('123', expect.objectContaining({
                viewCount: 11
            }));
            expect(jsonMock).toHaveBeenCalledWith({
                success: true,
                viewCount: 11
            });
        });
    });

    describe('updateProgress', () => {
        it('should update progress', async () => {
            mockReq.params = { id: '123' };
            mockReq.body = { progress: 50 };
            (storageService.updateVideo as any).mockReturnValue({ id: '123', progress: 50 });

            await videoMetadataController.updateProgress(mockReq as Request, mockRes as Response);

            expect(storageService.updateVideo).toHaveBeenCalledWith('123', expect.objectContaining({
                progress: 50
            }));
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: { progress: 50 }
            }));
        });
    });
});
