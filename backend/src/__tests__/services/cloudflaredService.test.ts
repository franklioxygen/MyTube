
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudflaredService } from '../../services/cloudflaredService';

// Mock dependencies
vi.mock('child_process', () => ({
    spawn: vi.fn(),
    execSync: vi.fn(),
}));

vi.mock('fs', () => ({
    existsSync: vi.fn(),
    default: { existsSync: vi.fn() } // Handle both default and named import styles if needed
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
        
        // Default behavior: path not found in absolute paths
        (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
        // Default behavior: not found in PATH
        (execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
            throw new Error('Command not found');
        });
    });

    afterEach(() => {
        cloudflaredService.stop();
    });

    describe('start', () => {
        it('should start quick tunnel process with resolved path if no token provided', () => {
             // Mock finding it at a specific path
             (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path) => {
                 return path === '/opt/homebrew/bin/cloudflared';
             });

            cloudflaredService.start(undefined, 8080);
            
            expect(spawn).toHaveBeenCalledWith('/opt/homebrew/bin/cloudflared', ['tunnel', '--url', 'http://localhost:8080']);
            expect(cloudflaredService.getStatus().isRunning).toBe(true);
        });

        it('should start named tunnel if token provided and cloudflared found in PATH', () => {
            const token = Buffer.from(JSON.stringify({ t: 'tunnel-id', a: 'account-tag' })).toString('base64');
            
            // Mock finding it in PATH
            (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
            (execSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue('/usr/local/bin/cloudflared');

            cloudflaredService.start(token);

            expect(spawn).toHaveBeenCalledWith('/usr/local/bin/cloudflared', ['tunnel', 'run', '--token', token]);
            expect(cloudflaredService.getStatus().isRunning).toBe(true);
            expect(cloudflaredService.getStatus().tunnelId).toBe('tunnel-id');
        });

        it('should not start if cloudflared is not found', () => {
            // Mock not finding it anywhere
            (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
            (execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error('Command not found');
            });

            cloudflaredService.start(undefined, 8080);

            expect(spawn).not.toHaveBeenCalled();
            expect(cloudflaredService.getStatus().isRunning).toBe(false);
        });

        it('should not start if already running', () => {
            // Mock finding it at a specific path
            (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path) => {
                return path === '/opt/homebrew/bin/cloudflared';
            });
            
            cloudflaredService.start();
            cloudflaredService.start(); // Second call

            expect(spawn).toHaveBeenCalledTimes(1);
        });

        it('should handle Windows path resolution', () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', {
                value: 'win32',
                writable: true,
                configurable: true
            });

            // Mock Windows path
            (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path) => {
                return path === 'C:\\Program Files\\Cloudflare\\cloudflared\\cloudflared.exe';
            });

            cloudflaredService.start(undefined, 8080);

            expect(spawn).toHaveBeenCalledWith(
                'C:\\Program Files\\Cloudflare\\cloudflared\\cloudflared.exe',
                ['tunnel', '--url', 'http://localhost:8080']
            );

            // Restore original platform
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
                writable: true,
                configurable: true
            });
        });
    });

    describe('stop', () => {
        it('should kill process if running', () => {
            // Mock finding it at a specific path so it starts
            (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((path) => {
                return path === '/opt/homebrew/bin/cloudflared';
            });

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
