
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { visitorModeMiddleware } from '../../middleware/visitorModeMiddleware';
import * as storageService from '../../services/storageService';

// Mock dependencies
vi.mock('../../services/storageService');

describe('visitorModeMiddleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let next: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReq = {
            method: 'GET',
            body: {},
            path: '/api/something',
            url: '/api/something'
        };
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        next = vi.fn();
    });

    it('should call next if visitor mode disabled', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: false });
        visitorModeMiddleware(mockReq as Request, mockRes as Response, next);
        expect(next).toHaveBeenCalled();
    });

    it('should allow GET requests in visitor mode', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        mockReq.method = 'GET';
        visitorModeMiddleware(mockReq as Request, mockRes as Response, next);
        expect(next).toHaveBeenCalled();
    });

    it('should block POST requests unless disabling visitor mode', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        mockReq.method = 'POST';
        mockReq.body = { someSetting: true };
        
        visitorModeMiddleware(mockReq as Request, mockRes as Response, next);
        
        expect(next).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should allow disabling visitor mode', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        mockReq.method = 'POST';
        mockReq.body = { visitorMode: false };
        
        visitorModeMiddleware(mockReq as Request, mockRes as Response, next);
        
        expect(next).toHaveBeenCalled();
    });

    it('should allow passkey authenticate endpoint', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        
        mockReq = {
            method: 'POST',
            body: {},
            path: '/settings/passkeys/authenticate',
            url: '/settings/passkeys/authenticate'
        };
        
        visitorModeMiddleware(mockReq as Request, mockRes as Response, next);
        
        expect(next).toHaveBeenCalled();
    });

    it('should allow passkey verify endpoint', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        
        mockReq = {
            method: 'POST',
            body: {},
            path: '/settings/passkeys/authenticate/verify',
            url: '/settings/passkeys/authenticate/verify'
        };
        
        visitorModeMiddleware(mockReq as Request, mockRes as Response, next);
        
        expect(next).toHaveBeenCalled();
    });
});
