import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings';

describe('settings types', () => {
    describe('defaultSettings', () => {
        it('should have correct default values', () => {
            expect(defaultSettings).toEqual(expect.objectContaining({
                loginEnabled: false,
                password: "",
                defaultAutoPlay: false,
                defaultAutoLoop: false,
                maxConcurrentDownloads: 3,
                language: "en",
                cloudDriveEnabled: false,
                homeSidebarOpen: true,
                subtitlesEnabled: true,
                websiteName: "MyTube",
                itemsPerPage: 12,
                showYoutubeSearch: true,
                infiniteScroll: false,
                videoColumns: 4,
                pauseOnFocusLoss: false,
            }));
        });

        it('should perform partial match for optional fields', () => {
            expect(defaultSettings.openListApiUrl).toBe("");
            expect(defaultSettings.cloudDrivePath).toBe("");
        });
    });
});
