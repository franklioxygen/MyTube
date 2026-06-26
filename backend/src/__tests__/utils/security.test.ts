
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
            expect(() => security.validateUrl('http://localhost.')).toThrow('SSRF protection');
        });

        it('should reject the cloud metadata / link-local range (169.254.0.0/16)', () => {
            expect(() => security.validateUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
                'SSRF protection',
            );
            expect(() => security.validateUrl('http://169.254.0.1')).toThrow('SSRF protection');
        });

        it('should reject the CGNAT range (100.64.0.0/10) but allow public 100.x neighbours', () => {
            expect(() => security.validateUrl('http://100.64.0.1')).toThrow('SSRF protection');
            expect(() => security.validateUrl('http://100.127.255.254')).toThrow('SSRF protection');
            // 100.63.x and 100.128.x are outside the CGNAT block and stay reachable.
            expect(security.validateUrl('http://100.63.0.1')).toBe('http://100.63.0.1');
            expect(security.validateUrl('http://100.128.0.1')).toBe('http://100.128.0.1');
        });

        it('should reject private/internal IPv6 literals', () => {
            expect(() => security.validateUrl('http://[::1]')).toThrow('SSRF protection');
            expect(() => security.validateUrl('http://[fe80::1]')).toThrow('SSRF protection'); // link-local
            expect(() => security.validateUrl('http://[fd00::1]')).toThrow('SSRF protection'); // unique-local
            // IPv4-mapped IPv6 wrapping the metadata IP (parser canonicalizes to hex hextets).
            expect(() => security.validateUrl('http://[::ffff:169.254.169.254]')).toThrow(
                'SSRF protection',
            );
        });

        it('should reject alternate IPv4 encodings of loopback', () => {
            expect(() => security.validateUrl('http://2130706433')).toThrow('SSRF protection'); // decimal 127.0.0.1
            expect(() => security.validateUrl('http://0x7f000001')).toThrow('SSRF protection'); // hex 127.0.0.1
        });

        it('should still allow public hosts', () => {
            expect(security.validateUrl('https://google.com')).toBe('https://google.com');
            expect(security.validateUrl('http://93.184.216.34')).toBe('http://93.184.216.34');
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
