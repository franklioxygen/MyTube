
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as loginAttemptService from '../../services/loginAttemptService';
import * as settingsService from '../../services/storageService/settings';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('../../utils/logger');
vi.mock('../../services/storageService/settings', () => ({
    getSettings: vi.fn(),
}));

describe('loginAttemptService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock for readJsonSync
        (fs.readJsonSync as any).mockReturnValue({});
        (fs.existsSync as any).mockReturnValue(true);
        // Default mock for getSettings
        (settingsService.getSettings as any).mockReturnValue({ fastRetryMode: false });
    });

    describe('canAttemptLogin', () => {
        it('should return 0 if no wait time', () => {
            (fs.readJsonSync as any).mockReturnValue({ waitUntil: Date.now() - 1000 });
            expect(loginAttemptService.canAttemptLogin()).toBe(0);
        });

        it('should return remaining time if waiting', () => {
            const future = Date.now() + 5000;
            (fs.readJsonSync as any).mockReturnValue({ waitUntil: future });
            expect(loginAttemptService.canAttemptLogin()).toBeGreaterThan(0);
        });
    });

    describe('recordFailedAttempt', () => {
        it('should increment attempts and set wait time (Normal Mode)', () => {
            (fs.readJsonSync as any).mockReturnValue({ failedAttempts: 0 });
            (settingsService.getSettings as any).mockReturnValue({ fastRetryMode: false });
            
            const waitTime = loginAttemptService.recordFailedAttempt();

            expect(waitTime).toBe(5000); // 1st attempt: 5s
            expect(fs.writeJsonSync).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ failedAttempts: 1 }),
                expect.any(Object)
            );
        });

        it('should use Fast Retry Mode wait times when enabled', () => {
            (fs.readJsonSync as any).mockReturnValue({ failedAttempts: 3 }); // 3 prior attempts = 4th attempt now
            (settingsService.getSettings as any).mockReturnValue({ fastRetryMode: true });

            const waitTime = loginAttemptService.recordFailedAttempt();

            // 4th attempt in Fast Retry is 30s
            expect(waitTime).toBe(30000); 
        });

        it('should cap wait time in Fast Retry Mode', () => {
             (fs.readJsonSync as any).mockReturnValue({ failedAttempts: 10 }); 
             (settingsService.getSettings as any).mockReturnValue({ fastRetryMode: true });
 
             const waitTime = loginAttemptService.recordFailedAttempt();
 
             // Max wait time in Fast Retry is 3 minutes
             expect(waitTime).toBe(3 * 60 * 1000); 
        });
    });

    describe('resetFailedAttempts', () => {
        it('should reset data to zeros', () => {
            loginAttemptService.resetFailedAttempts();

            expect(fs.writeJsonSync).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ failedAttempts: 0, waitUntil: 0 }),
                expect.any(Object)
            );
        });
    });
});
