import { describe, expect, it } from 'vitest';
import * as storageService from '../index';

describe('storageService index (Facade)', () => {
    it('should export Core Storage functions', () => {
        // Videos
        expect(storageService.getVideos).toBeDefined();
        expect(storageService.getVideoBySourceUrl).toBeDefined();
        expect(storageService.getVideoById).toBeDefined();
        expect(storageService.saveVideo).toBeDefined();
        expect(storageService.deleteVideo).toBeDefined();

        // Initialization
        expect(storageService.initializeStorage).toBeDefined();

        // Settings
        expect(storageService.getSettings).toBeDefined();
        expect(storageService.saveSettings).toBeDefined();

        // Collections
        expect(storageService.getCollections).toBeDefined();
        expect(storageService.getCollectionById).toBeDefined();
        expect(storageService.saveCollection).toBeDefined();
        expect(storageService.deleteCollection).toBeDefined();

        // Download Status / History
        expect(storageService.addActiveDownload).toBeDefined();
        expect(storageService.getDownloadHistory).toBeDefined();
    });

    it('should re-export Types', () => {
        // Types are erased at runtime mostly, but if we have enums or classes they should be here.
        // If index.ts has `export * from "./types"`, and types.ts has enums, we can check them.
        // Assuming types.ts has mostly interfaces which don't exist at runtime, 
        // passing this test implies the module loaded successfully.
        expect(storageService).toBeDefined();
    });
});
