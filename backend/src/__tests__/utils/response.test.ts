
import { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    errorResponse,
    sendBadRequest,
    sendNotFound,
    sendSuccess,
    successResponse
} from '../../utils/response';

describe('response utils', () => {
    let mockRes: Partial<Response>;
    let jsonMock: any;
    let statusMock: any;

    beforeEach(() => {
        jsonMock = vi.fn();
        statusMock = vi.fn().mockReturnValue({ json: jsonMock });
        mockRes = {
            status: statusMock,
            json: jsonMock
        };
    });

    describe('successResponse', () => {
        it('should format success response', () => {
            const resp = successResponse({ id: 1 }, 'Created');
            expect(resp).toEqual({ success: true, data: { id: 1 }, message: 'Created' });
        });
    });

    describe('errorResponse', () => {
        it('should format error response', () => {
            const resp = errorResponse('Failed');
            expect(resp).toEqual({ success: false, error: 'Failed' });
        });
    });

    describe('sendSuccess', () => {
        it('should send 200 with data', () => {
            sendSuccess(mockRes as Response, { val: 1 });
            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: { val: 1 } }));
        });
    });

    describe('sendBadRequest', () => {
        it('should send 400 with error', () => {
            sendBadRequest(mockRes as Response, 'Bad input');
            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Bad input' }));
        });
    });
    
    describe('sendNotFound', () => {
        it('should send 404', () => {
            sendNotFound(mockRes as Response);
            expect(statusMock).toHaveBeenCalledWith(404);
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'Resource not found' }));
        });
    });
});
