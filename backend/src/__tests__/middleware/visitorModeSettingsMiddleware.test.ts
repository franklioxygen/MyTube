
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { visitorModeSettingsMiddleware } from '../../middleware/visitorModeSettingsMiddleware';
import * as storageService from '../../services/storageService';

vi.mock('../../services/storageService');

describe('visitorModeSettingsMiddleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let next: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockReq = {
            method: 'POST',
            body: {},
            path: '/api/settings',
            url: '/api/settings'
        };
        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        next = vi.fn();
    });

    it('should allow cloudflare updates in visitor mode', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        mockReq.body = { cloudflaredTunnelEnabled: true };
        
        visitorModeSettingsMiddleware(mockReq as Request, mockRes as Response, next);
        
        expect(next).toHaveBeenCalled();
    });

    it('should block other updates', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        
        mockReq = {
            method: 'POST',
            body: { websiteName: 'Hacked' },
            path: '/api/settings',
            url: '/api/settings'
        };
        
        visitorModeSettingsMiddleware(mockReq as Request, mockRes as Response, next);
        
        expect(next).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should allow passkey authenticate endpoint', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        
        mockReq = {
            method: 'POST',
            body: {},
            path: '/passkeys/authenticate',
            url: '/passkeys/authenticate'
        };
        
        visitorModeSettingsMiddleware(mockReq as Request, mockRes as Response, next);
        
        expect(next).toHaveBeenCalled();
    });

    it('should allow passkey verify endpoint', () => {
        (storageService.getSettings as any).mockReturnValue({ visitorMode: true });
        
        mockReq = {
            method: 'POST',
            body: {},
            path: '/passkeys/authenticate/verify',
            url: '/passkeys/authenticate/verify'
        };
        
        visitorModeSettingsMiddleware(mockReq as Request, mockRes as Response, next);
        
        expect(next).toHaveBeenCalled();
    });
});
