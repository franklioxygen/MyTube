
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
        sendFileMock = vi.fn((_path, callback) => callback());
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
            expect(sendFileMock).toHaveBeenCalledWith('/path/to/backup.db', expect.any(Function));
            expect(databaseBackupService.cleanupDatabaseExport).toHaveBeenCalledWith('/path/to/backup.db');
        });
        it('keeps the snapshot until transfer finishes and cleans up a failed transfer', async () => {
            vi.mocked(databaseBackupService.exportDatabase).mockResolvedValue('/path/to/snapshot.db');
            let finish: (error?: Error) => void = () => {};
            sendFileMock.mockImplementation((_path: string, callback: typeof finish) => { finish = callback; });
            const response = databaseBackupController.exportDatabase(mockReq as Request, mockRes as Response);
            await vi.waitFor(() => expect(sendFileMock).toHaveBeenCalled());
            expect(databaseBackupService.cleanupDatabaseExport).not.toHaveBeenCalled();
            const error = new Error('client disconnected');
            const rejected = expect(response).rejects.toThrow(error);
            finish(error);
            await rejected;
            expect(databaseBackupService.cleanupDatabaseExport).toHaveBeenCalledWith('/path/to/snapshot.db');
        });
        it('cleans up if the client disconnects while the snapshot is being prepared', async () => {
            vi.mocked(databaseBackupService.exportDatabase).mockResolvedValue('/path/to/snapshot.db');
            mockRes.destroyed = true;
            await databaseBackupController.exportDatabase(mockReq as Request, mockRes as Response);
            expect(sendFileMock).not.toHaveBeenCalled();
            expect(databaseBackupService.cleanupDatabaseExport).toHaveBeenCalledWith('/path/to/snapshot.db');
        });
    });

    describe('importDatabase', () => {
        it('should import database successfully', async () => {
            const fileBuffer = Buffer.from('sqlite-bytes');
            mockReq.file = { buffer: fileBuffer, originalname: 'backup.db' } as any;

            await databaseBackupController.importDatabase(mockReq as Request, mockRes as Response);

            expect(databaseBackupService.importDatabase).toHaveBeenCalledWith(fileBuffer);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        it('should throw error for invalid extension', async () => {
            mockReq.file = { buffer: Buffer.from('invalid'), originalname: 'backup.txt' } as any;

            await expect(databaseBackupController.importDatabase(mockReq as Request, mockRes as Response))
                .rejects.toThrow('Only .db files are allowed');
        });

        it('should throw error when no file is uploaded', async () => {
            mockReq.file = undefined as any;

            await expect(databaseBackupController.importDatabase(mockReq as Request, mockRes as Response))
                .rejects.toThrow('No file uploaded');
        });

        it('should throw error for empty uploaded file', async () => {
            mockReq.file = { buffer: Buffer.alloc(0), originalname: 'backup.db' } as any;

            await expect(databaseBackupController.importDatabase(mockReq as Request, mockRes as Response))
                .rejects.toThrow('Uploaded file is empty');
        });
    });

    describe('mergeDatabase', () => {
        it('should merge database successfully', async () => {
            const fileBuffer = Buffer.from('sqlite-bytes');
            mockReq.file = { buffer: fileBuffer, originalname: 'backup.db' } as any;
            (databaseBackupService.mergeDatabase as any).mockReturnValue({
                videos: { merged: 1, skipped: 0 },
            });

            await databaseBackupController.mergeDatabase(mockReq as Request, mockRes as Response);

            expect(databaseBackupService.mergeDatabase).toHaveBeenCalledWith(fileBuffer);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                summary: expect.objectContaining({
                    videos: { merged: 1, skipped: 0 },
                }),
            }));
        });
    });

    describe('previewMergeDatabase', () => {
        it('should preview database merge successfully', async () => {
            const fileBuffer = Buffer.from('sqlite-bytes');
            mockReq.file = { buffer: fileBuffer, originalname: 'backup.db' } as any;
            (databaseBackupService.previewMergeDatabase as any).mockReturnValue({
                videos: { merged: 2, skipped: 1 },
            });

            await databaseBackupController.previewMergeDatabase(mockReq as Request, mockRes as Response);

            expect(databaseBackupService.previewMergeDatabase).toHaveBeenCalledWith(fileBuffer);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                summary: {
                    videos: { merged: 2, skipped: 1 },
                },
            });
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

        it('should return no-op message when no files are cleaned', async () => {
            (databaseBackupService.cleanupBackupDatabases as any).mockReturnValue({
                deleted: 0,
                failed: 0,
                errors: []
            });

            await databaseBackupController.cleanupBackupDatabases(mockReq as Request, mockRes as Response);

            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                message: 'No backup database files found to clean up.',
                deleted: 0,
                failed: 0
            });
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
