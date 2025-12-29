
import { spawn } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudflaredService } from '../../services/cloudflaredService';

// Mock dependencies
vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));

vi.mock('../../utils/logger');

describe('cloudflaredService', () => {
    let mockProcess: { stdout: { on: any }; stderr: { on: any }; on: any; kill: any };

    beforeEach(() => {
        vi.clearAllMocks();
        mockProcess = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn(),
            kill: vi.fn(),
        };
        (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockProcess);
    });

    afterEach(() => {
        cloudflaredService.stop();
    });

    describe('start', () => {
        it('should start quick tunnel process if no token provided', () => {
            cloudflaredService.start(undefined, 8080);
            
            expect(spawn).toHaveBeenCalledWith('cloudflared', ['tunnel', '--url', 'http://localhost:8080']);
            expect(cloudflaredService.getStatus().isRunning).toBe(true);
        });

        it('should start named tunnel if token provided', () => {
            const token = Buffer.from(JSON.stringify({ t: 'tunnel-id', a: 'account-tag' })).toString('base64');
            cloudflaredService.start(token);

            expect(spawn).toHaveBeenCalledWith('cloudflared', ['tunnel', 'run', '--token', token]);
            expect(cloudflaredService.getStatus().isRunning).toBe(true);
            expect(cloudflaredService.getStatus().tunnelId).toBe('tunnel-id');
        });

        it('should not start if already running', () => {
            cloudflaredService.start();
            cloudflaredService.start(); // Second call

            expect(spawn).toHaveBeenCalledTimes(1);
        });
    });

    describe('stop', () => {
        it('should kill process if running', () => {
            cloudflaredService.start();
            cloudflaredService.stop();

            expect(mockProcess.kill).toHaveBeenCalled();
            expect(cloudflaredService.getStatus().isRunning).toBe(false);
        });

        it('should do nothing if not running', () => {
            cloudflaredService.stop();
            expect(mockProcess.kill).not.toHaveBeenCalled();
        });
    });

    describe('getStatus', () => {
        it('should return correct status', () => {
            expect(cloudflaredService.getStatus()).toEqual({
                isRunning: false,
                tunnelId: null,
                accountTag: null,
                publicUrl: null
            });
        });
    });
});
