
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cookieController from '../../controllers/cookieController';
import * as cookieService from '../../services/cookieService';

// Mock dependencies
vi.mock('../../services/cookieService');

describe('cookieController', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonMock: any;

    beforeEach(() => {
        vi.clearAllMocks();
        jsonMock = vi.fn();
        mockReq = {};
        mockRes = {
            json: jsonMock,
        };
    });

    describe('uploadCookies', () => {
        it('should upload cookies successfully', async () => {
            const fileBuffer = Buffer.from('cookie-data');
            mockReq.file = { buffer: fileBuffer } as any;
            
            await cookieController.uploadCookies(mockReq as Request, mockRes as Response);

            expect(cookieService.uploadCookies).toHaveBeenCalledWith(fileBuffer);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        it('should throw error if no file uploaded', async () => {
             await expect(cookieController.uploadCookies(mockReq as Request, mockRes as Response))
                .rejects.toThrow('No file uploaded');
        });
    });

    describe('checkCookies', () => {
        it('should return existence status', async () => {
            (cookieService.checkCookies as any).mockReturnValue({ exists: true });

            await cookieController.checkCookies(mockReq as Request, mockRes as Response);

            expect(cookieService.checkCookies).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith({ exists: true });
        });
    });

    describe('deleteCookies', () => {
        it('should delete cookies successfully', async () => {
            await cookieController.deleteCookies(mockReq as Request, mockRes as Response);

            expect(cookieService.deleteCookies).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });
    });
});
