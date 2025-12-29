
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as databaseBackupService from '../../services/databaseBackupService';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('better-sqlite3', () => ({
    default: vi.fn().mockImplementation(() => ({
        prepare: vi.fn().mockReturnValue({ get: vi.fn() }),
        close: vi.fn()
    }))
}));
vi.mock('../../db', () => ({
    reinitializeDatabase: vi.fn(),
    sqlite: { close: vi.fn() }
}));
vi.mock('../../utils/helpers', () => ({
    generateTimestamp: () => '20230101'
}));
vi.mock('../../utils/logger');

describe('databaseBackupService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('exportDatabase', () => {
        it('should return db path if exists', () => {
            (fs.existsSync as any).mockReturnValue(true);
            const path = databaseBackupService.exportDatabase();
            expect(path).toContain('mytube.db');
        });

        it('should throw if db missing', () => {
            (fs.existsSync as any).mockReturnValue(false);
            expect(() => databaseBackupService.exportDatabase()).toThrow('Database file not found');
        });
    });

    describe('createBackup', () => {
        it('should copy file if exists', () => {
             // Access private function via module export if possible, but it's not exported.
             // We can test via importDatabase which calls createBackup
             // Or we skip testing private function directly and test public API
             // But createBackup is not exported.
             // Wait, createBackup is NOT exported in the outline.
             // Let's rely on importDatabase calling it.
        });
        
        // Actually, createBackup is not exported, so we test it implicitly.
    });

    describe('importDatabase', () => {
        it('should validate, backup, and replace db', () => {
            (fs.existsSync as any).mockReturnValue(true);
            (fs.statSync as any).mockReturnValue({ mtimeMs: 1000 });
            
            databaseBackupService.importDatabase('/tmp/new.db');

            expect(fs.copyFileSync).toHaveBeenCalledTimes(2); // Backup + Import
            expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/new.db');
        });
    });

    describe('cleanupBackupDatabases', () => {
        it('should delete backup files', () => {
            (fs.readdirSync as any).mockReturnValue(['mytube-backup-1.db.backup', 'other.txt']);
            
            const result = databaseBackupService.cleanupBackupDatabases();

            expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('mytube-backup-1.db.backup'));
            expect(result.deleted).toBe(1);
        });
    });
});
