
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as downloadUtils from '../../utils/downloadUtils';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('../../utils/logger');
vi.mock('../../services/storageService');

describe('downloadUtils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('parseSize', () => {
        it('should parse standardized units', () => {
            expect(downloadUtils.parseSize('1 KiB')).toBe(1024);
            expect(downloadUtils.parseSize('1 MiB')).toBe(1048576);
            expect(downloadUtils.parseSize('1.5 GiB')).toBe(1610612736);
        });

        it('should parse decimal units', () => {
            expect(downloadUtils.parseSize('1 KB')).toBe(1000);
            expect(downloadUtils.parseSize('1 MB')).toBe(1000000);
        });
        
        it('should handle ~ prefix', () => {
             expect(downloadUtils.parseSize('~1 KiB')).toBe(1024);
        });
    });

    describe('formatBytes', () => {
        it('should format bytes to human readable', () => {
            expect(downloadUtils.formatBytes(1024)).toBe('1 KiB');
            expect(downloadUtils.formatBytes(1048576)).toBe('1 MiB');
        });
    });

    describe('calculateDownloadedSize', () => {
        it('should calculate size from percentage', () => {
            // If total is "100 MiB" and percentage is 50
            // 50 MB
            expect(downloadUtils.calculateDownloadedSize(50, '100 MiB')).toBe('50 MiB');
        });
    });
});
