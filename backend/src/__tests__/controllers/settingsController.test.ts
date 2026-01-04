import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import fs from 'fs-extra';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteLegacyData, getSettings, migrateData, updateSettings } from '../../controllers/settingsController';
import { verifyPassword } from '../../controllers/passwordController';
import downloadManager from '../../services/downloadManager';
import * as storageService from '../../services/storageService';

vi.mock('../../services/storageService');
vi.mock('../../services/downloadManager');
vi.mock('../../services/passwordService');
vi.mock('../../services/loginAttemptService');
vi.mock('bcryptjs');
vi.mock('fs-extra');
vi.mock('../../services/migrationService', () => ({
  runMigration: vi.fn(),
}));

describe('SettingsController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {};
    res = {
      json,
      status,
      cookie: vi.fn(),
    };
  });

  describe('getSettings', () => {
    it('should return settings', async () => {
      (storageService.getSettings as any).mockReturnValue({ theme: 'dark' });

      await getSettings(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    });

    it('should save defaults if empty', async () => {
      (storageService.getSettings as any).mockReturnValue({});

      await getSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalled();
      expect(json).toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    it('should update settings', async () => {
      req.body = { theme: 'light', maxConcurrentDownloads: 5 };
      (storageService.getSettings as any).mockReturnValue({});

      await updateSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalled();
      expect(downloadManager.setMaxConcurrentDownloads).toHaveBeenCalledWith(5);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should hash password if provided', async () => {
      req.body = { password: 'pass' };
      (storageService.getSettings as any).mockReturnValue({});
      const passwordService = await import('../../services/passwordService');
      (passwordService.hashPassword as any).mockResolvedValue('hashed');

      await updateSettings(req as Request, res as Response);

      expect(passwordService.hashPassword).toHaveBeenCalledWith('pass');
      expect(storageService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ password: 'hashed' }));
    });

    it('should validate and update itemsPerPage', async () => {
      req.body = { itemsPerPage: -5 };
      (storageService.getSettings as any).mockReturnValue({});

      await updateSettings(req as Request, res as Response);

      expect(storageService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ itemsPerPage: 12 }));
      
      req.body = { itemsPerPage: 20 };
      await updateSettings(req as Request, res as Response);
      expect(storageService.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ itemsPerPage: 20 }));
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      req.body = { password: 'pass' };
      const passwordService = await import('../../services/passwordService');
      (passwordService.verifyPassword as any).mockResolvedValue({ 
        success: true, 
        token: 'mock-token', 
        role: 'admin' 
      });

      await verifyPassword(req as Request, res as Response);

      expect(passwordService.verifyPassword).toHaveBeenCalledWith('pass');
      expect(json).toHaveBeenCalledWith({ success: true, role: 'admin' });
    });

    it('should reject incorrect password', async () => {
      req.body = { password: 'wrong' };
      const passwordService = await import('../../services/passwordService');
      (passwordService.verifyPassword as any).mockResolvedValue({
        success: false,
        message: 'Incorrect password',
      });

      await verifyPassword(req as Request, res as Response);

      expect(passwordService.verifyPassword).toHaveBeenCalledWith('wrong');
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ 
        success: false
      }));
    });
  });

  describe('migrateData', () => {
    it('should run migration', async () => {
      const migrationService = await import('../../services/migrationService');
      (migrationService.runMigration as any).mockResolvedValue({ success: true });

      await migrateData(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ results: { success: true } }));
    });

    it('should handle errors', async () => {
      const migrationService = await import('../../services/migrationService');
      (migrationService.runMigration as any).mockRejectedValue(new Error('Migration failed'));

      try {
        await migrateData(req as Request, res as Response);
        expect.fail('Should have thrown');
      } catch (error: any) {
        // The controller does NOT catch generic errors, it relies on asyncHandler.
        // So here it throws.
        expect(error.message).toBe('Migration failed');
      }
    });
  });

  describe('deleteLegacyData', () => {
    it('should delete legacy files', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.unlinkSync as any).mockImplementation(() => {});

      await deleteLegacyData(req as Request, res as Response);

      expect(fs.unlinkSync).toHaveBeenCalledTimes(4);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ results: expect.anything() }));
    });

    it('should handle errors during deletion', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.unlinkSync as any).mockImplementation(() => {
        throw new Error('Delete failed');
      });

      await deleteLegacyData(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ results: expect.anything() }));
      // It returns success but with failed list
    });
  });
});
