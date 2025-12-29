
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as loginAttemptService from '../../services/loginAttemptService';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('../../utils/logger');

describe('loginAttemptService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock for readJsonSync
        (fs.readJsonSync as any).mockReturnValue({});
        (fs.existsSync as any).mockReturnValue(true);
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
        it('should increment attempts and set wait time', () => {
            (fs.readJsonSync as any).mockReturnValue({ failedAttempts: 0 });
            
            const waitTime = loginAttemptService.recordFailedAttempt();

            expect(waitTime).toBeGreaterThan(0); // Should set some wait time
            expect(fs.writeJsonSync).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ failedAttempts: 1 }),
                expect.any(Object)
            );
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
