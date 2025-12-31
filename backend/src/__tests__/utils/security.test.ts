
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
        
        it('should handle absolute paths correctly without duplication', () => {
             // Mock path.resolve to behave predictably for testing logic if needed, 
             // but here we rely on the implementation fix.
             // This tests that if we pass an absolute path that is valid, it returns true.
             // The critical part is that it doesn't fail internally or double-resolve.
             const absPath = '/Users/user/project/backend/uploads/videos/test.mp4';
             const allowedDir = '/Users/user/project/backend/uploads/videos';
             expect(security.validatePathWithinDirectory(absPath, allowedDir)).toBe(true);
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
            (execFile as any).mockImplementation((cmd: string, args: string[], opts: any, cb: (err: any, stdout: string, stderr: string) => void) => cb(null, 'stdout', 'stderr'));
            
            const result = await security.execFileSafe('ls', ['-la']);
            expect(execFile).toHaveBeenCalled();
            expect(result).toEqual({ stdout: 'stdout', stderr: 'stderr' });
        });
    });
});
