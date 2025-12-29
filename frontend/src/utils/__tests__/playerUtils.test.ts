import { afterEach, describe, expect, it } from 'vitest';
import { getAvailablePlayers, getPlayerUrl, isAndroid, isIOS, isMac, isWindows } from '../playerUtils';

describe('playerUtils', () => {
    const originalUserAgent = navigator.userAgent;

    // Helper to mock user agent
    const mockUserAgent = (userAgent: string) => {
        Object.defineProperty(navigator, 'userAgent', {
            value: userAgent,
            writable: true,
        });
    };

    afterEach(() => {
        mockUserAgent(originalUserAgent);
    });

    describe('Platform Detection', () => {
        it('should detect Mac', () => {
            mockUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
            expect(isMac()).toBe(true);
        });

         it('should detect Windows', () => {
            mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
            expect(isWindows()).toBe(true);
        });

        it('should detect iOS', () => {
            mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)');
            expect(isIOS()).toBe(true);
        });
        
         it('should detect Android', () => {
            mockUserAgent('Mozilla/5.0 (Linux; Android 10; SM-G960U)');
            expect(isAndroid()).toBe(true);
        });
    });

    describe('getAvailablePlayers', () => {
        it('should return Mac players on Mac', () => {
            mockUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
            const players = getAvailablePlayers();
            const playerIds = players.map(p => p.id);
            expect(playerIds).toContain('vlc');
            expect(playerIds).toContain('iina');
            expect(playerIds).toContain('infuse');
        });

        it('should return Windows players on Windows', () => {
            mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
            const players = getAvailablePlayers();
            const playerIds = players.map(p => p.id);
            expect(playerIds).toContain('vlc');
            expect(playerIds).toContain('potplayer');
        });
    });

    describe('getPlayerUrl', () => {
        const videoUrl = 'http://example.com/video.mp4';
        const encodedUrl = encodeURIComponent(videoUrl);

        it('should return correct VLC url', () => {
            expect(getPlayerUrl('vlc', videoUrl)).toBe(`vlc://${videoUrl}`);
        });

        it('should return correct IINA url', () => {
            expect(getPlayerUrl('iina', videoUrl)).toBe(`iina://weblink?url=${encodedUrl}`);
        });

        it('should return correct Infuse url', () => {
            expect(getPlayerUrl('infuse', videoUrl)).toBe(`infuse://x-callback-url/play?url=${encodedUrl}`);
        });

        it('should return empty string for invalid inputs', () => {
            expect(getPlayerUrl('', videoUrl)).toBe('');
            expect(getPlayerUrl('vlc', '')).toBe('');
        });
    });
});
