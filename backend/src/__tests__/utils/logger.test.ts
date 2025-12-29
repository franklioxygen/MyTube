
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, LogLevel } from '../../utils/logger';

describe('Logger', () => {
    let consoleSpy: any;

    beforeEach(() => {
        consoleSpy = {
            log: vi.spyOn(console, 'log').mockImplementation(() => {}),
            error: vi.spyOn(console, 'error').mockImplementation(() => {}),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
            debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should log info messages', () => {
        const testLogger = new Logger(LogLevel.INFO);
        testLogger.info('test message');
        expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[INFO] test message'));
    });

    it('should not log debug messages if level is INFO', () => {
        const testLogger = new Logger(LogLevel.INFO);
        testLogger.debug('debug message');
        expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should log error messages', () => {
        const testLogger = new Logger(LogLevel.INFO);
        testLogger.error('error message');
        expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('[ERROR] error message'));
    });
});
