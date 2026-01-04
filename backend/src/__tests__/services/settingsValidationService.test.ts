
import { describe, expect, it } from 'vitest';
import * as settingsValidationService from '../../services/settingsValidationService';

describe('settingsValidationService', () => {
    describe('validateSettings', () => {
        it('should correct invalid values', () => {
            const settings: any = { maxConcurrentDownloads: 0, itemsPerPage: 0 };
            settingsValidationService.validateSettings(settings);
            
            expect(settings.maxConcurrentDownloads).toBe(1);
            expect(settings.itemsPerPage).toBe(12);
        });

        it('should trim website name', () => {
            const settings: any = { websiteName: 'a'.repeat(20) };
            settingsValidationService.validateSettings(settings);
            
            expect(settings.websiteName.length).toBe(15);
        });
    });

    
    describe('mergeSettings', () => {
        it('should merge defaults, existing, and new', () => {
            const defaults = { maxConcurrentDownloads: 3 }; // partial assumption of defaults
            const existing = { maxConcurrentDownloads: 5 };
            const newSettings = { websiteName: 'MyTube' };
            
            const merged = settingsValidationService.mergeSettings(existing as any, newSettings as any);
            
            expect(merged.websiteName).toBe('MyTube');
            expect(merged.maxConcurrentDownloads).toBe(5);
        });
    });
});
