
import { execFile } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as security from '../../utils/security';

// Mock dependencies
vi.mock('child_process', () => ({
    execFile: vi.fn(),
}));

describe('security', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('validatePathWithinDirectory', () => {
        it('should return true for valid paths', () => {
            expect(security.validatePathWithinDirectory('/base/file.txt', '/base')).toBe(true);
        });

        it('should return false for traversal', () => {
            expect(security.validatePathWithinDirectory('/base/../other/file.txt', '/base')).toBe(false);
        });
    });

    describe('validateUrl', () => {
        it('should allow valid http/https urls', () => {
            expect(security.validateUrl('https://google.com')).toBe('https://google.com');
        });

        it('should reject invalid protocol', () => {
            expect(() => security.validateUrl('ftp://google.com')).toThrow('Invalid protocol');
        });

        it('should reject internal IPs', () => {
            expect(() => security.validateUrl('http://127.0.0.1')).toThrow('SSRF protection');
            expect(() => security.validateUrl('http://localhost')).toThrow('SSRF protection');
        });
    });

    describe('sanitizeHtml', () => {
        it('should escape special chars', () => {
            expect(security.sanitizeHtml('<script>')).toBe('&lt;script&gt;');
        });
    });

    describe('execFileSafe', () => {
        it('should call execFile', async () => {
            (execFile as any).mockImplementation((cmd, args, opts, cb) => cb(null, 'stdout', 'stderr'));
            
            const result = await security.execFileSafe('ls', ['-la']);
            expect(execFile).toHaveBeenCalled();
            expect(result).toEqual({ stdout: 'stdout', stderr: 'stderr' });
        });
    });
});
