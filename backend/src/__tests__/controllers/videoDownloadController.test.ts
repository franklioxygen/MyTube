
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as videoDownloadController from '../../controllers/videoDownloadController';
import * as storageService from '../../services/storageService';
import * as helpers from '../../utils/helpers';

// Mock dependencies
vi.mock('../../services/downloadManager', () => ({
    default: {
        addDownload: vi.fn(),
    }
}));
vi.mock('../../services/storageService');
vi.mock('../../utils/helpers');
vi.mock('../../utils/logger');

describe('videoDownloadController', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonMock: any;
    let statusMock: any;

    beforeEach(() => {
        vi.clearAllMocks();
        jsonMock = vi.fn();
        statusMock = vi.fn().mockReturnValue({ json: jsonMock });
        mockReq = {
            body: {},
            headers: {}
        };
        mockRes = {
            json: jsonMock,
            status: statusMock,
            send: vi.fn()
        };
    });

    describe('checkVideoDownloadStatus', () => {
        it('should return existing video if found', async () => {
            const mockUrl = 'http://example.com/video';
            mockReq.query = { url: mockUrl };
            (helpers.trimBilibiliUrl as any).mockReturnValue(mockUrl);
            (helpers.isValidUrl as any).mockReturnValue(true);
            (helpers.processVideoUrl as any).mockResolvedValue({ sourceVideoId: '123' });
            (storageService.checkVideoDownloadBySourceId as any).mockReturnValue({ found: true, status: 'exists', videoId: '123' });
            (storageService.verifyVideoExists as any).mockReturnValue({ exists: true, video: { id: '123', title: 'Existing Video' } });

            await videoDownloadController.checkVideoDownloadStatus(mockReq as Request, mockRes as Response);

            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                found: true,
                status: 'exists',
                videoId: '123'
            }));
        });

        it('should return not found if video does not exist', async () => {
             const mockUrl = 'http://example.com/new';
             mockReq.query = { url: mockUrl };
             (helpers.trimBilibiliUrl as any).mockReturnValue(mockUrl);
             (helpers.isValidUrl as any).mockReturnValue(true);
             (helpers.processVideoUrl as any).mockResolvedValue({ sourceVideoId: '123' });
             (storageService.checkVideoDownloadBySourceId as any).mockReturnValue({ found: false });

             await videoDownloadController.checkVideoDownloadStatus(mockReq as Request, mockRes as Response);

             expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                 found: false
             }));
        });
    });

    describe('getDownloadStatus', () => {
        it('should return status from manager', async () => {
            (storageService.getDownloadStatus as any).mockReturnValue({ activeDownloads: [], queuedDownloads: [] });

            await videoDownloadController.getDownloadStatus(mockReq as Request, mockRes as Response);

            expect(mockRes.json).toHaveBeenCalledWith({ activeDownloads: [], queuedDownloads: [] });
        });
    });

    // Add more tests for downloadVideo, checkBilibiliParts, checkPlaylist, etc.
});
