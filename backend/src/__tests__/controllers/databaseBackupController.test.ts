
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as databaseBackupController from '../../controllers/databaseBackupController';
import * as databaseBackupService from '../../services/databaseBackupService';

// Mock dependencies
vi.mock('../../services/databaseBackupService');
vi.mock('../../utils/helpers', () => ({
    generateTimestamp: () => '2023-01-01_00-00-00'
}));

describe('databaseBackupController', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonMock: any;
    let sendFileMock: any;

    beforeEach(() => {
        vi.clearAllMocks();
        jsonMock = vi.fn();
        sendFileMock = vi.fn();
        mockReq = {};
        mockRes = {
            json: jsonMock,
            setHeader: vi.fn(),
            sendFile: sendFileMock
        };
    });

    describe('exportDatabase', () => {
        it('should export database and send file', async () => {
            (databaseBackupService.exportDatabase as any).mockReturnValue('/path/to/backup.db');

            await databaseBackupController.exportDatabase(mockReq as Request, mockRes as Response);

            expect(databaseBackupService.exportDatabase).toHaveBeenCalled();
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('mytube-backup-'));
            expect(sendFileMock).toHaveBeenCalledWith('/path/to/backup.db');
        });
    });

    describe('importDatabase', () => {
        it('should import database successfully', async () => {
            mockReq.file = { path: '/tmp/upload.db', originalname: 'backup.db' } as any;

            await databaseBackupController.importDatabase(mockReq as Request, mockRes as Response);

            expect(databaseBackupService.importDatabase).toHaveBeenCalledWith('/tmp/upload.db');
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        it('should throw error for invalid extension', async () => {
            mockReq.file = { path: '/tmp/upload.txt', originalname: 'backup.txt' } as any;

            await expect(databaseBackupController.importDatabase(mockReq as Request, mockRes as Response))
                .rejects.toThrow('Only .db files are allowed');
        });
    });

    describe('cleanupBackupDatabases', () => {
        it('should return cleanup result', async () => {
             (databaseBackupService.cleanupBackupDatabases as any).mockReturnValue({
                 deleted: 1,
                 failed: 0,
                 errors: []
             });

             await databaseBackupController.cleanupBackupDatabases(mockReq as Request, mockRes as Response);

             expect(databaseBackupService.cleanupBackupDatabases).toHaveBeenCalled();
             expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                 success: true,
                 deleted: 1
             }));
        });
    });

    describe('getLastBackupInfo', () => {
        it('should return last backup info', async () => {
            (databaseBackupService.getLastBackupInfo as any).mockReturnValue({ exists: true, timestamp: '123' });

            await databaseBackupController.getLastBackupInfo(mockReq as Request, mockRes as Response);

            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                exists: true,
                timestamp: '123'
            });
        });
    });

    describe('restoreFromLastBackup', () => {
        it('should restore from last backup', async () => {
            await databaseBackupController.restoreFromLastBackup(mockReq as Request, mockRes as Response);

            expect(databaseBackupService.restoreFromLastBackup).toHaveBeenCalled();
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });
    });
});
