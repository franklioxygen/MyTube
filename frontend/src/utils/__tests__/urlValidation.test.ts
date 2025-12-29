import { describe, expect, it, vi } from 'vitest';
import { isValidUrl, validateUrlForOpen } from '../urlValidation';

describe('urlValidation', () => {
    describe('isValidUrl', () => {
        it('should return true for valid http/https URLs', () => {
            expect(isValidUrl('https://www.google.com')).toBe(true);
            expect(isValidUrl('http://example.com')).toBe(true);
        });

        it('should return false for invalid URLs', () => {
            expect(isValidUrl('not a url')).toBe(false);
            expect(isValidUrl('ftp://example.com')).toBe(false); // Only http/https supported
        });
    });

    describe('validateUrlForOpen', () => {
        it('should return url for valid URLs', () => {
            expect(validateUrlForOpen('https://example.com')).toBe('https://example.com');
        });

        it('should return null for invalid URLs and warn', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(validateUrlForOpen('not a url')).toBeNull();
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid URL blocked'));
            consoleSpy.mockRestore();
        });

        it('should return null for null/undefined input', () => {
            expect(validateUrlForOpen(null)).toBeNull();
            expect(validateUrlForOpen(undefined)).toBeNull();
        });
    });
});
