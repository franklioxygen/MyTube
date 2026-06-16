
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const testLogger = new Logger(LogLevel.INFO);
        testLogger.info('test message');
        expect(stdoutSpy).toHaveBeenCalled();
        const output = stdoutSpy.mock.calls[0][0] as string;
        expect(output).toContain('[INFO]');
        expect(output).toContain('test message');
        stdoutSpy.mockRestore();
    });

    it('should not log debug messages if level is INFO', () => {
        const testLogger = new Logger(LogLevel.INFO);
        testLogger.debug('debug message');
        expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should log error messages', () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const testLogger = new Logger(LogLevel.INFO);
        testLogger.error('error message');
        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls[0][0] as string;
        expect(output).toContain('[ERROR]');
        expect(output).toContain('error message');
        stderrSpy.mockRestore();
    });

    it('should redact sensitive structured fields in info logs', () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        try {
            const testLogger = new Logger(LogLevel.INFO);

            testLogger.info('source log', {
                author: 'Secret Author',
                channelUrl: 'https://youtube.com/@secret-author',
                platform: 'YouTube',
            });

            const output = stdoutSpy.mock.calls[0][0] as string;
            expect(output).toContain('"author":"[REDACTED]"');
            expect(output).not.toContain('Secret Author');
            expect(output).toContain('"channelUrl":"https://youtube.com/@secret-author"');
        } finally {
            stdoutSpy.mockRestore();
        }
    });

    it('should redact sensitive structured fields in warn logs', () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const testLogger = new Logger(LogLevel.WARN);

        testLogger.warn('warning message', {
            author: 'Secret Author',
            authorUrl: 'https://example.com/secret-author',
        });

        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls[0][0] as string;
        expect(output).toContain('[WARN]');
        expect(output).toContain('warning message');
        expect(output).toContain('"author":"[REDACTED]"');
        expect(output).toContain('"authorUrl":"https://example.com/secret-author"');
        expect(output).not.toContain('Secret Author');
        stderrSpy.mockRestore();
    });
});
