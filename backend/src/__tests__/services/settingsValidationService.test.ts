
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

    describe('checkVisitorModeRestrictions', () => {
        it('should allow everything if visitor mode disabled', () => {
            const result = settingsValidationService.checkVisitorModeRestrictions({ visitorMode: false } as any, { websiteName: 'New' });
            expect(result.allowed).toBe(true);
        });

        it('should block changes if visitor mode enabled', () => {
            const result = settingsValidationService.checkVisitorModeRestrictions({ visitorMode: true } as any, { websiteName: 'New' });
            expect(result.allowed).toBe(false);
        });

        it('should allow turning off visitor mode', () => {
            const result = settingsValidationService.checkVisitorModeRestrictions({ visitorMode: true } as any, { visitorMode: false });
            expect(result.allowed).toBe(true);
        });
        
        it('should allow cloudflare settings update', () => {
            const result = settingsValidationService.checkVisitorModeRestrictions(
                { visitorMode: true } as any, 
                { cloudflaredTunnelEnabled: true }
            );
            expect(result.allowed).toBe(true);
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
