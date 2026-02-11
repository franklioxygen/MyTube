
import { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    errorResponse,
    sendBadRequest,
    sendConflict,
    sendData,
    sendInternalError,
    sendNotFound,
    sendStatus,
    sendSuccess,
    sendSuccessMessage,
    successMessage,
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

        it('should omit message when not provided', () => {
            const resp = successResponse({ id: 2 });
            expect(resp).toEqual({ success: true, data: { id: 2 } });
        });
    });

    describe('errorResponse', () => {
        it('should format error response', () => {
            const resp = errorResponse('Failed');
            expect(resp).toEqual({ success: false, error: 'Failed' });
        });
    });

    describe('successMessage', () => {
        it('should format success message response', () => {
            const resp = successMessage('Done');
            expect(resp).toEqual({ success: true, message: 'Done' });
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

        it('should send 404 with custom message', () => {
            sendNotFound(mockRes as Response, 'Missing item');
            expect(statusMock).toHaveBeenCalledWith(404);
            expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing item' }));
        });
    });

    describe('sendSuccessMessage', () => {
        it('should send 200 with message only', () => {
            sendSuccessMessage(mockRes as Response, 'All good');
            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ success: true, message: 'All good' });
        });
    });

    describe('sendData', () => {
        it('should send raw data payload', () => {
            sendData(mockRes as Response, { raw: true });
            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith({ raw: true });
        });
    });

    describe('sendConflict', () => {
        it('should send 409 with conflict error response', () => {
            sendConflict(mockRes as Response, 'Conflict happened');
            expect(statusMock).toHaveBeenCalledWith(409);
            expect(jsonMock).toHaveBeenCalledWith({ success: false, error: 'Conflict happened' });
        });
    });

    describe('sendInternalError', () => {
        it('should send 500 with default error', () => {
            sendInternalError(mockRes as Response);
            expect(statusMock).toHaveBeenCalledWith(500);
            expect(jsonMock).toHaveBeenCalledWith({ success: false, error: 'Internal server error' });
        });

        it('should send 500 with custom error', () => {
            sendInternalError(mockRes as Response, 'Crashed');
            expect(statusMock).toHaveBeenCalledWith(500);
            expect(jsonMock).toHaveBeenCalledWith({ success: false, error: 'Crashed' });
        });
    });

    describe('sendStatus', () => {
        it('should send custom status and payload', () => {
            sendStatus(mockRes as Response, 202, { accepted: true });
            expect(statusMock).toHaveBeenCalledWith(202);
            expect(jsonMock).toHaveBeenCalledWith({ accepted: true });
        });
    });
});
