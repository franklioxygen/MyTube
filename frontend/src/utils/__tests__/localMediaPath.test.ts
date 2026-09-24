import { describe, expect, it } from 'vitest';
import { encodeLocalMediaPath, isHttpUrl } from '../localMediaPath';

describe('encodeLocalMediaPath', () => {
    it('keeps directory separators while encoding filename characters as path data', () => {
        const url = encodeLocalMediaPath('/videos/Series #1/Episode #43 你好%?.mp4');

        expect(url).toBe('/videos/Series%20%231/Episode%20%2343%20%E4%BD%A0%E5%A5%BD%25%3F.mp4');
        expect(new URL(url, 'https://example.com').pathname).toBe(url);
        expect(new URL(url, 'https://example.com').hash).toBe('');
    });

    it('recognizes HTTP schemes regardless of case', () => {
        expect(isHttpUrl('HTTPS://cdn.example/video.mp4')).toBe(true);
        expect(isHttpUrl('hTtP://cdn.example/video.mp4')).toBe(true);
        expect(isHttpUrl('/videos/Episode #43.mp4')).toBe(false);
    });
});
